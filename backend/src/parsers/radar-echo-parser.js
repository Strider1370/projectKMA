"use strict";

import zlib from 'zlib'
import sharp from 'sharp'

const HEADER_SIZE = 1024;
const DEG2RAD = Math.PI / 180;
const RE_KM = 6371.00877;
const NX = 2305;
const NY = 2881;
const DXY = 0.5;
const BASE_OUTPUT_WIDTH = 1600;
const NO_DATA = -25000;

const PHI1 = 30.0 * DEG2RAD;
const PHI2 = 60.0 * DEG2RAD;
const PHI0 = 38.0 * DEG2RAD;
const LAM0 = 126.0 * DEG2RAD;
const GRID_X0 = 1120;
const GRID_Y0 = 1680;

const _n = Math.log(Math.cos(PHI1) / Math.cos(PHI2)) /
  Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2));
const _F = Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), _n) / _n;
const _rho0 = RE_KM * _F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), _n);

let cachedRadarBounds = null;

function latLonToGrid(latDeg, lonDeg) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const rho = RE_KM * _F / Math.pow(Math.tan(Math.PI / 4 + lat / 2), _n);
  const theta = _n * (lon - LAM0);
  return {
    x: GRID_X0 + rho * Math.sin(theta) / DXY,
    y: GRID_Y0 + (_rho0 - rho * Math.cos(theta)) / DXY,
  };
}

function gridToLatLon(x, y) {
  const xKm = (x - GRID_X0) * DXY;
  const yKm = (y - GRID_Y0) * DXY;
  const rhoX = xKm;
  const rhoY = _rho0 - yKm;
  const rho = Math.sqrt(rhoX * rhoX + rhoY * rhoY);
  const theta = Math.atan2(rhoX, rhoY);

  const lat = 2 * Math.atan(Math.pow((RE_KM * _F) / rho, 1 / _n)) - Math.PI / 2;
  const lon = LAM0 + theta / _n;

  return {
    lat: lat / DEG2RAD,
    lon: lon / DEG2RAD,
  };
}

function lonToMercatorX(lon) {
  return (lon * Math.PI) / 180;
}

function latToMercatorY(lat) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * DEG2RAD);
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function mercatorYToLat(y) {
  return Math.atan(Math.sinh(y)) / DEG2RAD;
}

function dBZtoRGBA(dBZ) {
  if (dBZ < 5) return null;
  if (dBZ < 10) return [0, 236, 236, 160];
  if (dBZ < 15) return [1, 160, 246, 170];
  if (dBZ < 20) return [0, 0, 246, 180];
  if (dBZ < 25) return [0, 255, 0, 190];
  if (dBZ < 30) return [0, 200, 0, 200];
  if (dBZ < 35) return [255, 255, 0, 210];
  if (dBZ < 40) return [255, 200, 0, 220];
  if (dBZ < 45) return [255, 140, 0, 230];
  if (dBZ < 50) return [255, 0, 0, 240];
  if (dBZ < 55) return [200, 0, 0, 245];
  if (dBZ < 60) return [180, 0, 200, 250];
  return [255, 0, 255, 255];
}

function dBZToRainRate(dBZ) {
  const z = Math.pow(10, dBZ / 10);
  return Math.pow(z / 200, 1 / 1.6);
}

function rainRateToRGBA(rate) {
  if (!Number.isFinite(rate) || rate < 0) return null;
  if (rate >= 150) return [51, 50, 59, 255];
  if (rate >= 110) return [2, 4, 138, 255];
  if (rate >= 90) return [75, 79, 170, 255];
  if (rate >= 70) return [178, 180, 219, 255];
  if (rate >= 60) return [141, 6, 219, 255];
  if (rate >= 50) return [174, 44, 250, 255];
  if (rate >= 40) return [201, 107, 248, 255];
  if (rate >= 30) return [223, 170, 250, 255];
  if (rate >= 25) return [174, 5, 7, 255];
  if (rate >= 20) return [202, 4, 6, 255];
  if (rate >= 15) return [246, 61, 4, 255];
  if (rate >= 10) return [237, 118, 7, 255];
  if (rate >= 9) return [211, 175, 10, 255];
  if (rate >= 8) return [237, 196, 10, 255];
  if (rate >= 7) return [251, 218, 32, 255];
  if (rate >= 6) return [254, 247, 19, 255];
  if (rate >= 5) return [18, 92, 5, 255];
  if (rate >= 4) return [7, 135, 6, 255];
  if (rate >= 3) return [6, 187, 8, 255];
  if (rate >= 2) return [8, 250, 8, 255];
  if (rate >= 1) return [4, 74, 231, 255];
  if (rate >= 0.5) return [6, 153, 238, 255];
  if (rate >= 0.1) return [8, 198, 246, 255];
  return null;
}

function loadRadarBounds() {
  if (cachedRadarBounds) return cachedRadarBounds;

  const sampleXStep = Math.max(1, Math.floor((NX - 1) / 256));
  const sampleYStep = Math.max(1, Math.floor((NY - 1) / 256));
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function capturePoint(x, y) {
    const p = gridToLatLon(x, y);
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
    west = Math.min(west, p.lon);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lon);
    north = Math.max(north, p.lat);
  }

  for (let x = 0; x < NX; x += sampleXStep) {
    capturePoint(x, 0);
    capturePoint(x, NY - 1);
  }
  capturePoint(NX - 1, 0);
  capturePoint(NX - 1, NY - 1);

  for (let y = 0; y < NY; y += sampleYStep) {
    capturePoint(0, y);
    capturePoint(NX - 1, y);
  }
  capturePoint(0, NY - 1);
  capturePoint(NX - 1, NY - 1);

  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    throw new Error("Failed to derive radar coverage bounds");
  }

  cachedRadarBounds = { west, south, east, north };
  return cachedRadarBounds;
}

