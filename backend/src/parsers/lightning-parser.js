function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseKstTm14(tm) {
  const token = String(tm || "").trim();
  if (!/^\d{14}$/.test(token)) return null;

  const y = Number(token.slice(0, 4));
  const m = Number(token.slice(4, 6));
  const d = Number(token.slice(6, 8));
  const hh = Number(token.slice(8, 10));
  const mi = Number(token.slice(10, 12));
  const ss = Number(token.slice(12, 14));

  const utcMs = Date.UTC(y, m - 1, d, hh - 9, mi, ss, 0);
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function kstToUtcIso(tm) {
  const date = parseKstTm14(tm);
  return date ? date.toISOString() : null;
}

function kstToKstIso(tm) {
  const token = String(tm || "").trim();
  if (!/^\d{14}$/.test(token)) return null;
  const y = token.slice(0, 4);
  const m = token.slice(4, 6);
  const d = token.slice(6, 8);
  const hh = token.slice(8, 10);
  const mi = token.slice(10, 12);
  const ss = token.slice(12, 14);
  return `${y}-${m}-${d}T${hh}:${mi}:${ss}+09:00`;
}

function classifyStrike(strike, airport, zones) {
  const dist = haversineKm(airport.lat, airport.lon, strike.lat, strike.lon);
  let zone = "outside";
  if (dist <= zones.alert) zone = "alert";
  else if (dist <= zones.danger) zone = "danger";
  else if (dist <= zones.caution) zone = "caution";

  return {
    ...strike,
    distance_km: Math.round(dist * 10) / 10,
    zone
  };
}

function parse(responseText, airport, zones, options = {}) {
  const text = String(responseText || "");
  if (!text.includes("#START7777") || !text.includes("#7777END")) {
    throw new Error("Invalid lightning payload markers");
  }

  const strikes = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;

    const [tm, lonRaw, latRaw, stRaw, typeRaw, htRaw] = parts;
    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    const intensity = Number(stRaw);
    const type = String(typeRaw || "").toUpperCase();
    const utcIso = kstToUtcIso(tm);
    const kstIso = kstToKstIso(tm);

    if (!utcIso || !kstIso || !Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(intensity)) continue;
    if (type !== "G" && type !== "C") continue;

    const strike = {
      time: utcIso,
      time_kst: kstIso,
      lon,
      lat,
      intensity,
      intensity_abs: Math.abs(intensity),
      polarity: intensity >= 0 ? "positive" : "negative",
      type,
      type_name: type === "G" ? "ground" : "cloud",
      height: type === "C" && Number.isFinite(Number(htRaw)) ? Number(htRaw) : null
    };

    if (options.classify === false) {
      strikes.push(strike);
      continue;
    }

    const classified = classifyStrike(strike, airport, zones);
    const shouldInclude = classified.zone !== "outside" || options.includeOutside === true;
    if (!shouldInclude) continue;

    if (options.forceZone) {
      strikes.push({
        ...classified,
        zone: options.forceZone
      });
      continue;
    }

    strikes.push(classified);
  }

  strikes.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return strikes;
}

export { parse, classifyStrike, haversineKm, kstToUtcIso, kstToKstIso }
export default { parse, classifyStrike, haversineKm, kstToUtcIso, kstToKstIso }
