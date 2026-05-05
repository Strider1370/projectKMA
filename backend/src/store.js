import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import config from './config.js'

const TYPES = ['metar', 'taf', 'warning', 'lightning', 'sigmet', 'airmet', 'sigwx_low', 'amos', 'adsb', 'ground_forecast', 'ground_overview', 'environment']
const FILE_PREFIX = {
  metar: 'METAR',
  taf: 'TAF',
  warning: 'WARNINGS',
  lightning: 'LIGHTNING',
  sigmet: 'SIGMET',
  airmet: 'AIRMET',
  sigwx_low: 'SIGWX_LOW',
  amos: 'AMOS',
  ground_forecast: 'GROUND_FORECAST',
  ground_overview: 'GROUND_OVERVIEW',
  environment: 'ENVIRONMENT',
}

const cache = {
  metar: { hash: null, prev_data: null },
  taf: { hash: null, prev_data: null },
  warning: { hash: null, prev_data: null },
  lightning: { hash: null, prev_data: null },
  sigmet: { hash: null, prev_data: null },
  airmet: { hash: null, prev_data: null },
  sigwx_low: { hash: null, prev_data: null },
  amos: { hash: null, prev_data: null },
  adsb: { hash: null, prev_data: null },
  ground_forecast: { hash: null, prev_data: null },
  ground_overview: { hash: null, prev_data: null },
  environment: { hash: null, prev_data: null },
}

export function ensureDirectories(basePath) {
  for (const type of TYPES) {
    fs.mkdirSync(path.join(basePath, type), { recursive: true })
  }
}

function getTypeDir(basePath, type) {
  return path.join(basePath, type)
}

function formatFileTimestamp(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${y}${m}${d}T${hh}${mm}${ss}${ms}Z`
}

function formatSigwxLowFileLabel(tmfc) {
  const normalized = String(tmfc || '').trim()
  if (!/^\d{10}$/.test(normalized)) return null
  return normalized
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function getMaxFilesForType(type) {
  return config.storage.max_files_by_type?.[type] || config.storage.max_files_per_category
}

function rotateFiles(dir, maxCount = config.storage.max_files_per_category) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'latest.json'
      && !name.startsWith('fronts_meta_') && !name.startsWith('clouds_meta_'))
    .map((name) => ({ name, fullPath: path.join(dir, name) }))
    .sort((a, b) => b.name.localeCompare(a.name))

  for (const file of files.slice(maxCount)) {
    fs.unlinkSync(file.fullPath)
  }
}

function saveAndUpdateLatest(dir, filename, data, type = null) {
  const filePath = path.join(dir, filename)
  writeJson(filePath, data)
  writeJson(path.join(dir, 'latest.json'), data)
  rotateFiles(dir, getMaxFilesForType(type))
  return filePath
}

function cleanupSigwxLowTmfcFiles(dir, tmfc, keepFilename) {
  if (!tmfc) return
  const names = fs.readdirSync(dir).filter((name) =>
    name.endsWith('.json') && name !== 'latest.json' && name !== keepFilename
    && !name.startsWith('fronts_meta_') && !name.startsWith('clouds_meta_'))
  for (const name of names) {
    const payload = readJsonSafe(path.join(dir, name))
    if (payload?.tmfc === tmfc) fs.unlinkSync(path.join(dir, name))
  }
}

function cleanupSigwxLowOverlayFiles(dir) {
  const existingTmfc = new Set(
    fs.readdirSync(dir)
      .filter((name) => /^SIGWX_LOW_\d{10}\.json$/.test(name))
      .map((name) => name.match(/^SIGWX_LOW_(\d{10})\.json$/)?.[1])
      .filter(Boolean)
  )

  const overlayPatterns = [
    /^fronts_(\d{10})\.png$/,
    /^fronts_meta_(\d{10})\.json$/,
    /^clouds_(\d{10})\.png$/,
    /^clouds_meta_(\d{10})\.json$/,
  ]

  for (const name of fs.readdirSync(dir)) {
    for (const pattern of overlayPatterns) {
      const match = name.match(pattern)
      if (!match) continue
      if (!existingTmfc.has(match[1])) fs.unlinkSync(path.join(dir, name))
      break
    }
  }
}

export function loadLatest(dir) {
  const latestPath = path.join(dir, 'latest.json')
  if (!fs.existsSync(latestPath)) return null
  try {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8'))
  } catch {
    return null
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      if (key === 'fetched_at' || key === 'type' || key === '_stale' || key === 'content_hash') continue
      out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

export function canonicalHash(result) {
  const canonical = canonicalize(result)
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function shouldSave(type, data) {
  const newHash = canonicalHash(data)
  return { changed: cache[type].hash !== newHash, hash: newHash }
}

export function mergeWithPrevious(result, type, failedAirports) {
  if (!result || !result.airports || !Array.isArray(failedAirports) || failedAirports.length === 0) return result
  const prev = cache[type].prev_data
  if (!prev || !prev.airports) return result
  for (const icao of failedAirports) {
    const prevAirport = prev.airports[icao]
    if (prevAirport && prevAirport.header?.icao) {
      result.airports[icao] = { ...prevAirport, _stale: true }
    }
  }
  return result
}

function updateCache(type, data, hash) {
  cache[type].hash = hash
  cache[type].prev_data = data
}

export function getCached(type) {
  return cache[type]?.prev_data ?? null
}

export function initFromFiles(basePath) {
  for (const type of TYPES) {
    const dir = getTypeDir(basePath, type)
    const latest = loadLatest(dir)
    if (latest) updateCache(type, latest, canonicalHash(latest))
  }
}

export function save(type, data) {
  if (!TYPES.includes(type)) throw new Error(`Unsupported type: ${type}`)

  const basePath = config.storage.base_path
  const dir = getTypeDir(basePath, type)
  ensureDirectories(basePath)

  const decision = shouldSave(type, data)
  if (!decision.changed) {
    const latestPath = path.join(dir, 'latest.json')
    if (fs.existsSync(latestPath)) {
      const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'))
      latest.fetched_at = data.fetched_at || new Date().toISOString()
      latest.content_hash = decision.hash
      writeJson(latestPath, latest)
    }
    data.content_hash = decision.hash
    updateCache(type, data, decision.hash)
    return { saved: false, reason: 'unchanged' }
  }

  const prefix = FILE_PREFIX[type] || type.toUpperCase()
  let filename

  if (type === 'sigwx_low') {
    const sigwxLabel = formatSigwxLowFileLabel(data?.tmfc)
    filename = sigwxLabel ? `${prefix}_${sigwxLabel}.json` : `${prefix}_${formatFileTimestamp()}.json`
  } else {
    filename = `${prefix}_${formatFileTimestamp()}.json`
    let attempt = 1
    while (fs.existsSync(path.join(dir, filename))) {
      filename = `${prefix}_${formatFileTimestamp()}_${attempt}.json`
      attempt += 1
    }
  }

  data.content_hash = decision.hash
  const filePath = saveAndUpdateLatest(dir, filename, data, type)
  if (type === 'sigwx_low') {
    cleanupSigwxLowTmfcFiles(dir, data?.tmfc, filename)
    cleanupSigwxLowOverlayFiles(dir)
  }
  updateCache(type, data, decision.hash)
  return { saved: true, filePath }
}

export { cache }

export default {
  cache,
  ensureDirectories,
  saveAndUpdateLatest,
  rotateFiles,
  loadLatest,
  canonicalHash,
  mergeWithPrevious,
  getCached,
  initFromFiles,
  save,
}
