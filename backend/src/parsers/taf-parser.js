import { XMLParser } from 'fast-xml-parser'
import { toArray,
  text,
  number,
  lastToken,
  parseCloudLayer,
  parseWeatherCode,
  parseWind,
  resolveWeatherIconKey,
  pickPrimaryWeatherIcon,
  resolveDdhh } from './parse-utils.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  isArray: (name) => ["iwxxm:changeForecast", "iwxxm:weather", "iwxxm:layer", "item"].includes(name)
});

function decodeXmlEntities(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/&#xD;/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getOuterItem(xmlString) {
  const outer = parser.parse(xmlString);
  const items = toArray(outer?.response?.body?.items?.item || outer?.body?.items?.item || outer?.items?.item);
  return items[0] || null;
}

function parseInnerTaf(xml) {
  const parsed = parser.parse(decodeXmlEntities(xml));
  return parsed["iwxxm:TAF"] || parsed;
}

function parseValidPeriod(node) {
  const period = node?.["gml:TimePeriod"] || node;
  return {
    start: text(period?.["gml:beginPosition"]),
    end: text(period?.["gml:endPosition"])
  };
}

function parseSignedTemperature(value) {
  const token = String(text(value) || "").trim();
  if (!token) {
    return null;
  }

  if (/^M\d+$/i.test(token)) {
    return -Number(token.slice(1));
  }

  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function resolveWeatherList(weatherNodes) {
  const nodes = toArray(weatherNodes);
  if (nodes.length === 0) {
    return { value: null, touched: false };
  }

  let nilAsNsw = false;
  const parsed = [];

  for (const node of nodes) {
    const nilReason = String(node?.["@_nilReason"] || "").toLowerCase();
    if (nilReason.includes("nothingofoperationalsignificance")) {
      nilAsNsw = true;
      continue;
    }

    const href = node?.["@_xlink:href"] || text(node);
    const weather = parseWeatherCode(lastToken(href));
    if (weather) {
      parsed.push({ ...weather, icon_key: resolveWeatherIconKey(weather) });
    }
  }

  if (nilAsNsw && parsed.length === 0) {
    return { value: [], touched: true };
  }

  return { value: parsed, touched: true };
}

function resolveCloudList(cloudNode) {
  if (!cloudNode) {
    return { value: null, touched: false, nsc_flag: false };
  }

  const nilReason = String(cloudNode?.["@_nilReason"] || "").toLowerCase();
  if (nilReason.includes("nothingofoperationalsignificance")) {
    return { value: [], touched: true, nsc_flag: true };
  }

  const layers = toArray(
    cloudNode?.["iwxxm:AerodromeCloudForecast"]?.["iwxxm:layer"] ||
      cloudNode?.["iwxxm:AerodromeCloud"]?.["iwxxm:layer"]
  )
    .map(parseCloudLayer)
    .filter(Boolean);

  return { value: layers, touched: true, nsc_flag: false };
}

function parseForecastState(forecastNode, isBase = false) {
  const node = forecastNode || {};
  const cavok = String(node?.["@_cloudAndVisibilityOK"] || "false").toLowerCase() === "true";

  const windNode =
    node?.["iwxxm:surfaceWind"]?.["iwxxm:AerodromeSurfaceWindForecast"] ||
    node?.["iwxxm:surfaceWind"]?.["iwxxm:AerodromeSurfaceWind"];
  const wind = windNode ? parseWind(windNode) : null;

  const visibilityNode =
    node?.["iwxxm:prevailingVisibility"] ||
    node?.["iwxxm:visibility"]?.["iwxxm:prevailingVisibility"] ||
    node?.["iwxxm:visibility"];
  const visValue = cavok ? 9999 : number(visibilityNode);

  let weatherInfo;
  let cloudInfo;

  if (cavok) {
    weatherInfo = { value: [], touched: true };
    cloudInfo = { value: [], touched: true, nsc_flag: false };
  } else {
    weatherInfo = resolveWeatherList(node?.["iwxxm:weather"]);
    cloudInfo = resolveCloudList(node?.["iwxxm:cloud"]);
  }

  return {
    wind,
    vis: visValue,
    wx: weatherInfo.value,
    clouds: cloudInfo.value,
    wx_touched: isBase ? true : weatherInfo.touched,
    clouds_touched: isBase ? true : cloudInfo.touched,
    cavok_flag: cavok,
    nsc_flag: cloudInfo.nsc_flag
  };
}

function mapChangeIndicator(raw) {
  const token = String(raw || "").toUpperCase();
  const mapping = {
    BECOMING: "BECMG",
    TEMPORARY_FLUCTUATIONS: "TEMPO",
    PROBABILITY_30: "PROB30",
    PROBABILITY_40: "PROB40",
    PROBABILITY_30_TEMPORARY_FLUCTUATIONS: "PROB30_TEMPO",
    PROBABILITY_40_TEMPORARY_FLUCTUATIONS: "PROB40_TEMPO"
  };
  return mapping[token] || token;
}

function parseChangeGroups(taf) {
  const groups = toArray(taf?.["iwxxm:changeForecast"]);

  return groups
    .map((group) => {
      const forecastNode = group?.["iwxxm:MeteorologicalAerodromeForecast"] || group || {};
      const valid = parseValidPeriod(forecastNode?.["iwxxm:phenomenonTime"] || group?.["iwxxm:phenomenonTime"]);
      const state = parseForecastState(forecastNode, false);

      return {
        type: mapChangeIndicator(
          forecastNode?.["@_changeIndicator"] ||
            forecastNode?.["iwxxm:changeIndicator"] ||
            group?.["@_changeIndicator"] ||
            group?.["iwxxm:changeIndicator"]
        ),
        start: valid.start,
        end: valid.end,
        wind: state.wind,
        vis: state.vis,
        wx: state.wx,
        clouds: state.clouds,
        wx_touched: state.wx_touched,
        clouds_touched: state.clouds_touched,
        cavok_flag: state.cavok_flag,
        nsc_flag: state.nsc_flag
      };
    })
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
}

function partialMerge(current, change) {
  const next = deepClone(current);

  if (change.wind != null) {
    next.wind = change.wind;
  }

  if (change.vis != null) {
    next.vis = change.vis;
    if (change.vis !== 9999) {
      next.cavok_flag = false;
    }
  }

  if (change.wx_touched === true) {
    next.wx = change.wx;
    if (!change.cavok_flag) {
      next.cavok_flag = false;
    }
  }

  if (change.clouds_touched === true) {
    next.clouds = change.clouds;
    next.cavok_flag = false;
    next.nsc_flag = change.nsc_flag === true;
  }

  if (change.cavok_flag === true) {
    next.cavok_flag = true;
    next.nsc_flag = false;
    next.vis = 9999;
    next.wx = [];
    next.clouds = [];
  }

  return next;
}

function resolveWxByVis(state) {
  const next = deepClone(state);
  const vis = Number(next.vis);

  if (next.cavok_flag !== true && Array.isArray(next.wx) && next.wx.length === 0 && Number.isFinite(vis)) {
    if (vis >= 1000 && vis < 5000) {
      const br = parseWeatherCode("BR");
      next.wx = [{ ...br, icon_key: resolveWeatherIconKey(br) }];
    }
  }

  return next;
}

function formatDisplay(state) {
  const weatherList = state.wx || [];
  return {
    wind: state.wind?.raw || null,
    visibility: String(state.vis ?? "//"),
    weather: state.cavok_flag ? "" : (weatherList.map((w) => w.raw).join(" ")),
    clouds: (state.cavok_flag || state.nsc_flag) ? "NSC" : ((state.clouds || []).map((c) => c.raw).join(" ")),
    weather_icon: state.cavok_flag ? "CAVOK" : pickPrimaryWeatherIcon(weatherList),
    weather_intensity: weatherList[0]?.intensity || null
  };
}

function hourRange(startIso, endIso) {
  const out = [];
  const start = new Date(startIso);
  const end = new Date(endIso);

  for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + 3600 * 1000)) {
    out.push(cursor.toISOString().replace(".000Z", "Z"));
  }

  return out;
}