function parseHeader(buf, read16) {
  return {
    nx: read16(buf, 20),
    ny: read16(buf, 22),
  };
}

function parseRadarBinary(gzBuffer) {
  const raw = zlib.gunzipSync(gzBuffer);
  const readLE = (b, o) => b.readInt16LE(o);
  const readBE = (b, o) => b.readInt16BE(o);

  let header = parseHeader(raw, readLE);
  let read16 = readLE;

  if (header.nx !== NX || header.ny !== NY) {
    header = parseHeader(raw, readBE);
    read16 = readBE;
  }

  if (header.nx !== NX || header.ny !== NY) {
    throw new Error(`Unexpected grid ${header.nx}x${header.ny} (expected ${NX}x${NY})`);
  }

  const pixelCount = NX * NY;
  const refl = new Int16Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    refl[i] = read16(raw, HEADER_SIZE + i * 2);
  }

  return { refl, nx: NX, ny: NY };
}

async function cropAirportEcho(refl, lat, lon, rangeKm = 100, cropSize = 200) {
  const center = latLonToGrid(lat, lon);
  const halfGrids = rangeKm / DXY;
  const gxMin = Math.floor(center.x - halfGrids);
  const gyMin = Math.floor(center.y - halfGrids);
  const gxMax = Math.ceil(center.x + halfGrids);
  const gyMax = Math.ceil(center.y + halfGrids);
  const srcW = gxMax - gxMin;
  const srcH = gyMax - gyMin;
  const buf = Buffer.alloc(cropSize * cropSize * 4);
  let echoCount = 0;

  for (let gy = gyMin; gy < gyMax; gy++) {
    const imgRow = Math.floor((gyMax - 1 - gy) / (srcH / cropSize));
    if (imgRow < 0 || imgRow >= cropSize) continue;

    for (let gx = gxMin; gx < gxMax; gx++) {
      const imgCol = Math.floor((gx - gxMin) / (srcW / cropSize));
      if (imgCol < 0 || imgCol >= cropSize) continue;
      if (gx < 0 || gx >= NX || gy < 0 || gy >= NY) continue;

      const v = refl[gy * NX + gx];
      if (v <= NO_DATA) continue;

      const color = dBZtoRGBA(v / 100);
      if (!color) continue;

      echoCount++;
      const o = (imgRow * cropSize + imgCol) * 4;
      if (buf[o + 3] === 0 || color[3] > buf[o + 3]) {
        buf[o] = color[0];
        buf[o + 1] = color[1];
        buf[o + 2] = color[2];
        buf[o + 3] = color[3];
      }
    }
  }

  const latRange = rangeKm / 111.32;
  const lonRange = rangeKm / (111.32 * Math.cos(lat * DEG2RAD));
  const bounds = [
    [lat - latRange, lon - lonRange],
    [lat + latRange, lon + lonRange],
  ];

  const pngBuffer = await sharp(buf, {
    raw: { width: cropSize, height: cropSize, channels: 4 },
  }).png({ compressionLevel: 3 }).toBuffer();

  return { pngBuffer, bounds, echoCount, width: cropSize, height: cropSize };
}

async function renderFullCoverageEcho(refl, scale = 1) {
  const { west, south, east, north } = loadRadarBounds();
  const minX = lonToMercatorX(west);
  const maxX = lonToMercatorX(east);
  const minY = latToMercatorY(south);
  const maxY = latToMercatorY(north);
  const outW = Math.max(1, Math.round(BASE_OUTPUT_WIDTH / scale));
  const outH = Math.max(1, Math.round(((maxY - minY) / (maxX - minX)) * outW));
  const buf = Buffer.alloc(outW * outH * 4);
  let echoCount = 0;

  for (let py = 0; py < outH; py++) {
    const mercY = maxY - ((py + 0.5) / outH) * (maxY - minY);
    const lat = mercatorYToLat(mercY);

    for (let px = 0; px < outW; px++) {
      const lon = west + ((px + 0.5) / outW) * (east - west);
      const grid = latLonToGrid(lat, lon);
      const gx = Math.round(grid.x);
      const gy = Math.round(grid.y);
      if (gx < 0 || gx >= NX || gy < 0 || gy >= NY) continue;

      const v = refl[gy * NX + gx];
      if (v <= NO_DATA) continue;

      const color = rainRateToRGBA(dBZToRainRate(v / 100));
      if (!color) continue;

      echoCount++;
      const o = (py * outW + px) * 4;
      buf[o] = color[0];
      buf[o + 1] = color[1];
      buf[o + 2] = color[2];
      buf[o + 3] = color[3];
    }
  }

  const bounds = [
    [south, west],
    [north, east],
  ];

  const pngBuffer = await sharp(buf, {
    raw: { width: outW, height: outH, channels: 4 },
  }).png({ compressionLevel: 3 }).toBuffer();

  return {
    pngBuffer,
    bounds,
    echoCount,
    width: outW,
    height: outH,
    scale,
  };
}

export const renderNationwideEcho = renderFullCoverageEcho
export { parseRadarBinary, cropAirportEcho, renderFullCoverageEcho, latLonToGrid, gridToLatLon, dBZtoRGBA, dBZToRainRate, rainRateToRGBA }
export default { parseRadarBinary, cropAirportEcho, renderFullCoverageEcho, renderNationwideEcho: renderFullCoverageEcho, latLonToGrid, gridToLatLon, dBZtoRGBA, dBZToRainRate, rainRateToRGBA }
