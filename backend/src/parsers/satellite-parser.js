
import sharp from 'sharp'

const DEG2RAD = Math.PI / 180;
const BASE_OUTPUT_WIDTH = 1200;

// LCC projection parameters (same as radar-echo-parser.js)
const PHI1 = 30.0 * DEG2RAD;
const PHI2 = 60.0 * DEG2RAD;
const PHI0 = 38.0 * DEG2RAD;
const LAM0 = 126.0 * DEG2RAD;
const R = 6371009; // Earth radius in meters

const _n = Math.log(Math.cos(PHI1) / Math.cos(PHI2)) /
  Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2));
const _F = Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), _n) / _n;
const _rho0 = R * _F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), _n);

// Output geographic bounds (covers KO domain)
const WEST = 114.0;
const EAST = 138.0;
const SOUTH = 29.3;
const NORTH = 45.8;

// KO-domain defaults (shared by all KO-region NC files)
const KO_DEFAULTS = { width: 900, height: 900, pixelSize: 2000, ulEasting: -899000, ulNorthing: 899000 };
const IR_BT_COLD_K = 190;
const IR_BT_WARM_K = 310;
const IR_DISPLAY_GAMMA = 1.15;

function latLonToEN(latDeg, lonDeg) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const rho = R * _F / Math.pow(Math.tan(Math.PI / 4 + lat / 2), _n);
  const theta = _n * (lon - LAM0);
  return [rho * Math.sin(theta), _rho0 - rho * Math.cos(theta)];
}

function latToMercatorY(lat) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return Math.log(Math.tan(Math.PI / 4 + clamped * DEG2RAD / 2));
}

function mercatorYToLat(y) {
  return Math.atan(Math.sinh(y)) / DEG2RAD;
}

/**
 * Resolve h5wasm attribute to a usable JS value.
 * h5wasm may return raw values or Attribute objects with .value property.
 */
function resolveAttr(attr) {
  if (attr == null) return null;
  if (typeof attr === "object" && "value" in attr) return attr.value;
  return attr;
}

function getNumAttr(attrs, key) {
  const raw = resolveAttr(attrs[key]);
  if (raw == null) return NaN;
  if (ArrayBuffer.isView(raw) && raw.length > 0) return Number(raw[0]);
  if (typeof raw === "number") return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "object" && raw[0] !== undefined) return Number(raw[0]);
  return Number(raw);
}

/**
 * Read projection attributes from a KO-domain NC file.
 * Tries root attrs first, then gk2a_imager_projection dataset (LE2 format).
 */
function readProjection(f) {
  let source = f.attrs;

  // LE2 files store projection in a separate dataset
  if (f.keys().includes("gk2a_imager_projection")) {
    const projDs = f.get("gk2a_imager_projection");
    if (projDs && projDs.attrs) source = projDs.attrs;
  }

  const attrs = {
    width: getNumAttr(source, "image_width"),
    height: getNumAttr(source, "image_height"),
    pixelSize: getNumAttr(source, "pixel_size"),
    ulEasting: getNumAttr(source, "upper_left_easting"),
    ulNorthing: getNumAttr(source, "upper_left_northing"),
  };

  // Fallback to KO defaults
  for (const [key, def] of Object.entries(KO_DEFAULTS)) {
    if (!Number.isFinite(attrs[key])) attrs[key] = def;
  }

  return attrs;
}

/**
 * Parse a GK2A LE1B (raw imagery) NetCDF buffer.
 */
async function parseSatelliteNC(buffer) {
  const h5wasm = await import("h5wasm");
  await h5wasm.ready;

  const filename = `sat_${Date.now()}.nc`;
  h5wasm.FS.writeFile(filename, new Uint8Array(buffer));
  const f = new h5wasm.File(filename, "r");

  const data = f.get("image_pixel_values").value;
  const proj = readProjection(f);

  f.close();
  try { h5wasm.FS.unlink(filename); } catch { /* ignore */ }

  return { data, attrs: proj };
}

/**
 * Parse a GK2A LE2 FOG NetCDF buffer.
 * Returns FOG category, Del_Fta temperature difference, and projection.
 */
async function parseFogNC(buffer) {
  const h5wasm = await import("h5wasm");
  await h5wasm.ready;

  const filename = `fog_${Date.now()}.nc`;
  h5wasm.FS.writeFile(filename, new Uint8Array(buffer));
  const f = new h5wasm.File(filename, "r");

  const fogData = f.get("FOG").value;       // Uint16Array: 1=Clear,5=Fog,...
  const delFta = f.get("Del_Fta").value;    // Int16Array: temp diff, -32768=fill
  const proj = readProjection(f);

  f.close();
  try { h5wasm.FS.unlink(filename); } catch { /* ignore */ }

  return { fogData, delFta, attrs: proj };
}

/**
 * Del_Fta temperature difference → fog overlay color.
 * Matches KMA official fog image color scale:
 *   red (cold/0) → orange → yellow → green → teal (warm/6+)
 */
