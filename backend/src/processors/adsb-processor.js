import crypto from 'crypto'
import fs from 'fs'
import https from 'https'
import path from 'path'
import config from '../config.js'

// Point-in-polygon (ray casting) for FIR boundary filtering
let _firPolygon = null;
function loadFirPolygon() {
  if (_firPolygon) return _firPolygon;
  try {
    const firPath = path.join(__dirname, "../../../frontend/public/geo/rkrr_fir.geojson");
    const geojson = JSON.parse(fs.readFileSync(firPath, "utf8"));
    const feature = geojson.features?.[0];
    if (feature?.geometry?.type === "Polygon") {
      _firPolygon = feature.geometry.coordinates[0]; // outer ring
    }
  } catch (_) {
    _firPolygon = null;
  }
  return _firPolygon;
}

function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function isInFir(lon, lat) {
  const ring = loadFirPolygon();
  if (!ring) return true; // FIR 데이터 없으면 필터링 안 함
  return pointInPolygon(lon, lat, ring);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (key === "updated_at" || key === "fetched_at" || key === "content_hash") {
        continue;
      }
      out[key] = canonicalize(value[key]);
    }
    return out;
  }

  return value;
}

function contentHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getAdsbDir() {
  return path.join(config.storage.base_path, "adsb");
}

async function fetchWithTimeout(url, timeoutMs = config.adsb.timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "KMA-Weather-Dashboard/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error?.cause?.code !== "SELF_SIGNED_CERT_IN_CHAIN") {
        throw error;
      }

      return await fetchViaHttpsRequest(url, timeoutMs);
    }
  } finally {
    clearTimeout(timer);
  }
}

function fetchViaHttpsRequest(url, timeoutMs) {
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
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Request timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

function buildUrl() {
  const params = new URLSearchParams({
    lamin: String(config.adsb.bounds.lamin),
    lomin: String(config.adsb.bounds.lomin),
    lamax: String(config.adsb.bounds.lamax),
    lomax: String(config.adsb.bounds.lomax)
  });
  return `${config.adsb.url}?${params.toString()}`;
}

function normalizeState(state) {
  const [
    icao24,
    callsign,
    origin_country,
    time_position,
    last_contact,
    longitude,
    latitude,
    baro_altitude,
    on_ground,
    velocity,
    true_track,
    vertical_rate,
    ,
    geo_altitude,
    squawk,
    spi,
    position_source
  ] = state;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  return {
    icao24,
    callsign: typeof callsign === "string" ? callsign.trim() : null,
    origin_country: origin_country || null,
    time_position: time_position || null,
    last_contact: last_contact || null,
    lat: latitude,
    lon: longitude,
    baro_altitude: typeof baro_altitude === "number" ? baro_altitude : null,
    geo_altitude: typeof geo_altitude === "number" ? geo_altitude : null,
    velocity: typeof velocity === "number" ? velocity : null,
    true_track: typeof true_track === "number" ? true_track : null,
    vertical_rate: typeof vertical_rate === "number" ? vertical_rate : null,
    squawk: squawk || null,
    spi: Boolean(spi),
    position_source: position_source ?? null,
    on_ground: Boolean(on_ground)
  };
}

async function process() {
  const dir = getAdsbDir();
  fs.mkdirSync(dir, { recursive: true });

  const raw = await fetchWithTimeout(buildUrl());
  const aircraft = (raw.states || [])
    .map(normalizeState)
    .filter(Boolean)
    .filter((a) => isInFir(a.lon, a.lat))
    .sort((a, b) => {
      const left = `${a.callsign || ""}-${a.icao24 || ""}`;
      const right = `${b.callsign || ""}-${b.icao24 || ""}`;
      return left.localeCompare(right);
    });

  const snapshot = {
    type: "adsb",
    source: "opensky-network",
    fetched_at: new Date().toISOString(),
    updated_at: new Date((raw.time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    bounds: { ...config.adsb.bounds },
    total_aircraft: aircraft.length,
    aircraft
  };

  snapshot.content_hash = contentHash(snapshot);
  writeJson(path.join(dir, "latest.json"), snapshot);

  return {
    type: "adsb",
    saved: true,
    totalAircraft: snapshot.total_aircraft,
    updatedAt: snapshot.updated_at
  };
}

export { process }
export default { process }
