import { XMLParser } from 'fast-xml-parser'
import { toArray, text, number, lastToken } from './parse-utils.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  isArray: (name) => [
    "item",
    "iwxxm:member",
    "iwxxm:analysisAndForecastPositionAnalysis"
  ].includes(name)
});

const PHENOMENON_LABELS = {
  SEV_ICE: "Severe Icing",
  MOD_ICE: "Moderate Icing",
  SEV_TURB: "Severe Turbulence",
  MOD_TURB: "Moderate Turbulence",
  TS: "Thunderstorm",
  SQL_TS: "Squall Line Thunderstorm",
  GR: "Hail",
  MTW: "Mountain Wave",
  TC: "Tropical Cyclone",
  VA: "Volcanic Ash",
  CB: "Cumulonimbus",
  OBSC_TS: "Obscured Thunderstorm",
  EMBD_TS: "Embedded Thunderstorm",
  FRQ_TS: "Frequent Thunderstorm",
  MT_OBSC: "Mountain Obscuration",
  IFR: "IFR",
  LLWS: "Low Level Wind Shear",
  SFC_VIS: "Surface Visibility"
};

const VISIBILITY_CAUSE_LABELS = {
  FG: "Fog",
  BR: "Mist",
  RA: "Rain",
  SN: "Snow",
  HZ: "Haze",
  DU: "Dust",
  SA: "Sand"
};

