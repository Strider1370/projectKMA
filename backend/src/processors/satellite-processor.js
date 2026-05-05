import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import config from '../config.js'
import { parseSatelliteNC, parseFogNC, renderFogImage } from '../parsers/satellite-parser.js'

let backgroundFillRunning = false;
const fogRetryTimers = new Map();
const RENDER_VERSION = "fog-composite-v3-kst-tm-webp";
const IMMEDIATE_FRAME_COUNT = 2;
const FOG_RETRY_DELAY_MS = 3 * 60 * 1000;
const MAX_FOG_RETRIES = 2;

function ensureSatelliteDir() {
  const dir = path.join(config.storage.base_path, "satellite");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function formatUtcTm(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${h}${mi}`;
}

function formatKstTm(dateUtc) {
  const dateKst = new Date(dateUtc.getTime() + 9 * 60 * 60 * 1000);
  return formatUtcTm(dateKst);
}

function getCandidateTms(delayMinutes = config.satellite.delay_minutes) {
  const now = new Date();
  const delayed = new Date(now.getTime() - delayMinutes * 60 * 1000);

  const minute = Math.floor(delayed.getUTCMinutes() / 10) * 10;
  delayed.setUTCMinutes(minute, 0, 0);

  return [0, 1, 2].map((i) => {
    const t = new Date(delayed.getTime() - i * 10 * 60 * 1000);
    return {
      requestTm: formatUtcTm(t),
      displayTm: formatKstTm(t),
    };
  });
}

function buildIrUrl(tm) {
  const channel = config.satellite.channel;
  const region = config.satellite.region;
  return `${config.satellite.url}/${channel}/${region}/data?date=${tm}&authKey=${config.api.auth_key}`;
}

function buildFogUrl(tm) {
  const product = config.satellite.fog_product;
  const region = config.satellite.region;
  return `${config.satellite.fog_url}/${product}/${region}/data?date=${tm}&authKey=${config.api.auth_key}`;
}

async function fetchWithTimeout(url, ms = config.satellite.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNC(url) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // HDF5 magic bytes: 0x89 0x48 0x44 0x46
    if (buffer.length < 1000 || buffer[0] !== 0x89 || buffer[1] !== 0x48 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
      return null;
    }
    return buffer;
  } catch (error) {
    return null;
  }
}

function loadExistingMeta(satDir) {
  const metaPath = path.join(satDir, "sat_meta.json");
  if (!fs.existsSync(metaPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function buildFrameSpecs(latestRequestTm, frameCount) {
  const frameSpecs = [];
  const latestDate = new Date(Date.UTC(
    Number(latestRequestTm.slice(0, 4)),
    Number(latestRequestTm.slice(4, 6)) - 1,
    Number(latestRequestTm.slice(6, 8)),
    Number(latestRequestTm.slice(8, 10)),
    Number(latestRequestTm.slice(10, 12)),
    0,
    0
  ));

  for (let i = frameCount - 1; i >= 0; i--) {
    const frameDate = new Date(latestDate.getTime() - i * 10 * 60 * 1000);
    frameSpecs.push({
      requestTm: formatUtcTm(frameDate),
      displayTm: formatKstTm(frameDate),
    });
  }

  return frameSpecs;
}

async function renderFrame(satDir, requestTm, displayTm) {
  const filename = `sat_korea_${displayTm}.webp`;
  const filePath = path.join(satDir, filename);

  // Fetch both IR105 and FOG NC files in parallel
  const [irBuffer, fogBuffer] = await Promise.all([
    fetchNC(buildIrUrl(requestTm)),
    fetchNC(buildFogUrl(requestTm)),
  ]);

  // IR is required; FOG is optional (composite still shows IR background)
  if (!irBuffer) return null;

  const irParsed = await parseSatelliteNC(irBuffer);

  let result;
  let hasFogData = false;
  if (fogBuffer) {
    const fogParsed = await parseFogNC(fogBuffer);
    result = await renderFogImage(irParsed, fogParsed);
    hasFogData = true;
  } else {
    // FOG unavailable — render IR-only by passing null fog data
    result = await renderFogImage(irParsed, { fogData: null, delFta: null });
  }

  const webpBuffer = await sharp(result.pngBuffer)
    .webp({ quality: 90, effort: 6 })
    .toBuffer();

  fs.writeFileSync(filePath, webpBuffer);

  return {
    tm: displayTm,
    request_tm_utc: requestTm,
    product: "FOG",
    channel: config.satellite.channel,
    render_version: RENDER_VERSION,
    path: `/data/satellite/${filename}`,
    bounds: result.bounds,
    width: result.width,
    height: result.height,
    fogPixelCount: hasFogData ? result.fogPixelCount : null,
  };
}

function writeMeta(satDir, latestFrameSpec, frameSpecs, existingFrames) {
  const frames = frameSpecs
    .map((frame) => existingFrames.get(frame.displayTm))
    .filter(Boolean)
    .sort((a, b) => a.tm.localeCompare(b.tm));

  const meta = {
    type: "SATELLITE",
    product: "FOG",
    channel: config.satellite.channel,
    region: config.satellite.region,
    render_version: RENDER_VERSION,
    updated_at: new Date().toISOString(),
    tm: latestFrameSpec.displayTm,
    request_tm_utc: latestFrameSpec.requestTm,
    latest: frames.find((frame) => frame.tm === latestFrameSpec.displayTm) || null,
    frames,
  };

  if (!meta.latest && frames.length) {
    meta.latest = frames[frames.length - 1];
  }

  const validNames = new Set(frames.map((frame) => path.basename(frame.path)));

  for (const filename of fs.readdirSync(satDir)) {
    if (/^sat_korea_\d{12}\.(?:png|webp)$/.test(filename) && !validNames.has(filename)) {
      fs.unlinkSync(path.join(satDir, filename));
    }
  }

  const metaPath = path.join(satDir, "sat_meta.json");
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

function scheduleFogRetry(satDir, frameSpec, frameSpecs, attempt = 1) {
  if (!frameSpec?.displayTm || attempt > MAX_FOG_RETRIES || fogRetryTimers.has(frameSpec.displayTm)) {
    return;
  }

  const timer = setTimeout(async () => {
    fogRetryTimers.delete(frameSpec.displayTm);

    try {
      const existingMeta = loadExistingMeta(satDir);
      if (existingMeta?.render_version !== RENDER_VERSION) {
        return;
      }

      const existingFrames = new Map((existingMeta.frames || []).map((frame) => [frame.tm, frame]));
      const currentFrame = existingFrames.get(frameSpec.displayTm);
      if (currentFrame && currentFrame.fogPixelCount !== null) {
        return;
      }

      const frameInfo = await renderFrame(satDir, frameSpec.requestTm, frameSpec.displayTm);
      if (!frameInfo) {
        return;
      }

      existingFrames.set(frameSpec.displayTm, frameInfo);
      writeMeta(satDir, frameSpec, frameSpecs, existingFrames);

      if (frameInfo.fogPixelCount === null && attempt < MAX_FOG_RETRIES) {
        scheduleFogRetry(satDir, frameSpec, frameSpecs, attempt + 1);
      }
    } catch (error) {
      console.warn(`satellite: fog retry failed ${frameSpec.requestTm} (#${attempt}):`, error.message);
      if (attempt < MAX_FOG_RETRIES) {
        scheduleFogRetry(satDir, frameSpec, frameSpecs, attempt + 1);
      }
    }
  }, FOG_RETRY_DELAY_MS);

  fogRetryTimers.set(frameSpec.displayTm, timer);
}

