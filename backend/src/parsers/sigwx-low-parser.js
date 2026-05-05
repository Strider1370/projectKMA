import { XMLParser } from 'fast-xml-parser'

const MAP_RANGES = {
  normal: {
    minLat: 27.5,
    maxLat: 39,
    minLon: 121,
    maxLon: 135,
  },
  wide: {
    minLat: 27.3,
    maxLat: 44,
    minLon: 119,
    maxLon: 135,
  },
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["item", "pt"].includes(name),
});

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value, fallback = "") {
  if (value == null) return fallback;
  return String(value);
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorFromHex(raw, fallback = "#ffffff") {
  const normalized = text(raw).trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return fallback;
  return `#${normalized}`;
}

function iconTokens(iconName) {
  return text(iconName)
    .split("/")
    .map((name) => name.replace(/\.png$/i, "").trim())
    .filter(Boolean);
}

function fpvPointToLatLng(point, mapRangeMode, width, height) {
  const bounds = MAP_RANGES[mapRangeMode] || MAP_RANGES.normal;
  const x = number(point?.["@_x"]);
  const y = number(point?.["@_y"]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
    return null;
  }

  const lon = bounds.minLon + (x / width) * (bounds.maxLon - bounds.minLon);
  const lat = bounds.maxLat - (y / height) * (bounds.maxLat - bounds.minLat);
  return [lat, lon];
}

function parsePoints(points) {
  return toArray(points).map((point) => ({
    x: number(point?.["@_x"]),
    y: number(point?.["@_y"]),
    lbl: text(point?.["@_lbl"], ""),
  })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function parseRectLabel(rectLabel) {
  if (!rectLabel) return null;
  const left = number(rectLabel?.["@_left"]);
  const top = number(rectLabel?.["@_top"]);
  const width = number(rectLabel?.["@_width"]);
  const height = number(rectLabel?.["@_height"]);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return { left, top, width, height };
}

function parseItem(node, index, mapRangeMode, width, height) {
  const fpvPoints = parsePoints(node?.fpv?.list_pt_fpv?.pt);
  const rectLabel = parseRectLabel(node?.fpv?.rect_label);
  const latLngs = fpvPoints
    .map((point) => fpvPointToLatLng({ "@_x": point.x, "@_y": point.y }, mapRangeMode, width, height))
    .filter(Boolean);
  if (latLngs.length === 0) return null;

  const listPoints = parsePoints(node?.list_pt?.pt);
  const itemType = number(node?.["@_item_type"]);
  const iconName = text(node?.["@_icon_name"], "");
  const label = text(node?.["@_label"], "");

  return {
    id: `sigwx-low-${index}`,
    item_type: itemType,
    contour_name: text(node?.["@_contour_name"], ""),
    item_name: text(node?.["@_item_name"], ""),
    label,
    icon_name: iconName,
    icon_tokens: iconTokens(iconName),
    icon_text_pos: number(node?.["@_icon_text_pos"], 0),
    is_close: text(node?.["@_is_close"], "false") === "true",
    is_fill: text(node?.["@_is_fill"], "0") === "1",
    line_width: number(node?.["@_lien_width"], 2),
    curve_tension: number(node?.["@_curve_tention"], 0),
    line_type: text(node?.["@_lien_type"], ""),
    shape_type: text(node?.["@_shape_type"], ""),
    color_line: colorFromHex(node?.["@_color_line"], "#ffffff"),
    color_back: colorFromHex(node?.["@_color_back"], "#ffffff"),
    label_pos_pt: number(node?.["@_label_pos_pt"], -1),
    label_pos_offset_x: number(node?.["@_label_pos_offset_x"], 0),
    label_pos_offset_y: number(node?.["@_label_pos_offset_y"], 0),
    rect_label: rectLabel,
    points: listPoints,
    fpv_points: fpvPoints,
    lat_lngs: latLngs,
    text_label: label || iconTokens(iconName).join(" / ") || text(node?.["@_item_name"], "") || text(node?.["@_contour_name"], "") || "SIGWX",
  };
}

function parse(xmlString) {
  const parsed = parser.parse(xmlString);
  const root = parsed?.odmap_ml;
  if (!root) {
    throw new Error("Invalid SIGWX LOW XML: odmap_ml missing");
  }

  const mapRangeMode = text(root?.["@_map_range_mode"], "normal");
  const width = number(root?.["@_fpv_safe_bound_width"], 0);
  const height = number(root?.["@_fpv_safe_bound_height"], 0);
  const rawItems = toArray(root?.low?.list_item).flatMap((listItem) => toArray(listItem?.item));
  const items = rawItems
    .map((item, index) => parseItem(item, index, mapRangeMode, width, height))
    .filter(Boolean);

  return {
    mode: text(root?.["@_height_mode"], "LOW"),
    show_airport: number(root?.["@_show_airport"], 0),
    map_range_mode: mapRangeMode,
    amd_use: number(root?.["@_amd_use"], 0),
    amd_hour: text(root?.["@_amd_hour"], ""),
    amd_min: text(root?.["@_amd_min"], ""),
    amd_tar_low: text(root?.["@_amd_tar_low"], ""),
    fpv_safe_bound_width: width,
    fpv_safe_bound_height: height,
    items,
  };
}

export { parse }
export default { parse }