function sanitizeXml(raw) {
  if (typeof raw !== "string") return "";
  const start = raw.indexOf("<");
  if (start === -1) return raw.trim();
  return raw.slice(start)
    .replace(/&#xD;/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseXml(raw) {
  return parser.parse(sanitizeXml(raw));
}

function unwrapReportNode(reportNode, reportTag) {
  if (!reportNode) return null;
  if (typeof reportNode === "string") {
    const parsed = parseXml(reportNode);
    return parsed[`iwxxm:${reportTag}`] || parsed;
  }
  if (typeof reportNode === "object") {
    return reportNode[`iwxxm:${reportTag}`] || reportNode;
  }
  return null;
}

function getItems(xmlString) {
  const outer = parseXml(xmlString);
  return toArray(outer?.response?.body?.items?.item || outer?.body?.items?.item || outer?.items?.item);
}

function parseTimePosition(node) {
  return (
    text(node?.["gml:TimeInstant"]?.["gml:timePosition"]) ||
    text(node?.["gml:timePosition"]) ||
    text(node)
  );
}

function parseTimePeriod(node) {
  const period = node?.["gml:TimePeriod"] || node || {};
  return {
    begin: text(period?.["gml:beginPosition"]),
    end: text(period?.["gml:endPosition"])
  };
}

function parseUnitDesignator(node) {
  return text(
    node?.["aixm:Unit"]?.["aixm:timeSlice"]?.["aixm:UnitTimeSlice"]?.["aixm:designator"]
  ) || null;
}

function parseUnitName(node) {
  return text(
    node?.["aixm:Unit"]?.["aixm:timeSlice"]?.["aixm:UnitTimeSlice"]?.["aixm:name"]
  ) || null;
}

function parseAirspaceName(node) {
  return text(
    node?.["aixm:Airspace"]?.["aixm:timeSlice"]?.["aixm:AirspaceTimeSlice"]?.["aixm:name"]
  ) || null;
}

function axisOrder(surfaceNode) {
  const labels = String(surfaceNode?.["@_axisLabels"] || "").trim().toLowerCase();
  if (labels === "lat lon") return "latlon";
  if (labels === "lon lat") return "lonlat";
  return "latlon";
}

function chunkCoordinates(values, order) {
  const coords = [];
  for (let i = 0; i < values.length - 1; i += 2) {
    const first = Number(values[i]);
    const second = Number(values[i + 1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
      coords.push([first, second]);
      continue;
    }
    if (Math.abs(second) > 90 && Math.abs(first) <= 90) {
      coords.push([second, first]);
      continue;
    }
    coords.push(order === "latlon" ? [second, first] : [first, second]);
  }
  return closeRing(coords);
}

function closeRing(coords) {
  if (coords.length < 3) return coords;
  const [firstLon, firstLat] = coords[0];
  const [lastLon, lastLat] = coords[coords.length - 1];
  if (firstLon === lastLon && firstLat === lastLat) return coords;
  return [...coords, [firstLon, firstLat]];
}

function parsePolygonGeometry(surfaceNode) {
  const order = axisOrder(surfaceNode);
  const patches = toArray(surfaceNode?.["gml:polygonPatches"]?.["gml:PolygonPatch"]);
  const rings = patches
    .map((patch) => {
      const posListRaw = text(patch?.["gml:exterior"]?.["gml:LinearRing"]?.["gml:posList"]);
      if (!posListRaw) return null;
      const coords = chunkCoordinates(posListRaw.trim().split(/\s+/), order);
      return coords.length >= 4 ? coords : null;
    })
    .filter(Boolean);

  if (!rings.length) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: [rings[0]] }
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

function mergeGeometries(geometries) {
  if (!geometries.length) return null;
  if (geometries.length === 1) return geometries[0];

  const polygons = [];
  for (const geometry of geometries) {
    if (geometry.type === "Polygon") {
      polygons.push(geometry.coordinates);
    } else if (geometry.type === "MultiPolygon") {
      polygons.push(...geometry.coordinates);
    }
  }

  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

function computeBbox(geometry) {
  if (!geometry) return null;
  const coords = [];
  if (geometry.type === "Polygon") {
    coords.push(...(geometry.coordinates?.[0] || []));
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates || []) {
      coords.push(...(polygon?.[0] || []));
    }
  }
  if (!coords.length) return null;
  const lons = coords.map(([lon]) => lon);
  const lats = coords.map(([, lat]) => lat);
  return {
    min_lon: Math.min(...lons),
    min_lat: Math.min(...lats),
    max_lon: Math.max(...lons),
    max_lat: Math.max(...lats)
  };
}

function parseAirspaceVolume(node) {
  const volume = node?.["aixm:AirspaceVolume"] || node || {};
  const surfaceNode = volume?.["aixm:horizontalProjection"]?.["aixm:Surface"];

  return {
    altitude: {
      lower_fl: number(volume?.["aixm:lowerLimit"]),
      upper_fl: number(volume?.["aixm:upperLimit"]),
      lower_ref: text(volume?.["aixm:lowerLimitReference"]),
      upper_ref: text(volume?.["aixm:upperLimitReference"]),
      lower_uom: text(volume?.["aixm:lowerLimit"]?.["@_uom"]) || text(volume?.["aixm:lowerLimit@_uom"]),
      upper_uom: text(volume?.["aixm:upperLimit"]?.["@_uom"]) || text(volume?.["aixm:upperLimit@_uom"])
    },
    geometry: parsePolygonGeometry(surfaceNode)
  };
}

function parseEvolvingCollection(node) {
  const collection = node || {};
  const members = toArray(collection?.["iwxxm:member"]);
  const parts = members.map((member) => {
    const condition = member?.["iwxxm:SIGMETEvolvingCondition"] || member?.["iwxxm:AIRMETEvolvingCondition"] || member;
    const parsed = parseAirspaceVolume(condition?.["iwxxm:geometry"]);
    const visibilityCauses = toArray(condition?.["iwxxm:surfaceVisibilityCause"])
      .map((cause) => lastToken(cause?.["@_xlink:href"] || cause?.["@_href"]).toUpperCase())
      .filter(Boolean);
    return {
      geometry: parsed.geometry,
      altitude: parsed.altitude,
      intensity_change: text(condition?.["@_intensityChange"]),
      direction_deg: number(condition?.["iwxxm:directionOfMotion"]),
       speed_kt: number(condition?.["iwxxm:speedOfMotion"]),
       surface_visibility_m: number(condition?.["iwxxm:surfaceVisibility"]),
       surface_visibility_causes: visibilityCauses,
       surface_wind_direction_deg: number(condition?.["iwxxm:surfaceWindDirection"]),
       surface_wind_speed_kt: number(condition?.["iwxxm:surfaceWindSpeed"])
    };
  });

  const altitudes = parts.map((part) => part.altitude).filter((alt) => alt && (alt.lower_fl != null || alt.upper_fl != null));
  const altitude = altitudes[0] || {
    lower_fl: null,
    upper_fl: null,
    lower_ref: null,
    upper_ref: null,
    lower_uom: null,
    upper_uom: null
  };
  const motionPart = parts.find((part) => part.direction_deg != null || part.speed_kt != null) || {};
  const visibilityPart = parts.find((part) => part.surface_visibility_m != null || (part.surface_visibility_causes || []).length) || {};
  const surfaceWindPart = parts.find((part) => part.surface_wind_direction_deg != null || part.surface_wind_speed_kt != null) || {};

  return {
    time_indicator: text(collection?.["@_timeIndicator"]),
    intensity_change: parts.find((part) => part.intensity_change)?.intensity_change || null,
    altitude,
    motion: {
      direction_deg: motionPart.direction_deg ?? null,
      speed_kt: motionPart.speed_kt ?? null
    },
    geometry: mergeGeometries(parts.map((part) => part.geometry).filter(Boolean)),
    surface_visibility_m: visibilityPart.surface_visibility_m ?? null,
    surface_visibility_causes: visibilityPart.surface_visibility_causes || [],
    surface_wind: {
      direction_deg: surfaceWindPart.surface_wind_direction_deg ?? null,
      speed_kt: surfaceWindPart.surface_wind_speed_kt ?? null
    }
  };
}

function parseAnalysis(reportNode) {
  const collectionNodes = toArray(reportNode?.["iwxxm:analysisCollection"]?.["iwxxm:analysisAndForecastPositionAnalysis"])
    .map((block) => block?.["iwxxm:analysis"]?.["iwxxm:SIGMETEvolvingConditionCollection"] || block?.["iwxxm:analysis"]?.["iwxxm:AIRMETEvolvingConditionCollection"])
    .filter(Boolean);

  const directAnalysis = reportNode?.["iwxxm:analysis"]?.["iwxxm:AIRMETEvolvingConditionCollection"]
    || reportNode?.["iwxxm:analysis"]?.["iwxxm:SIGMETEvolvingConditionCollection"]
    || null;

  const candidates = [...collectionNodes, ...(directAnalysis ? [directAnalysis] : [])];
  const parsed = candidates.map((node) => parseEvolvingCollection(node));
  return parsed.find((entry) => entry?.geometry || entry?.surface_visibility_m != null) || null;
}

function buildItemId(fir, sequenceNumber, issueTime, reportTag) {
  const safeFir = fir || reportTag.toUpperCase();
  const safeSeq = sequenceNumber || "UNK";
  const safeTime = (issueTime || new Date(0).toISOString()).replace(/[:]/g, "");
  return `${safeFir}-${safeSeq}-${safeTime}`;
}

function parsePhenomenon(report) {
  const href = report?.["iwxxm:phenomenon"]?.["@_xlink:href"] || report?.["iwxxm:phenomenon"]?.["@_href"];
  const code = lastToken(href).toUpperCase() || null;
  return {
    code,
    label: code ? (PHENOMENON_LABELS[code] || code.replaceAll("_", " ")) : null
  };
}

function parseSingleItem(item, reportTag) {
  const reportNode = unwrapReportNode(item[`${reportTag}Msg`] || item[reportTag], reportTag.toUpperCase());
  if (!reportNode) return null;

  const issueTime = parseTimePosition(reportNode?.["iwxxm:issueTime"]);
  const validPeriod = parseTimePeriod(reportNode?.["iwxxm:validPeriod"]);
  const phenomenon = parsePhenomenon(reportNode);
  const reportStatus = text(reportNode?.["@_reportStatus"]) || "NORMAL";
  const cancelled = /CANCEL/i.test(reportStatus);
  const sequenceNumber = text(reportNode?.["iwxxm:sequenceNumber"]);
  const analysis = parseAnalysis(reportNode) || {
      geometry: null,
      altitude: {
        lower_fl: null,
        upper_fl: null,
        lower_ref: null,
        upper_ref: null,
        lower_uom: null,
        upper_uom: null
      },
      time_indicator: null,
      intensity_change: null,
      motion: { direction_deg: null, speed_kt: null },
      surface_visibility_m: null,
      surface_visibility_causes: [],
      surface_wind: { direction_deg: null, speed_kt: null }
    };

  const fir = parseUnitDesignator(reportNode?.["iwxxm:issuingAirTrafficServicesUnit"]);
  const atsuName = parseUnitName(reportNode?.["iwxxm:issuingAirTrafficServicesUnit"]);
  const mwo = parseUnitDesignator(reportNode?.["iwxxm:originatingMeteorologicalWatchOffice"]);
  const mwoName = parseUnitName(reportNode?.["iwxxm:originatingMeteorologicalWatchOffice"]);
  const firName = parseAirspaceName(reportNode?.["iwxxm:issuingAirTrafficServicesRegion"]);
  const cancelledSeq = text(reportNode?.["iwxxm:cancelledSequenceNumber"]) || text(reportNode?.["iwxxm:cancelledReportSequenceNumber"]);
  const cancelledPeriod = parseTimePeriod(reportNode?.["iwxxm:cancelledValidPeriod"] || reportNode?.["iwxxm:cancelledReportValidPeriod"]);

  return {
    id: buildItemId(fir, sequenceNumber, issueTime, reportTag),
    sequence_number: sequenceNumber,
    report_status: reportStatus,
    cancelled,
    cancelled_sequence_number: cancelledSeq,
    cancelled_valid_from: cancelledPeriod.begin,
    cancelled_valid_to: cancelledPeriod.end,
    issue_time: issueTime,
    valid_from: validPeriod.begin,
    valid_to: validPeriod.end,
    fir,
    fir_name: firName,
    atsu: fir,
    atsu_name: atsuName,
    mwo,
    mwo_name: mwoName,
    phenomenon_code: phenomenon.code,
    phenomenon_label: phenomenon.label,
    time_indicator: analysis.time_indicator,
    intensity_change: analysis.intensity_change,
    altitude: analysis.altitude,
    motion: analysis.motion,
    surface_visibility_m: analysis.surface_visibility_m,
    surface_visibility_causes: analysis.surface_visibility_causes,
    surface_visibility_cause_labels: analysis.surface_visibility_causes.map((code) => VISIBILITY_CAUSE_LABELS[code] || code),
    surface_wind: analysis.surface_wind,
    geometry: analysis.geometry,
    bbox: computeBbox(analysis.geometry),
    raw_xml_id: text(reportNode?.["@_gml:id"])
  };
}

function isStillValid(item, now) {
  if (!item?.valid_to) return true;
  const time = Date.parse(item.valid_to);
  return !Number.isFinite(time) || time >= now;
}

function resolveLifecycle(items, options = {}) {
  const now = Date.now();
  const includeExpired = options.includeExpired === true;
  const active = new Map();

  for (const item of items) {
    if (!item || (!includeExpired && !isStillValid(item, now))) continue;

    const key = `${item.fir || "UNK"}:${item.sequence_number || item.id}`;

    if (item.cancelled) {
      const cancelKey = `${item.fir || "UNK"}:${item.cancelled_sequence_number || item.sequence_number || item.id}`;
      active.delete(cancelKey);
      continue;
    }

    active.set(key, item);
  }

  return Array.from(active.values()).sort((a, b) => {
    const aTime = Date.parse(a.issue_time || 0);
    const bTime = Date.parse(b.issue_time || 0);
    return aTime - bTime;
  });
}

function parse(xmlString, reportTag, options = {}) {
  const items = getItems(xmlString)
    .map((item) => parseSingleItem(item, reportTag))
    .filter(Boolean);
  return resolveLifecycle(items, options);
}

export { parse }
export default { parse }