function scheduleBackgroundFill(satDir, pendingFrameSpecs, existingFrames, latestFrameSpec, frameSpecs) {
  if (!pendingFrameSpecs.length || backgroundFillRunning) return;

  backgroundFillRunning = true;
  setTimeout(async () => {
    try {
      for (const frameSpec of pendingFrameSpecs) {
        const filename = `sat_korea_${frameSpec.displayTm}.webp`;
        const filePath = path.join(satDir, filename);
        if (fs.existsSync(filePath) && existingFrames.get(frameSpec.displayTm)) continue;

        try {
          const frameInfo = await renderFrame(satDir, frameSpec.requestTm, frameSpec.displayTm);
          if (frameInfo) {
            existingFrames.set(frameSpec.displayTm, frameInfo);
            writeMeta(satDir, latestFrameSpec, frameSpecs, existingFrames);
          }
        } catch (err) {
          console.warn(`satellite: failed background frame ${frameSpec.requestTm}:`, err.message);
        }
      }
    } finally {
      backgroundFillRunning = false;
    }
  }, 0);
}

async function process() {
  if (!config.api.auth_key) {
    throw new Error("Satellite auth key missing (set API_AUTH_KEY)");
  }

  const satDir = ensureSatelliteDir();
  const frameCount = config.satellite.max_frames || 18;
  const candidates = getCandidateTms();
  const latestFrameSpec = candidates[0] || null;

  if (!latestFrameSpec) {
    return {
      type: "satellite",
      saved: false,
      reason: "no data available",
    };
  }

  const frameSpecs = buildFrameSpecs(latestFrameSpec.requestTm, frameCount);

  const existingMeta = loadExistingMeta(satDir);
  const sameRenderVersion = existingMeta?.render_version === RENDER_VERSION;
  const existingFrames = new Map(
    ((sameRenderVersion ? existingMeta?.frames : []) || []).map((frame) => [frame.tm, frame])
  );
  const missingFrameSpecs = frameSpecs.filter((frameSpec) => {
    const filename = `sat_korea_${frameSpec.displayTm}.webp`;
    const filePath = path.join(satDir, filename);
    if (!fs.existsSync(filePath) || !existingFrames.get(frameSpec.displayTm)) return true;
    // Re-render frames where FOG fetch failed (fogPixelCount=null means FOG NC was unavailable)
    const frame = existingFrames.get(frameSpec.displayTm);
    if (frame.fogPixelCount === null) return true;
    return false;
  });

  const immediateFrameSpecs = missingFrameSpecs.slice(-IMMEDIATE_FRAME_COUNT);
  const deferredFrameSpecs = missingFrameSpecs.slice(0, -IMMEDIATE_FRAME_COUNT);

  for (const frameSpec of immediateFrameSpecs) {
    try {
      const frameInfo = await renderFrame(satDir, frameSpec.requestTm, frameSpec.displayTm);
      if (frameInfo) existingFrames.set(frameSpec.displayTm, frameInfo);
    } catch (err) {
      console.warn(`satellite: failed to render frame ${frameSpec.requestTm}:`, err.message);
    }
  }

  const meta = writeMeta(satDir, latestFrameSpec, frameSpecs, existingFrames);
  scheduleBackgroundFill(satDir, deferredFrameSpecs, existingFrames, latestFrameSpec, frameSpecs);

  const latestFrame = existingFrames.get(latestFrameSpec.displayTm);
  if (latestFrame?.fogPixelCount === null) {
    scheduleFogRetry(satDir, latestFrameSpec, frameSpecs);
  }

  return {
    type: "satellite",
    saved: immediateFrameSpecs.length > 0 || meta.frames.length > 0,
    frameCount: meta.frames.length,
    tm: meta.tm,
    request_tm_utc: meta.request_tm_utc,
    deferredCount: deferredFrameSpecs.length,
    backgroundFillRunning,
  };
}

export { process }
export default { process }
