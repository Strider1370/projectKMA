import fs from 'fs'
import path from 'path'
import config from '../config.js'
import { parseRadarBinary, renderFullCoverageEcho } from '../parsers/radar-echo-parser.js'

let backgroundFillRunning = false;
const RENDER_VERSION = "rainrate-reproject-full-v2";
const IMMEDIATE_FRAME_COUNT = 4;

function ensureRadarDir() {
  const radarDir = path.join(config.storage.base_path, "radar");
  fs.mkdirSync(radarDir, { recursive: true });
  return radarDir;
}

function formatKstTm(dateKst) {
  const y = dateKst.getUTCFullYear();
  const m = String(dateKst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateKst.getUTCDate()).padStart(2, "0");
  const h = String(dateKst.getUTCHours()).padStart(2, "0");
  const mi = String(dateKst.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${h}${mi}`;
}

function getCandidateTms(delayMinutes = config.radar_echo.delay_minutes) {
  const nowUtc = new Date();
  const nowKst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  nowKst.setUTCMinutes(nowKst.getUTCMinutes() - delayMinutes);

  const minute = Math.floor(nowKst.getUTCMinutes() / 5) * 5;
  nowKst.setUTCMinutes(minute, 0, 0);

  return [0, 1, 2].map((i) => {
    const t = new Date(nowKst.getTime() - i * 5 * 60 * 1000);
    return formatKstTm(t);
  });
}

function buildEchoUrl(tm) {
  const params = new URLSearchParams({
    tm,
    data: "bin",
    cmp: config.radar_echo.cmp,
    authKey: config.api.auth_key,
  });
  return `${config.api.radar_url}?${params.toString()}`;
}

async function fetchWithTimeout(url, ms = config.radar_echo.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download radar binary (.bin.gz) for a given timestamp.
 * Returns raw gzipped Buffer or null on failure.
 */
async function fetchRadarBinary(tm) {
  const url = buildEchoUrl(tm);
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // Sanity check: gzip starts with 0x1f 0x8b, minimum reasonable size
    if (buffer.length < 10000 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
      return null;
    }
    return buffer;
  } catch (error) {
    return null;
  }
}

function loadExistingMeta(radarDir) {
  const metaPath = path.join(radarDir, "echo_meta.json");
  if (!fs.existsSync(metaPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function buildFrameTms(latestTm, frameCount) {
  const frameTms = [];
  const latestDate = new Date(Date.UTC(
    Number(latestTm.slice(0, 4)),
    Number(latestTm.slice(4, 6)) - 1,
    Number(latestTm.slice(6, 8)),
    Number(latestTm.slice(8, 10)) - 9,
    Number(latestTm.slice(10, 12)),
    0,
    0
  ));

  for (let i = frameCount - 1; i >= 0; i--) {
    const frameDate = new Date(latestDate.getTime() - i * 5 * 60 * 1000);
    const frameKst = new Date(frameDate.getTime() + 9 * 60 * 60 * 1000);
    frameTms.push(formatKstTm(frameKst));
  }

  return frameTms;
}

async function renderFrame(radarDir, tm) {
  const filename = `echo_korea_${tm}.png`;
  const filePath = path.join(radarDir, filename);
  const gzBuffer = await fetchRadarBinary(tm);
  if (!gzBuffer) return null;

  const { refl } = parseRadarBinary(gzBuffer);
  const nationwide = await renderFullCoverageEcho(refl);
  fs.writeFileSync(filePath, nationwide.pngBuffer);

  return {
    tm,
    cmp: config.radar_echo.cmp,
    render_version: RENDER_VERSION,
    path: `/data/radar/${filename}`,
    bounds: nationwide.bounds,
    width: nationwide.width,
    height: nationwide.height,
    echoCount: nationwide.echoCount,
    scale: nationwide.scale,
  };
}

function writeMeta(radarDir, latestTm, frameTms, existingFrames) {
  const frames = frameTms
    .map((tm) => existingFrames.get(tm))
    .filter(Boolean)
    .sort((a, b) => a.tm.localeCompare(b.tm));

  const meta = {
    type: "RADAR_ECHO",
    cmp: config.radar_echo.cmp,
    render_version: RENDER_VERSION,
    updated_at: new Date().toISOString(),
    tm: latestTm,
    nationwide: frames.find((frame) => frame.tm === latestTm) || null,
    frames,
  };

  if (!meta.nationwide && frames.length) {
    meta.nationwide = frames[frames.length - 1];
  }

  const validNames = new Set(frames.map((frame) => path.basename(frame.path)));

  for (const filename of fs.readdirSync(radarDir)) {
    if (filename === "echo_korea.png") {
      fs.unlinkSync(path.join(radarDir, filename));
      continue;
    }
    if (/^echo_korea_\d{12}\.png$/.test(filename) && !validNames.has(filename)) {
      fs.unlinkSync(path.join(radarDir, filename));
    }
  }

  const metaPath = path.join(radarDir, "echo_meta.json");
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

function scheduleBackgroundFill(radarDir, pendingTms, existingFrames, latestTm, frameTms) {
  if (!pendingTms.length || backgroundFillRunning) return;

  backgroundFillRunning = true;
  setTimeout(async () => {
    try {
      for (const tm of pendingTms) {
        const filename = `echo_korea_${tm}.png`;
        const filePath = path.join(radarDir, filename);
        if (fs.existsSync(filePath) && existingFrames.get(tm)) continue;

        try {
          const frameInfo = await renderFrame(radarDir, tm);
          if (frameInfo) {
            existingFrames.set(tm, frameInfo);
            writeMeta(radarDir, latestTm, frameTms, existingFrames);
          }
        } catch (err) {
          console.warn(`radar_echo: failed background frame ${tm}:`, err.message);
        }
      }
    } finally {
      backgroundFillRunning = false;
    }
  }, 0);
}

async function process() {
  if (!config.api.auth_key) {
    throw new Error("Radar echo auth key missing (set API_AUTH_KEY)");
  }

  const radarDir = ensureRadarDir();
  const frameCount = config.radar_echo.max_images || 36;
  const candidates = getCandidateTms();
  const latestTm = candidates[0] || null;

  if (!latestTm) {
    return {
      type: "radar_echo",
      saved: false,
      reason: "no data available",
    };
  }

  const frameTms = buildFrameTms(latestTm, frameCount);

  const existingMeta = loadExistingMeta(radarDir);
  const sameCmp = existingMeta?.cmp === config.radar_echo.cmp;
  const sameRenderVersion = existingMeta?.render_version === RENDER_VERSION;
  const existingFrames = new Map(
    ((sameCmp && sameRenderVersion ? existingMeta?.frames : []) || []).map((frame) => [frame.tm, frame])
  );
  const missingTms = frameTms.filter((tm) => {
    const filename = `echo_korea_${tm}.png`;
    const filePath = path.join(radarDir, filename);
    return !(fs.existsSync(filePath) && existingFrames.get(tm));
  });

  const immediateTms = missingTms.slice(-IMMEDIATE_FRAME_COUNT);
  const deferredTms = missingTms.slice(0, -IMMEDIATE_FRAME_COUNT);

  for (const tm of immediateTms) {
    try {
      const frameInfo = await renderFrame(radarDir, tm);
      if (frameInfo) existingFrames.set(tm, frameInfo);
    } catch (err) {
      console.warn(`radar_echo: failed to render nationwide frame ${tm}:`, err.message);
    }
  }

  const meta = writeMeta(radarDir, latestTm, frameTms, existingFrames);
  scheduleBackgroundFill(radarDir, deferredTms, existingFrames, latestTm, frameTms);

  return {
    type: "radar_echo",
    saved: immediateTms.length > 0 || meta.frames.length > 0,
    frameCount: meta.frames.length,
    tm: meta.tm,
    deferredCount: deferredTms.length,
    backgroundFillRunning,
  };
}

export { process }
export default { process }
