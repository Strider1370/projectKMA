import config from '../config.js'
import store from '../store.js'

function formatKstObservationHour(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  return `${y}${m}${d}${hh}00`;
}

async function fetchJson(url, timeoutMs = config.environment.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = config.environment.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenMeteoEnvironment(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "pm10,pm2_5,uv_index",
    timezone: "Asia/Seoul",
  });
  const payload = await fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`);
  const current = payload?.current;
  if (!current || typeof current !== "object") return null;
  return {
    observedAt: current.time || null,
    pm10: Number(current.pm10),
    pm25: Number(current.pm2_5),
    uv: Number(current.uv_index),
  };
}

function getPmGradeLabel(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 30) return "좋음";
  if (value <= 80) return "보통";
  if (value <= 150) return "나쁨";
  return "매우나쁨";
}

function getPm25GradeLabel(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 15) return "좋음";
  if (value <= 35) return "보통";
  if (value <= 75) return "나쁨";
  return "매우나쁨";
}

function getUvGradeLabel(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 3) return "낮음";
  if (value < 6) return "보통";
  if (value < 8) return "높음";
  if (value < 11) return "매우높음";
  return "위험";
}

function isNightTimeKst(observedAtKst) {
  const normalized = String(observedAtKst || "").trim();
  if (!/^\d{12}$/.test(normalized)) return false;
  const hour = Number(normalized.slice(8, 10));
  if (!Number.isFinite(hour)) return false;
  return hour < 6 || hour >= 19;
}

function isCardSafeUvValue(value, observedAtKst) {
  if (!Number.isFinite(value) || value < 0) return false;
  if (isNightTimeKst(observedAtKst) && value > 11) return false;
  return true;
}

function parseItems(payload) {
  const items = payload?.response?.body?.items?.item;
  if (Array.isArray(items)) return items;
  if (items && typeof items === "object") return [items];
  return [];
}

async function fetchPmForAirport(icao) {
  const serviceKey = config.api.airkorea_key ? decodeURIComponent(config.api.airkorea_key) : "";
  const stationName = config.environment.pm_station_by_airport?.[icao];
  if (!serviceKey || !stationName) return null;

  const params = new URLSearchParams({
    serviceKey,
    returnType: "json",
    numOfRows: "1",
    pageNo: "1",
    stationName,
    dataTerm: "DAILY",
    ver: "1.4",
  });
  const payload = await fetchJson(`${config.api.airkorea_pm_url}?${params.toString()}`);
  const item = parseItems(payload)[0];
  if (!item) return null;

  const pm10 = Number(item.pm10Value);
  const pm25 = Number(item.pm25Value);
  return {
    stationName,
    observedAt: item.dataTime || null,
    pm10: Number.isFinite(pm10) ? { value: pm10, grade: getPmGradeLabel(pm10) } : null,
    pm25: Number.isFinite(pm25) ? { value: pm25, grade: getPm25GradeLabel(pm25) } : null,
  };
}

async function fetchUvForAirport(icao) {
  const authKey = config.api.kma_uv_key;
  const station = config.environment.uv_station_by_airport?.[icao];
  if (!authKey || !station?.stn) return null;

  const params = new URLSearchParams({
    tm: formatKstObservationHour(),
    stn: String(station.stn),
    authKey,
  });
  const text = await fetchText(`${config.api.kma_uv_url}?${params.toString()}`);
  const lines = text.split(/\r?\n/).filter(Boolean).filter((line) => !line.startsWith("#"));
  const row = lines.find((line) => line.trim().startsWith(formatKstObservationHour()));
  if (!row) return null;
  const parts = row.trim().split(/\s+/);
  const observedAtKst = parts[0] || null;
  const uvIndex = Number(parts[5]);
  if (!isCardSafeUvValue(uvIndex, observedAtKst)) return null;
  return {
    stationName: station.name,
    stationId: station.stn,
    observedAtKst,
    value: Number.isFinite(uvIndex) ? uvIndex : null,
    grade: Number.isFinite(uvIndex) ? getUvGradeLabel(uvIndex) : null,
  };
}

async function process() {
  const result = {
    type: "environment",
    fetched_at: new Date().toISOString(),
    airports: {},
  };

  for (const airport of config.airports) {
    const [pm, uv, openMeteo] = await Promise.allSettled([
      fetchPmForAirport(airport.icao),
      fetchUvForAirport(airport.icao),
      fetchOpenMeteoEnvironment(airport.lat, airport.lon),
    ]);

    const pmPrimary = pm.status === "fulfilled" ? pm.value : null;
    const uvPrimary = uv.status === "fulfilled" ? uv.value : null;
    const fallback = openMeteo.status === "fulfilled" ? openMeteo.value : null;

    const pmValue = pmPrimary || (fallback ? {
      stationName: "Open-Meteo",
      observedAt: fallback.observedAt,
      pm10: Number.isFinite(fallback.pm10) ? { value: fallback.pm10, grade: getPmGradeLabel(fallback.pm10) } : null,
      pm25: Number.isFinite(fallback.pm25) ? { value: fallback.pm25, grade: getPm25GradeLabel(fallback.pm25) } : null,
      source: "fallback",
    } : null);

    const uvValue = uvPrimary || (fallback && Number.isFinite(fallback.uv) ? {
      stationName: "Open-Meteo",
      stationId: null,
      observedAtKst: fallback.observedAt,
      value: fallback.uv,
      grade: getUvGradeLabel(fallback.uv),
      source: "fallback",
    } : null);

    result.airports[airport.icao] = {
      icao: airport.icao,
      pm: pmValue,
      uv: uvValue,
    };
  }

  const saveResult = store.save("environment", result);
  return {
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
  };
}

export { process }
export default { process }
