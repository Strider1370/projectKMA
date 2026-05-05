import https from 'https'
import config from '../config.js'
import store from '../store.js'

const DAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];

function getKstShiftedDate(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function formatKstDate(value = Date.now()) {
  const kst = getKstShiftedDate(value);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatCompactKstDate(value = Date.now()) {
  const kst = getKstShiftedDate(value);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${hh}${mm}`;
}

function addKstDays(dateString, days) {
  const base = new Date(`${dateString}T00:00:00Z`);
  return formatKstDate(base.getTime() + days * 24 * 60 * 60 * 1000 - 9 * 60 * 60 * 1000);
}

function getDayLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return DAY_LABELS_KO[date.getUTCDay()] || "";
}

function createEmptyDay(dateString, todayString) {
  return {
    date: dateString,
    dayOfWeek: getDayLabel(dateString),
    isToday: dateString === todayString,
    am: null,
    pm: null,
    tempMin: null,
    tempMax: null,
    source: null,
  };
}

function createInitialForecastWindow(todayString) {
  return Array.from({ length: 7 }, (_, index) => createEmptyDay(addKstDays(todayString, index), todayString));
}

function safeNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildJsonUrl(endpoint, params) {
  const searchParams = new URLSearchParams({
    pageNo: "1",
    dataType: "JSON",
    authKey: config.api.auth_key,
    ...params,
  });
  return `${config.api.base_url}${endpoint}?${searchParams.toString()}`;
}

async function fetchJson(url, timeoutMs = config.ground_forecast.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
      }
      return JSON.parse(body);
    } catch (error) {
      if (error?.cause?.code !== "SELF_SIGNED_CERT_IN_CHAIN") {
        throw error;
      }
      return await fetchJsonViaHttpsRequest(url, timeoutMs);
    }
  } finally {
    clearTimeout(timer);
  }
}

function fetchJsonViaHttpsRequest(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      rejectUnauthorized: false,
      headers: {
        "User-Agent": "KMA-Weather-Dashboard/1.0"
      }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    request.end();
  });
}

function getResponseItems(payload) {
  const candidates = [
    payload?.response?.body?.items?.item,
    payload?.response?.body?.items,
    payload?.response?.items?.item,
    payload?.response?.items,
    payload?.body?.items?.item,
    payload?.body?.items,
    payload?.items?.item,
    payload?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return [candidate];
  }

  return [];
}

function mapShortNumEfToPeriod(announceTime, numEf) {
  const hour = Number(String(announceTime || "").slice(8, 10));
  if (!Number.isFinite(hour)) return null;

  let dayOffset;
  let period;

  if (hour === 5) {
    dayOffset = Math.floor(numEf / 2);
    period = numEf % 2 === 0 ? "am" : "pm";
  } else if (hour === 11 || hour === 17) {
    const adjusted = numEf + 1;
    dayOffset = Math.floor(adjusted / 2);
    period = numEf % 2 === 0 ? "pm" : "am";
  } else if (hour === 23) {
    dayOffset = Math.floor(numEf / 2) + 1;
    period = numEf % 2 === 0 ? "am" : "pm";
  } else {
    return null;
  }

  return { dayOffset, period, announceHour: hour };
}

function mapWeatherToIcon(weatherText, weatherCode = null, rainType = null) {
  if (weatherCode) {
    const baseIcon = {
      DB01: "sunny",
      DB02: "partly_cloudy",
      DB03: "mostly_cloudy",
      DB04: "cloudy",
    }[weatherCode] || "cloudy";

    if (rainType === 1) return "rain";
    if (rainType === 2) return "sleet";
    if (rainType === 3) return "snow";
    return baseIcon;
  }

  const text = String(weatherText || "");
  if (text.includes("비/눈") || text.includes("눈/비")) return "sleet";
  if (text.includes("소나기")) return "shower";
  if (text.includes("눈")) return "snow";
  if (text.includes("비")) return "rain";
  if (text.includes("흐림") || text.includes("흐리고")) return "cloudy";
  if (text.includes("구름많")) return "mostly_cloudy";
  if (text.includes("구름조금")) return "partly_cloudy";
  if (text.includes("맑음")) return "sunny";
  return "cloudy";
}

function createShortPeriod(item) {
  const weather = String(item?.wf || "").trim();
  if (!weather) return null;
  const weatherCode = String(item?.wfCd || "").trim() || null;
  const rainProb = safeNumber(item?.rnSt);
  const rainType = safeNumber(item?.rnYn);
  return {
    weather,
    weatherCode,
    rainProb,
    icon: mapWeatherToIcon(weather, weatherCode, rainType),
  };
}

function getLatestMidTmfc(now = new Date()) {
  const kst = getKstShiftedDate(now);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const base06 = new Date(Date.UTC(y, m, d, 6, 0, 0));
  const base18 = new Date(Date.UTC(y, m, d, 18, 0, 0));
  const nowMs = kst.getTime();
  const sixThirty = base06.getTime() + 30 * 60 * 1000;
  const eighteenThirty = base18.getTime() + 30 * 60 * 1000;
  let target;

  if (nowMs >= eighteenThirty) {
    target = base18;
  } else if (nowMs >= sixThirty) {
    target = base06;
  } else {
    target = new Date(base18.getTime() - 24 * 60 * 60 * 1000);
  }

  return formatCompactKstDate(target.getTime() - 9 * 60 * 60 * 1000);
}

function buildRequestCaches() {
  return {
    short: new Map(),
    midLand: new Map(),
    midTemp: new Map(),
  };
}

function getOrCreateRequest(cache, key, factory) {
  if (!cache.has(key)) {
    cache.set(key, factory());
  }
  return cache.get(key);
}

async function fetchShortForecast(regId, requestCaches) {
  return getOrCreateRequest(requestCaches.short, regId, async () => {
    const url = buildJsonUrl(config.ground_forecast.short_endpoint, {
      numOfRows: "50",
      regId,
    });
    const payload = await fetchJson(url);
    const items = getResponseItems(payload);
    if (items.length === 0) {
      throw new Error(`No short forecast items for regId ${regId}`);
    }
    return items;
  });
}

async function fetchMidLandForecast(regId, tmFc, requestCaches) {
  const key = `${regId}:${tmFc}`;
  return getOrCreateRequest(requestCaches.midLand, key, async () => {
    const url = buildJsonUrl(config.ground_forecast.mid_land_endpoint, {
      numOfRows: "10",
      regId,
      tmFc,
    });
    const payload = await fetchJson(url);
    const items = getResponseItems(payload);
    if (items.length === 0) {
      throw new Error(`No mid land forecast items for regId ${regId} tmFc ${tmFc}`);
    }
    return items[0];
  });
}

async function fetchMidTempForecast(regId, tmFc, requestCaches) {
  const key = `${regId}:${tmFc}`;
  return getOrCreateRequest(requestCaches.midTemp, key, async () => {
    const url = buildJsonUrl(config.ground_forecast.mid_temp_endpoint, {
      numOfRows: "10",
      regId,
      tmFc,
    });
    const payload = await fetchJson(url);
    const items = getResponseItems(payload);
    if (items.length === 0) {
      throw new Error(`No mid temp forecast items for regId ${regId} tmFc ${tmFc}`);
    }
    return items[0];
  });
}

function applyShortForecast(days, shortItems, todayString) {
  const announceTime = String(shortItems[0]?.announceTime || "");

  for (const item of shortItems) {
    const numEf = safeNumber(item?.numEf);
    if (!Number.isFinite(numEf)) continue;
    const mapped = mapShortNumEfToPeriod(announceTime, numEf);
    if (!mapped) continue;

    const dateString = addKstDays(todayString, mapped.dayOffset);
    const day = days.find((entry) => entry.date === dateString);
    if (!day) continue;

    const period = createShortPeriod(item);
    if (period) {
      day[mapped.period] = period;
      day.source = day.source || "short";
    }

    const temperature = safeNumber(item?.ta);
    if (temperature != null) {
      if (mapped.period === "am") day.tempMin = temperature;
      if (mapped.period === "pm") day.tempMax = temperature;
    }
  }

  return announceTime || null;
}

function applyMidForecast(days, midLandItem, midTempItem, todayString) {
  for (let offset = 4; offset <= 6; offset += 1) {
    const dateString = addKstDays(todayString, offset);
    const day = days.find((entry) => entry.date === dateString);
    if (!day) continue;
    if (day.source === "short") continue;

    if (midLandItem) {
      const amWeather = String(midLandItem?.[`wf${offset}Am`] || "").trim();
      const pmWeather = String(midLandItem?.[`wf${offset}Pm`] || "").trim();
      const amRainProb = safeNumber(midLandItem?.[`rnSt${offset}Am`]);
      const pmRainProb = safeNumber(midLandItem?.[`rnSt${offset}Pm`]);

      day.am = amWeather
        ? { weather: amWeather, weatherCode: null, rainProb: amRainProb, icon: mapWeatherToIcon(amWeather) }
        : day.am;
      day.pm = pmWeather
        ? { weather: pmWeather, weatherCode: null, rainProb: pmRainProb, icon: mapWeatherToIcon(pmWeather) }
        : day.pm;
    }

    if (midTempItem) {
      day.tempMin = safeNumber(midTempItem?.[`taMin${offset}`]);
      day.tempMax = safeNumber(midTempItem?.[`taMax${offset}`]);
    }

    if (midLandItem || midTempItem) {
      day.source = day.source || "mid";
    }
  }
}

function countForecastCoverage(forecast) {
  return (forecast || []).reduce((sum, day) => {
    return sum
      + (day?.am ? 1 : 0)
      + (day?.pm ? 1 : 0)
      + (day?.tempMin != null ? 1 : 0)
      + (day?.tempMax != null ? 1 : 0);
  }, 0);
}

function mergeMissingWithPreviousForecast(nextForecast, previousForecast) {
  if (!Array.isArray(previousForecast) || previousForecast.length === 0) {
    return { forecast: nextForecast, usedPrevious: false };
  }

  const previousByDate = new Map(previousForecast.map((day) => [day.date, day]));
  let usedPrevious = false;
  const merged = nextForecast.map((day) => {
    const previous = previousByDate.get(day.date);
    if (!previous) return day;

    const mergedDay = {
      ...day,
      am: day.am || previous.am || null,
      pm: day.pm || previous.pm || null,
      tempMin: day.tempMin != null ? day.tempMin : (previous.tempMin ?? null),
      tempMax: day.tempMax != null ? day.tempMax : (previous.tempMax ?? null),
      source: day.source || previous.source || null,
    };
    if (
      mergedDay.am !== day.am ||
      mergedDay.pm !== day.pm ||
      mergedDay.tempMin !== day.tempMin ||
      mergedDay.tempMax !== day.tempMax
    ) {
      usedPrevious = true;
    }
    return mergedDay;
  });

  return { forecast: merged, usedPrevious };
}

function buildAirportResult(icao, shortItems, midLandItem, midTempItem, previousAirport, tmFc, sourceStatus) {
  const todayString = formatKstDate();
  const baseForecast = createInitialForecastWindow(todayString);

  if (Array.isArray(shortItems) && shortItems.length > 0) {
    const announceTime = applyShortForecast(baseForecast, shortItems, todayString);
    sourceStatus.short = {
      ...sourceStatus.short,
      ok: true,
      announce_time: announceTime,
    };
  }

  if (midLandItem || midTempItem) {
    applyMidForecast(baseForecast, midLandItem, midTempItem, todayString);
  }

  const merged = mergeMissingWithPreviousForecast(baseForecast, previousAirport?.forecast || []);
  const nextScore = countForecastCoverage(merged.forecast);
  const previousScore = countForecastCoverage(previousAirport?.forecast || []);
  const hasFailedSource = Object.values(sourceStatus).some((status) => status?.ok === false);
  const qualityDropTolerance = Number(config.ground_forecast.quality_drop_tolerance || 0);

  if (previousAirport && (nextScore === 0 || (hasFailedSource && nextScore + qualityDropTolerance < previousScore))) {
    return {
      ...previousAirport,
      icao,
      source_status: sourceStatus,
      _stale: true,
    };
  }

  return {
    icao,
    forecast: merged.forecast,
    source_status: sourceStatus,
    tmFc,
    coverage_score: nextScore,
    _stale: merged.usedPrevious,
  };
}

async function process() {
  const result = {
    type: "ground_forecast",
    fetched_at: new Date().toISOString(),
    airports: {},
  };
  const requestCaches = buildRequestCaches();
  const tmFc = getLatestMidTmfc(new Date(result.fetched_at));
  const previous = store.getCached("ground_forecast");
  const airportErrors = {};
  const failedAirports = [];

  for (const airport of config.airports) {
    const icao = airport.icao;
    const mapping = config.ground_forecast.airports[icao];
    const previousAirport = previous?.airports?.[icao] || null;

    if (!mapping) {
      failedAirports.push(icao);
      airportErrors[icao] = "Missing ground forecast regId mapping";
      if (previousAirport) {
        result.airports[icao] = {
          ...previousAirport,
          icao,
          _stale: true,
        };
      }
      continue;
    }

    const sourceStatus = {
      short: { ok: false, regId: mapping.short_reg_id, error: null },
      mid_land: { ok: false, regId: mapping.mid_land_reg_id, tmFc, error: null },
      mid_ta: { ok: false, regId: mapping.mid_temp_reg_id, tmFc, error: null },
    };

    let shortItems = null;
    let midLandItem = null;
    let midTempItem = null;

    try {
      shortItems = await fetchShortForecast(mapping.short_reg_id, requestCaches);
      sourceStatus.short.ok = true;
    } catch (error) {
      sourceStatus.short.error = error.message || "Unknown error";
    }

    try {
      midLandItem = await fetchMidLandForecast(mapping.mid_land_reg_id, tmFc, requestCaches);
      sourceStatus.mid_land.ok = true;
    } catch (error) {
      sourceStatus.mid_land.error = error.message || "Unknown error";
    }

    try {
      midTempItem = await fetchMidTempForecast(mapping.mid_temp_reg_id, tmFc, requestCaches);
      sourceStatus.mid_ta.ok = true;
    } catch (error) {
      sourceStatus.mid_ta.error = error.message || "Unknown error";
    }

    const airportResult = buildAirportResult(icao, shortItems, midLandItem, midTempItem, previousAirport, tmFc, sourceStatus);
    result.airports[icao] = airportResult;

    if (Object.values(sourceStatus).some((status) => status.ok === false)) {
      failedAirports.push(icao);
      airportErrors[icao] = Object.entries(sourceStatus)
        .filter(([, status]) => status.ok === false)
        .map(([key, status]) => `${key}: ${status.error || "failed"}`)
        .join("; ");
    }
  }

  const hasAnyForecast = Object.values(result.airports).some((airport) => countForecastCoverage(airport?.forecast || []) > 0);
  if (!hasAnyForecast) {
    throw new Error("Ground forecast fetch returned no usable airport forecasts");
  }

  const saveResult = store.save("ground_forecast", result);
  return {
    type: "ground_forecast",
    saved: saveResult.saved,
    filePath: saveResult.filePath || null,
    airports: Object.keys(result.airports).length,
    failedAirports,
    airportErrors,
  };
}

export { process, getLatestMidTmfc, mapShortNumEfToPeriod, mapWeatherToIcon }
export default { process, getLatestMidTmfc, mapShortNumEfToPeriod, mapWeatherToIcon }