function parseTemperatureHeader(taf, baseForecastNode, issued) {
  const tempBlock =
    baseForecastNode?.["iwxxm:temperature"]?.["iwxxm:AerodromeAirTemperatureForecast"] ||
    taf?.["iwxxm:temperature"]?.["iwxxm:AerodromeAirTemperatureForecast"] ||
    {};
  const maxNode = tempBlock["iwxxm:maximumAirTemperature"] ?? taf?.["iwxxm:maximumAirTemperature"];
  const minNode = tempBlock["iwxxm:minimumAirTemperature"] ?? taf?.["iwxxm:minimumAirTemperature"];

  const maxTimeNode =
    tempBlock?.["iwxxm:maximumAirTemperatureTime"]?.["gml:TimeInstant"]?.["gml:timePosition"] ??
    tempBlock?.["iwxxm:maximumAirTemperatureTime"]?.["gml:timePosition"] ??
    taf?.["iwxxm:maximumAirTemperatureTime"];

  const minTimeNode =
    tempBlock?.["iwxxm:minimumAirTemperatureTime"]?.["gml:TimeInstant"]?.["gml:timePosition"] ??
    tempBlock?.["iwxxm:minimumAirTemperatureTime"]?.["gml:timePosition"] ??
    taf?.["iwxxm:minimumAirTemperatureTime"];

  const anchor = issued ? new Date(issued) : new Date();
  const maxTimeRaw = text(maxTimeNode);
  const minTimeRaw = text(minTimeNode);

  return {
    max: {
      value: parseSignedTemperature(maxNode),
      time: maxTimeRaw ? resolveDdhh(lastToken(maxTimeRaw), anchor) : null
    },
    min: {
      value: parseSignedTemperature(minNode),
      time: minTimeRaw ? resolveDdhh(lastToken(minTimeRaw), anchor) : null
    }
  };
}

