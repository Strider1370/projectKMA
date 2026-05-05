import path from 'path'
import config from '../config.js'
import store from '../store.js'
import lightningParser from '../parsers/lightning-parser.js'

const LIGHTNING_HISTORY_WINDOW_MINUTES = 240;
const LIGHTNING_BACKFILL_STEP_MINUTES = 5;

function formatKstTm(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const h = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}`;
}

function getCurrentKstTm() {
  return formatKstTm(new Date());
}

function getAlignedKstTm(stepMinutes = config.lightning.itv_minutes) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCSeconds(0, 0);
  const minute = kst.getUTCMinutes();
  kst.setUTCMinutes(minute - (minute % stepMinutes));
  return formatKstTm(new Date(kst.getTime() - 9 * 60 * 60 * 1000));
}

function kstTmToUtcDate(tm) {
  const raw = String(tm || "");
  if (!/^\d{12}$/.test(raw)) {
    throw new Error(`Invalid KST tm: ${tm}`);
  }
  return new Date(Date.UTC(
    Number(raw.slice(0, 4)),
    Number(raw.slice(4, 6)) - 1,
    Number(raw.slice(6, 8)),
    Number(raw.slice(8, 10)) - 9,
    Number(raw.slice(10, 12)),
    0,
    0
  ));
}

function shiftKstTm(tm, deltaMinutes) {
  const shifted = new Date(kstTmToUtcDate(tm).getTime() + deltaMinutes * 60 * 1000);
  return formatKstTm(shifted);
}

function buildBackfillTms(baseTm, windowMinutes = LIGHTNING_HISTORY_WINDOW_MINUTES, stepMinutes = config.lightning.itv_minutes) {
  const steps = Math.ceil(windowMinutes / stepMinutes);
  const tms = [];
  for (let index = steps - 1; index >= 0; index -= 1) {
    tms.push(shiftKstTm(baseTm, -index * stepMinutes));
  }
  return tms;
}

function buildNationwideLightningUrl(tm) {
  const nationwide = config.lightning.nationwide || {};
  const params = new URLSearchParams({
    tm,
    itv: String(config.lightning.itv_minutes),
    lon: String(nationwide.lon),
    lat: String(nationwide.lat),
    range: String(nationwide.range_km),
    gc: "T",
    authKey: config.api.auth_key,
  });
  return `${config.api.lightning_url}?${params.toString()}`;
}

const LIGHTNING_TIMEOUT_MS = 30000;
const LIGHTNING_MAX_RETRIES = 3;
const LIGHTNING_RETRY_DELAY_MS = 3000;

async function fetchWithTimeout(url, timeoutMs = LIGHTNING_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= LIGHTNING_MAX_RETRIES; attempt += 1) {
    try {
      return await fetchWithTimeout(url);
    } catch (err) {
      lastError = err;
      if (attempt < LIGHTNING_MAX_RETRIES) {
        await new Promise((res) => setTimeout(res, LIGHTNING_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

function buildStrikeKey(strike) {
  return [
    strike.time || "",
    strike.lon ?? "",
    strike.lat ?? "",
    strike.type || "",
    strike.intensity ?? "",
  ].join("|");
}

function mergeRecentStrikes(previousStrikes, incomingStrikes, nowMs) {
  const cutoffMs = nowMs - (LIGHTNING_HISTORY_WINDOW_MINUTES * 60 * 1000);
  const merged = new Map();

  for (const strike of previousStrikes || []) {
    const timeMs = new Date(strike.time).getTime();
    if (!Number.isFinite(timeMs) || timeMs < cutoffMs) continue;
    merged.set(buildStrikeKey(strike), strike);
  }

  for (const strike of incomingStrikes || []) {
    const timeMs = new Date(strike.time).getTime();
    if (!Number.isFinite(timeMs) || timeMs < cutoffMs) continue;
    merged.set(buildStrikeKey(strike), strike);
  }

  return Array.from(merged.values()).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

function summarize(strikes) {
  const byZone = { alert: 0, danger: 0, caution: 0 };
  const byType = { ground: 0, cloud: 0 };
  let maxIntensity = null;
  let latestTime = null;

  for (const strike of strikes) {
    if (byZone[strike.zone] != null) byZone[strike.zone] += 1;
    if (strike.type === "G") byType.ground += 1;
    if (strike.type === "C") byType.cloud += 1;
    if (maxIntensity == null || strike.intensity_abs > maxIntensity) {
      maxIntensity = strike.intensity_abs;
    }
    if (latestTime == null || new Date(strike.time).getTime() > new Date(latestTime).getTime()) {
      latestTime = strike.time;
    }
  }

  return {
    total_count: strikes.length,
    by_zone: byZone,
    by_type: byType,
    max_intensity: maxIntensity,
    latest_time: latestTime,
  };
}

function classifyForAirport(strikes, airport, zones) {
  return strikes
    .map((strike) => lightningParser.classifyStrike(strike, airport, zones))
    .filter((strike) => strike.zone !== "outside")
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

function buildAirportPayloads(strikes) {
  const airports = {};

  for (const airport of config.airports) {
    const airportStrikes = classifyForAirport(strikes, airport, config.lightning.zones);
    airports[airport.icao] = {
      airport_name: airport.name,
      arp: { lat: airport.lat, lon: airport.lon },
      summary: summarize(airportStrikes),
      strikes: airportStrikes,
    };
  }

  return airports;
}

function emptyNationwidePayload() {
  return {
    summary: {
      total_count: 0,
      by_zone: { alert: 0, danger: 0, caution: 0 },
      by_type: { ground: 0, cloud: 0 },
      max_intensity: null,
      latest_time: null,
    },
    strikes: [],
  };
}

function buildLightningResult(tm, strikes, extraQuery = {}) {
  const airports = buildAirportPayloads(strikes);
  return {
    type: "lightning",
    fetched_at: new Date().toISOString(),
    query: {
      tm,
      itv_minutes: config.lightning.itv_minutes,
      nationwide_range_km: config.lightning.nationwide?.range_km || null,
      ...extraQuery,
    },
    history_window_minutes: LIGHTNING_HISTORY_WINDOW_MINUTES,
    airports,
    nationwide: {
      summary: summarize(strikes),
      strikes,
    },
  };
}

function buildProcessResponse(result, saveResult, airportErrors = {}) {
  return {
    type: "lightning",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    airports: Object.keys(result.airports || {}).length,
    nationwideStrikes: Number(result.nationwide?.summary?.total_count || 0),
    totalStrikes: Number(result.nationwide?.summary?.total_count || 0),
    failedAirports: [],
    airportErrors,
  };
}

async function fetchNationwideStrikes(tm) {
  const rawNationwide = await fetchWithRetry(buildNationwideLightningUrl(tm));
  const nationwidePoint = {
    lat: config.lightning.nationwide?.lat,
    lon: config.lightning.nationwide?.lon,
  };
  return lightningParser.parse(
    rawNationwide,
    nationwidePoint,
    config.lightning.zones,
    { classify: false }
  );
}

const INCREMENTAL_LOOKBACK_STEPS = 12; // 12 × 5min = 60분치 window 조회

async function process() {
  const baseTm = shiftKstTm(getAlignedKstTm(), -config.lightning.itv_minutes);
  const previous = store.loadLatest(path.join(config.storage.base_path, "lightning"));
  const nowMs = Date.now();

  // 현재 기준 최대 60분 이전까지 window 목록 생성
  const tms = [];
  for (let i = INCREMENTAL_LOOKBACK_STEPS - 1; i >= 0; i--) {
    tms.push(shiftKstTm(baseTm, -i * config.lightning.itv_minutes));
  }

  const merged = new Map();
  for (const strike of mergeRecentStrikes(previous?.nationwide?.strikes || [], [], nowMs)) {
    merged.set(buildStrikeKey(strike), strike);
  }

  const failedTms = [];
  let fetchedCount = 0;

  for (const tm of tms) {
    try {
      const strikes = await fetchNationwideStrikes(tm);
      for (const strike of strikes) {
        const timeMs = new Date(strike.time).getTime();
        if (!Number.isFinite(timeMs) || timeMs < nowMs - LIGHTNING_HISTORY_WINDOW_MINUTES * 60 * 1000) continue;
        merged.set(buildStrikeKey(strike), strike);
      }
      fetchedCount++;
    } catch {
      failedTms.push(tm);
    }
  }

  if (fetchedCount === 0 && previous) {
    return buildProcessResponse(previous, { saved: false, reason: "fetch_failed" }, { nationwide: `all ${tms.length} windows failed` });
  }

  const mergedStrikes = Array.from(merged.values())
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const result = buildLightningResult(baseTm, mergedStrikes);
  const saveResult = store.save("lightning", result);
  return {
    ...buildProcessResponse(result, saveResult, failedTms.length ? { nationwide: `${failedTms.length}/${tms.length} windows failed` } : {}),
    fetchedWindows: fetchedCount,
    failedWindows: failedTms.length,
  };
}

async function processBackfill() {
  const baseTm = getAlignedKstTm(LIGHTNING_BACKFILL_STEP_MINUTES);
  const tms = buildBackfillTms(baseTm, LIGHTNING_HISTORY_WINDOW_MINUTES, LIGHTNING_BACKFILL_STEP_MINUTES);
  const merged = new Map();
  const failedTms = [];
  const nowMs = Date.now();

  for (const tm of tms) {
    try {
      const strikes = await fetchNationwideStrikes(tm);
      for (const strike of mergeRecentStrikes([], strikes, nowMs)) {
        merged.set(buildStrikeKey(strike), strike);
      }
    } catch (error) {
      failedTms.push({ tm, error: error.message || "Unknown error" });
    }
  }

  if (merged.size === 0 && failedTms.length === tms.length) {
    throw new Error(`Lightning backfill failed for all windows (${failedTms.length})`);
  }

  const mergedNationwideStrikes = mergeRecentStrikes([], Array.from(merged.values()), nowMs);
  const result = buildLightningResult(baseTm, mergedNationwideStrikes, {
    backfill: true,
    backfill_from_tm: tms[0] || null,
    backfill_to_tm: tms[tms.length - 1] || null,
  });
  const saveResult = store.save("lightning", result);

  return {
    ...buildProcessResponse(result, saveResult, failedTms.length ? { backfill: `${failedTms.length} windows failed` } : {}),
    backfillWindows: tms.length,
    failedWindows: failedTms.length,
    failedTms,
  };
}

export { process, processBackfill }
export default { process, processBackfill }
