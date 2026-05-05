import config from '../config.js'
import store from '../store.js'
import amosParser from '../parsers/amos-parser.js'

function formatKstMinuteTm(isoOrDate) {
  const base = new Date(isoOrDate || Date.now());
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCSeconds(0, 0);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${hh}${mm}`;
}

function buildAmosUrl(stn, tm) {
  const params = new URLSearchParams({
    tm,
    dtm: String(config.amos.dtm_minutes),
    stn: String(stn),
    help: "1",
    authKey: config.api.auth_key,
  });
  return `${config.api.amos_url}?${params.toString()}`;
}

async function fetchAmosText(url, timeoutMs = config.amos.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`AMOS HTTP ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function emptyDailyRainfall(targetTm, stale) {
  return {
    mm: null,
    rn_raw: null,
    observed_tm_kst: null,
    target_tm_kst: targetTm,
    stale,
  };
}

async function process() {
  const result = {
    type: "AMOS",
    fetched_at: new Date().toISOString(),
    airports: {},
  };

  const failedAirports = [];
  const airportErrors = {};
  const targetTm = formatKstMinuteTm(result.fetched_at);

  for (const airport of config.airports) {
    const stn = airport.amos_stn;
    if (stn == null) {
      result.airports[airport.icao] = {
        icao: airport.icao,
        amos_stn: null,
        daily_rainfall: emptyDailyRainfall(targetTm, false),
      };
      continue;
    }

    try {
      const amosUrl = buildAmosUrl(stn, targetTm);
      const amosText = await fetchAmosText(amosUrl);
      const rows = amosParser.parseAmosRows(amosText);
      result.airports[airport.icao] = {
        icao: airport.icao,
        amos_stn: stn,
        daily_rainfall: amosParser.pickDailyRainfallAtTime(
          rows,
          targetTm,
          config.amos.stale_tolerance_minutes
        ) || emptyDailyRainfall(targetTm, true),
      };
    } catch (error) {
      failedAirports.push(airport.icao);
      airportErrors[airport.icao] = error.message || "Unknown error";
    }
  }

  if (failedAirports.length > 0) {
    store.mergeWithPrevious(result, "amos", failedAirports);
  }

  const saveResult = store.save("amos", result);
  return {
    type: "amos",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    total: Object.keys(result.airports).length,
    failedAirports,
    airportErrors,
  };
}

export { process }
export default { process }
