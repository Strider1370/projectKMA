
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const DEG2RAD = Math.PI / 180;
const OUTPUT_WIDTH = 1400;
const PADDING_RATIO = 0.06;
const SAMPLE_OFFSET = 44;
const SAMPLE_REPEAT = 46;
const SCALLOP_RADIUS = 24;
const SCALLOP_OFFSET = 18;
const RENDER_VERSION = "sigwx-cloud-overlay-trial-v3";
const CB_COLOR = "#a52a2a";

function lonToMercatorX(lon) {
  return (lon * Math.PI) / 180;
}

function latToMercatorY(lat) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = clamped * DEG2RAD;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function mercatorYToLat(y) {
  return Math.atan(Math.sinh(y)) / DEG2RAD;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isCbCloudBoundary(item) {
  return Number(item?.item_type) === 4
    && String(item?.contour_name || "").toLowerCase() === "cld"
    && String(item?.item_name || "").toLowerCase() === "cloud"
    && /\bCB\b/i.test(String(item?.label || item?.text_label || "").replace(/&#10;/g, " "));
}

function buildBounds(items) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of items) {
    for (const [lat, lon] of item.lat_lngs || []) {
      const x = lonToMercatorX(lon);
      const y = latToMercatorY(lat);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const padX = Math.max((maxX - minX) * PADDING_RATIO, 0.01);
  const padY = Math.max((maxY - minY) * PADDING_RATIO, 0.01);
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
}

function projectPoint(lat, lon, bounds, width, height) {
  const x = lonToMercatorX(lon);
  const y = latToMercatorY(lat);
  return {
    x: ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    y: ((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * height,
  };
}

function pathFromPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return "";
  if (points.length === 2) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  }

  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = ((current.x + next.x) / 2).toFixed(2);
    const midY = ((current.y + next.y) / 2).toFixed(2);
    d += ` Q${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` T${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}

function smoothPolyline(points, iterations = 4) {
  if (!Array.isArray(points) || points.length < 3) return points;
  let current = points.map((point) => ({ x: point.x, y: point.y }));
  for (let i = 0; i < iterations; i += 1) {
    if (current.length < 3) break;
    const next = [current[0]];
    for (let j = 0; j < current.length - 1; j += 1) {
      const p0 = current[j];
      const p1 = current[j + 1];
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function samplePolyline(points, offset = SAMPLE_OFFSET, repeat = SAMPLE_REPEAT) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const segments = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt((dx * dx) + (dy * dy));
    if (length <= 0.0001) continue;
    segments.push({ a, b, dx, dy, length, start: totalLength, end: totalLength + length });
    totalLength += length;
  }
  const samples = [];
  for (let distance = offset; distance < totalLength; distance += repeat) {
    const segment = segments.find((entry) => distance >= entry.start && distance <= entry.end);
    if (!segment) continue;
    const local = distance - segment.start;
    const ratio = local / segment.length;
    const x = segment.a.x + segment.dx * ratio;
    const y = segment.a.y + segment.dy * ratio;
    const angle = Math.atan2(segment.dy, segment.dx) * (180 / Math.PI);
    samples.push({ x, y, angle });
  }
  return samples;
}

function polygonSignedArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a.x * b.y) - (b.x * a.y);
  }
  return area / 2;
}

function applyOutwardOffset(samples, points) {
  const signedArea = polygonSignedArea(points);
  const isClockwise = signedArea < 0;

  return samples.map((sample) => {
    const rad = (sample.angle * Math.PI) / 180;
    const nx = isClockwise ? Math.sin(rad) : -Math.sin(rad);
    const ny = isClockwise ? -Math.cos(rad) : Math.cos(rad);
    return {
      ...sample,
      x: sample.x + (nx * SCALLOP_OFFSET),
      y: sample.y + (ny * SCALLOP_OFFSET),
      nx,
      ny,
    };
  });
}

function createScallopSvg(color) {
  return `<path d="M-${SCALLOP_RADIUS} 0 A${SCALLOP_RADIUS} ${SCALLOP_RADIUS} 0 0 1 ${SCALLOP_RADIUS} 0" fill="none" stroke="${color}" stroke-width="6.2" stroke-linecap="round" />`;
}

async function renderSigwxCloudOverlay(sigwxLow, dataRoot, canonicalHash) {
  const cloudItems = (sigwxLow?.items || [])
    .filter((item) => isCbCloudBoundary(item) && Array.isArray(item.lat_lngs) && item.lat_lngs.length >= 3);

  if (!cloudItems.length) return null;
  const boundsMerc = buildBounds(cloudItems);
  if (!boundsMerc) return null;

  const width = OUTPUT_WIDTH;
  const height = Math.max(1, Math.round(((boundsMerc.maxY - boundsMerc.minY) / (boundsMerc.maxX - boundsMerc.minX)) * width));
  const projected = cloudItems.map((item) => ({
    ...item,
    color: CB_COLOR,
    smoothedPoints: smoothPolyline(item.lat_lngs.map(([lat, lon]) => projectPoint(lat, lon, boundsMerc, width, height))),
  }));

  const svgParts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="transparent" />`,
  ];

  for (const item of projected) {
    const closedPoints = [...item.smoothedPoints, item.smoothedPoints[0]];
    const pathD = pathFromPoints(closedPoints);
    if (!pathD) continue;
    svgParts.push(`<path d="${escapeXml(pathD)}" fill="none" stroke="${item.color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3" />`);
    const samples = applyOutwardOffset(samplePolyline(closedPoints), item.smoothedPoints);
    samples.forEach((sample) => {
      svgParts.push(`<g transform="translate(${sample.x.toFixed(2)} ${sample.y.toFixed(2)}) rotate(${sample.angle.toFixed(2)})">${createScallopSvg(item.color)}</g>`);
    });
  }

  svgParts.push(`</svg>`);
  const pngBuffer = await sharp(Buffer.from(svgParts.join(""))).png({ compressionLevel: 3 }).toBuffer();

  const dir = path.join(dataRoot, "sigwx_low");
  fs.mkdirSync(dir, { recursive: true });
  const tmfc = sigwxLow?.tmfc || "latest";
  const filename = `clouds_${tmfc}.png`;
  const metaFilename = `clouds_meta_${tmfc}.json`;
  fs.writeFileSync(path.join(dir, filename), pngBuffer);

  const south = mercatorYToLat(boundsMerc.minY);
  const north = mercatorYToLat(boundsMerc.maxY);
  const west = (boundsMerc.minX * 180) / Math.PI;
  const east = (boundsMerc.maxX * 180) / Math.PI;

  const meta = {
    type: "SIGWX_LOW_CLOUDS",
    render_version: RENDER_VERSION,
    updated_at: new Date().toISOString(),
    tmfc,
    source_hash: canonicalHash || null,
    latest: {
      tmfc,
      render_version: RENDER_VERSION,
      path: `/data/sigwx_low/${filename}`,
      bounds: [
        [south, west],
        [north, east],
      ],
      width,
      height,
      cloudCount: projected.length,
    },
  };

  fs.writeFileSync(path.join(dir, metaFilename), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

export { RENDER_VERSION, renderSigwxCloudOverlay }
export default { RENDER_VERSION, renderSigwxCloudOverlay }