function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * ratio)));
  return sorted[index];
}

function resolveIrDisplayRange(irData) {
  const sorted = Array.from(irData).sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // When IR105 values already look like brightness temperature in Kelvin,
  // use a fixed cold/warm stretch so dark oceans and bright cold cloud tops
  // stay visually consistent across frames.
  if (min >= 150 && max <= 350) {
    return {
      cold: IR_BT_COLD_K,
      warm: IR_BT_WARM_K,
      invert: false,
    };
  }

  // Fallback for non-BT encoded values: use a tighter percentile window
  // and invert the grayscale so colder-looking cloud tops remain brighter.
  return {
    cold: percentile(sorted, 0.02),
    warm: percentile(sorted, 0.98),
    invert: false,
  };
}

function irGrayByte(irValue, displayRange) {
  const { cold, warm, invert } = displayRange;
  const normalized = clamp((irValue - cold) / ((warm - cold) || 1), 0, 1);
  const scaled = invert ? (1 - normalized) : normalized;
  const curved = Math.pow(scaled, IR_DISPLAY_GAMMA);
  return Math.round(curved * 255);
}

function fogColor(delFtaVal) {
  const legendValue = Math.max(0, Math.min(6, (delFtaVal + 10) / 10));
  const stops = [
    { value: 0, rgb: [244, 34, 24] },
    { value: 1, rgb: [248, 92, 20] },
    { value: 2, rgb: [252, 148, 18] },
    { value: 3, rgb: [255, 214, 26] },
    { value: 4, rgb: [244, 238, 72] },
    { value: 5, rgb: [170, 214, 68] },
    { value: 6, rgb: [52, 168, 76] },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const left = stops[i];
    const right = stops[i + 1];
    if (legendValue <= right.value) {
      const t = (legendValue - left.value) / (right.value - left.value || 1);
      return [
        Math.round(lerp(left.rgb[0], right.rgb[0], t)),
        Math.round(lerp(left.rgb[1], right.rgb[1], t)),
        Math.round(lerp(left.rgb[2], right.rgb[2], t)),
      ];
    }
  }

  return stops[stops.length - 1].rgb;
}

/**
 * Render a FOG composite image: IR105 grayscale background + colored fog overlay.
 */
async function renderFogImage(irParsed, fogParsed) {
  const { data: irData, attrs } = irParsed;
  const { fogData, delFta } = fogParsed;
  const { width: srcW, height: srcH, pixelSize, ulEasting, ulNorthing } = attrs;

  const minMY = latToMercatorY(SOUTH);
  const maxMY = latToMercatorY(NORTH);
  const outW = BASE_OUTPUT_WIDTH;
  const outH = Math.max(1, Math.round(outW * (maxMY - minMY) / ((EAST - WEST) * DEG2RAD)));

  const irDisplayRange = resolveIrDisplayRange(irData);

  const buf = Buffer.alloc(outW * outH * 4);
  let fogPixelCount = 0;

  for (let py = 0; py < outH; py++) {
    const mercY = maxMY - (py + 0.5) / outH * (maxMY - minMY);
    const lat = mercatorYToLat(mercY);

    for (let px = 0; px < outW; px++) {
      const lon = WEST + (px + 0.5) / outW * (EAST - WEST);

      const [e, nn] = latLonToEN(lat, lon);
      const col = Math.round((e - ulEasting) / pixelSize);
      const row = Math.round((ulNorthing - nn) / pixelSize);

      if (col < 0 || col >= srcW || row < 0 || row >= srcH) continue;

      const idx = row * srcW + col;
      const o = (py * outW + px) * 4;

      const fogVal = fogData ? fogData[idx] : 0;
      const delta = delFta ? delFta[idx] : -32768;

      // FOG=5 (Fog) with valid Del_Fta → color overlay
      if (fogVal === 5 && delta !== -32768) {
        const [r, g, b] = fogColor(delta);
        buf[o] = r;
        buf[o + 1] = g;
        buf[o + 2] = b;
        buf[o + 3] = 220;
        fogPixelCount++;
      } else {
        // IR grayscale background: colder cloud tops brighter, warmer surfaces darker.
        const byte = irGrayByte(irData[idx], irDisplayRange);
        buf[o] = byte;
        buf[o + 1] = byte;
        buf[o + 2] = byte;
        buf[o + 3] = 200;
      }
    }
  }

  const bounds = [[SOUTH, WEST], [NORTH, EAST]];

  const pngBuffer = await sharp(buf, {
    raw: { width: outW, height: outH, channels: 4 },
  }).png({ compressionLevel: 3 }).toBuffer();

  return { pngBuffer, bounds, width: outW, height: outH, fogPixelCount };
}

export { parseSatelliteNC, parseFogNC, renderFogImage }
export default { parseSatelliteNC, parseFogNC, renderFogImage }
