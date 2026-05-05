const FALLBACK_AIRPORTS = [
  { icao: 'RKSI', name: 'Incheon International Airport', lat: 37.4602, lon: 126.4407, runway_hdg: 150 },
  { icao: 'RKSS', name: 'Gimpo International Airport', lat: 37.5586, lon: 126.7906, runway_hdg: 140 },
  { icao: 'RKPC', name: 'Jeju International Airport', lat: 33.5104, lon: 126.4929, runway_hdg: 70 },
  { icao: 'RKPK', name: 'Gimhae International Airport', lat: 35.1795, lon: 128.9382, runway_hdg: 180 },
  { icao: 'RKJB', name: 'Muan International Airport', lat: 34.9914, lon: 126.3828, runway_hdg: 10 },
  { icao: 'RKNY', name: 'Yangyang International Airport', lat: 38.0613, lon: 128.6692, runway_hdg: 150 },
  { icao: 'RKPU', name: 'Ulsan Airport', lat: 35.5935, lon: 129.3518, runway_hdg: 180 },
  { icao: 'RKJY', name: 'Yeosu Airport', lat: 34.8424, lon: 127.6162, runway_hdg: 170 },
]

export const AIRPORT_NAME_KO = {
  RKSI: '인천국제공항',
  RKSS: '김포국제공항',
  RKPC: '제주국제공항',
  RKPK: '김해국제공항',
  RKJB: '무안국제공항',
  RKNY: '양양국제공항',
  RKPU: '울산공항',
  RKJY: '여수공항',
}

async function fetchJson(url, { optional = false } = {}) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    return res.json()
  } catch (error) {
    if (optional) return null
    throw error
  }
}

function normalizeAirports(airports) {
  const source = Array.isArray(airports) && airports.length > 0 ? airports : FALLBACK_AIRPORTS
  return source
    .filter((a) => a.icao !== 'TST1')
    .map((a) => ({ ...a, nameKo: AIRPORT_NAME_KO[a.icao] || a.name || a.icao }))
}

export async function loadWeatherData() {
  const [
    airports, metar, taf, amos, warning,
    sigmet, airmet, lightning,
    echoMeta, satMeta, sigwxFrontMeta,
  ] = await Promise.all([
    fetchJson('/api/airports',        { optional: true }),
    fetchJson('/api/metar',           { optional: true }),
    fetchJson('/api/taf',             { optional: true }),
    fetchJson('/api/amos',            { optional: true }),
    fetchJson('/api/warning',         { optional: true }),
    fetchJson('/api/sigmet',          { optional: true }),
    fetchJson('/api/airmet',          { optional: true }),
    fetchJson('/api/lightning',       { optional: true }),
    fetchJson('/data/radar/echo_meta.json',     { optional: true }),
    fetchJson('/data/satellite/sat_meta.json',  { optional: true }),
    fetchJson('/api/sigwx-front-meta',          { optional: true }),
  ])

  return {
    airports: normalizeAirports(airports),
    metar,
    taf,
    amos,
    warning,
    sigmet,
    airmet,
    lightning,
    echoMeta,
    satMeta,
    sigwxFrontMeta,
  }
}