function parse(xmlString) {
  const item = getOuterItem(xmlString);
  if (!item) {
    return null;
  }

  let taf = {};
  const tafNode = item.tafMsg || item.taf;
  if (typeof tafNode === "string") {
    taf = parseInnerTaf(tafNode);
  } else if (tafNode && typeof tafNode === "object") {
    taf = tafNode["iwxxm:TAF"] || tafNode;
  }

  const issued =
    text(taf?.["iwxxm:issueTime"]?.["gml:TimeInstant"]?.["gml:timePosition"]) ||
    text(taf?.["iwxxm:issueTime"]?.["gml:timePosition"]);

  const valid = parseValidPeriod(taf?.["iwxxm:validPeriod"]);

  const baseForecastNode = taf?.["iwxxm:baseForecast"]?.["iwxxm:MeteorologicalAerodromeForecast"] || {};
  const base = parseForecastState(baseForecastNode, true);

  const changes = parseChangeGroups(taf);
  const becmgList = changes.filter((c) => c.type === "BECMG");
  const tempoList = changes.filter((c) => ["TEMPO", "PROB30", "PROB40", "PROB30_TEMPO", "PROB40_TEMPO"].includes(c.type));

  const timeline = [];

  for (const time of hourRange(valid.start, valid.end)) {
    let state = deepClone(base);

    for (const becmg of becmgList) {
      if (becmg.start && time >= becmg.start) {
        state = partialMerge(state, becmg);
      }
    }

    for (const tempo of tempoList) {
      if (tempo.start && tempo.end && time >= tempo.start && time < tempo.end) {
        state = partialMerge(state, tempo);
      }
    }

    state = resolveWxByVis(state);

    timeline.push({
      time,
      wind: state.wind,
      visibility: {
        value: state.vis,
        cavok: state.cavok_flag
      },
      weather: state.wx || [],
      clouds: state.clouds || [],
      display: formatDisplay(state)
    });
  }

  const parsed = {
    header: {
      icao:
        text(item.icaoCode) ||
        text(taf?.["iwxxm:aerodrome"]?.["aixm:AirportHeliport"]?.["aixm:timeSlice"]?.["aixm:AirportHeliportTimeSlice"]?.["aixm:locationIndicatorICAO"]) ||
        text(taf?.["iwxxm:aerodrome"]?.["aixm:AirportHeliport"]?.["aixm:timeSlice"]?.["aixm:AirportHeliportTimeSlice"]?.["aixm:designator"]) ||
        null,
      airport_name:
        text(item.airportName) ||
        text(taf?.["iwxxm:aerodrome"]?.["aixm:AirportHeliport"]?.["aixm:timeSlice"]?.["aixm:AirportHeliportTimeSlice"]?.["aixm:name"]) ||
        null,
      report_type: "TAF",
      issued,
      valid_start: valid.start,
      valid_end: valid.end,
      report_status: text(taf?.["iwxxm:reportStatus"]) || text(taf?.["@_reportStatus"]) || null,
      temperatures: parseTemperatureHeader(taf, baseForecastNode, issued)
    },
    timeline
  };

  // Guard: reject empty/placeholder payloads that would poison latest.json cache.
  if (!parsed.header.icao || !parsed.header.valid_start || !parsed.header.valid_end) {
    return null;
  }

  return parsed;
}

export { parse }
export default { parse }
