export function toArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function text(value) {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    if (value['#text'] != null) return String(value['#text'])
    if (value['__text'] != null) return String(value['__text'])
  }
  return null
}

export function number(value) {
  const raw = text(value)
  if (raw == null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function lastToken(raw, separators = ['/', '#']) {
  if (!raw) return ''
  let out = String(raw)
  for (const sep of separators) out = out.split(sep).pop()
  return out.trim()
}

function normalizeWindUnit(rawUnit) {
  const unit = String(rawUnit || '').trim().toLowerCase()
  if (unit === '[kn_i]' || unit === 'kt' || unit === 'knot' || unit === 'kn') return 'KT'
  return rawUnit ? String(rawUnit) : 'KT'
}

export function parseWeatherCode(rawCode) {
  if (!rawCode) return null
  const raw = lastToken(rawCode).toUpperCase()
  if (!raw) return null

  let cursor = raw
  let intensity = 'MODERATE'

  if (cursor.startsWith('+')) { intensity = 'HEAVY'; cursor = cursor.slice(1) }
  else if (cursor.startsWith('-')) { intensity = 'LIGHT'; cursor = cursor.slice(1) }
  else if (cursor.startsWith('VC')) { intensity = 'VICINITY'; cursor = cursor.slice(2) }

  const descriptors = ['MI', 'BC', 'PR', 'DR', 'BL', 'SH', 'TS', 'FZ']
  let descriptor = null
  for (const token of descriptors) {
    if (cursor.startsWith(token)) { descriptor = token; cursor = cursor.slice(2); break }
  }

  const validPhenomena = new Set([
    'RA', 'DZ', 'SN', 'SG', 'IC', 'PL', 'GR', 'GS', 'UP',
    'FG', 'BR', 'HZ', 'FU', 'VA', 'DU', 'SA', 'PY',
    'PO', 'SQ', 'FC', 'SS', 'DS',
  ])

  const phenomena = []
  for (let i = 0; i < cursor.length; i += 2) {
    const chunk = cursor.slice(i, i + 2)
    if (chunk.length === 2 && validPhenomena.has(chunk)) phenomena.push(chunk)
  }

  return { raw, intensity, descriptor, phenomena }
}

export function resolveWeatherIconKey(weather) {
  const knownIconKeys = new Set([
    'RA', 'DZ', 'SN', 'SG', 'IC', 'PL', 'GR', 'GS', 'UP',
    'SHRA', 'SHSN', 'SHGR', 'SHGS', 'SHRASN', 'SH',
    'TS', 'TSRA', 'TSSN', 'TSGR', 'TSGS', 'TSRASN', 'TSSNGR',
    'FZRA', 'FZDZ', 'FZFG',
    'BLSN', 'BLSA', 'BLDU', 'DRSN', 'DRSA', 'DRDU',
    'FG', 'MIFG', 'BCFG', 'PRFG', 'BR', 'HZ', 'FU', 'VA', 'DU', 'SA',
    'PO', 'SQ', 'FC', 'SS', 'DS',
    'CAVOK', 'NSW',
  ])

  if (!weather) return 'UNKNOWN'

  if (weather.descriptor) {
    const joined = `${weather.descriptor}${(weather.phenomena || []).join('')}`
    if (joined && knownIconKeys.has(joined)) return joined
    if (knownIconKeys.has(weather.descriptor)) return weather.descriptor
  }

  if (Array.isArray(weather.phenomena) && weather.phenomena.length > 0) {
    const first = weather.phenomena[0]
    if (knownIconKeys.has(first)) return first
  }

  return 'UNKNOWN'
}

export function pickPrimaryWeatherIcon(weatherList) {
  if (!Array.isArray(weatherList) || weatherList.length === 0) return 'NSW'

  const rank = (iconKey) => {
    if (iconKey.startsWith('TS')) return 1
    if (iconKey.startsWith('FZ')) return 2
    if (iconKey.startsWith('SH')) return 3
    if (['RA', 'SN', 'PL', 'GR', 'GS', 'DZ', 'SG', 'IC', 'UP'].includes(iconKey)) return 4
    if (['FG', 'BR', 'HZ', 'FU', 'VA', 'DU', 'SA', 'MIFG', 'BCFG', 'PRFG'].includes(iconKey)) return 5
    return 6
  }

  return weatherList
    .map((w) => w.icon_key || resolveWeatherIconKey(w))
    .sort((a, b) => rank(a) - rank(b))[0]
}

export function formatCloudBase(baseFt) {
  if (!Number.isFinite(baseFt)) return null
  const code = Math.max(0, Math.round(baseFt / 100))
  return String(code).padStart(3, '0')
}

export function parseCloudLayer(layerNode) {
  if (!layerNode || typeof layerNode !== 'object') return null

  const cloud = layerNode['iwxxm:CloudLayer'] || layerNode

  const amountHref =
    cloud['iwxxm:amount']?.['@_xlink:href'] ||
    cloud['@_xlink:href'] ||
    cloud['aixm:cloudAmount']?.['@_xlink:href']

  const amount = lastToken(amountHref).toUpperCase() || null

  const baseNode =
    cloud['iwxxm:base'] ||
    cloud['aixm:base'] ||
    cloud['iwxxm:cloudBase'] ||
    null

  let base = number(baseNode)
  if (baseNode && typeof baseNode === 'object') {
    const uom = String(baseNode['@_uom'] || '').toLowerCase()
    if (Number.isFinite(base) && uom === 'm') base = Math.round(base * 3.28084)
  }

  return {
    amount,
    base,
    raw: amount && Number.isFinite(base) ? `${amount}${formatCloudBase(base)}` : amount || null,
  }
}

function formatWindRaw(direction, speed, gust, variable) {
  if ((speed === 0 || speed == null) && (!Number.isFinite(direction) || direction === 0) && !gust && !variable) {
    return '00000KT'
  }
  const directionToken = variable ? 'VRB' : String(Math.round(direction || 0)).padStart(3, '0')
  const speedToken = String(Math.round(speed || 0)).padStart(2, '0')
  const gustToken = Number.isFinite(gust) ? `G${String(Math.round(gust)).padStart(2, '0')}` : ''
  return `${directionToken}${speedToken}${gustToken}KT`
}

function resolveWindBarb(wind) {
  const speed = Number.isFinite(wind?.speed) ? wind.speed : 0
  if (wind?.raw === '00000KT') return { barb_key: 'calm', rotation: 0, pennants: 0, long_barbs: 0, short_barbs: 0 }

  const rounded = Math.round(speed / 5) * 5
  let remaining = rounded
  const pennants = Math.floor(remaining / 50); remaining -= pennants * 50
  const longBarbs = Math.floor(remaining / 10); remaining -= longBarbs * 10
  const shortBarbs = Math.floor(remaining / 5)

  return { barb_key: String(rounded), rotation: wind?.variable ? 0 : wind?.direction || 0, pennants, long_barbs: longBarbs, short_barbs: shortBarbs }
}

export function parseWind(windNode) {
  if (!windNode || typeof windNode !== 'object') {
    const calm = { raw: '00000KT', direction: 0, speed: 0, gust: null, unit: 'KT', variable: false }
    calm.barb = resolveWindBarb(calm)
    return calm
  }

  const directionNode = windNode['iwxxm:meanWindDirection'] || windNode['iwxxm:windDirection']
  const speedNode = windNode['iwxxm:meanWindSpeed'] || windNode['iwxxm:windSpeed']
  const gustNode = windNode['iwxxm:windGustSpeed'] || windNode['iwxxm:gustSpeed']

  const direction = number(directionNode)
  const speed = number(speedNode)
  const gust = number(gustNode)
  const unit = normalizeWindUnit(speedNode?.['@_uom'] || gustNode?.['@_uom'] || windNode['@_uom'])
  const variable = String(windNode['@_variableWindDirection'] || 'false').toLowerCase() === 'true'

  const normalizedSpeed = Number.isFinite(speed) ? Math.round(speed) : 0
  const normalizedDirection = Number.isFinite(direction) ? Math.round(direction) : 0
  const normalizedGust = Number.isFinite(gust) ? Math.round(gust) : null

  const raw = formatWindRaw(normalizedDirection, normalizedSpeed, normalizedGust, variable)
  const parsed = { raw, direction: variable ? 0 : normalizedDirection, speed: normalizedSpeed, gust: normalizedGust, unit, variable, calm: raw === '00000KT' }
  parsed.barb = resolveWindBarb(parsed)
  return parsed
}

export function toMetarTempToken(v) {
  if (!Number.isFinite(v)) return '//'
  if (v < 0) return `M${String(Math.abs(v)).padStart(2, '0')}`
  return String(v).padStart(2, '0')
}

export function resolveDdhh(ddhh, anchor) {
  let token = String(ddhh || '').trim()
  if (/^\d{1,4}$/.test(token)) token = token.padStart(4, '0')
  if (!/^\d{4}$/.test(token)) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(token)) return token
    return null
  }
  const day = Number(token.slice(0, 2))
  const hour = Number(token.slice(2, 4))
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth()
  let resolved = new Date(Date.UTC(year, month, day, hour, 0, 0, 0))
  const tooPast = anchor.getTime() - resolved.getTime() > 24 * 60 * 60 * 1000
  if (tooPast) resolved = new Date(Date.UTC(year, month + 1, day, hour, 0, 0, 0))
  return resolved.toISOString().replace('.000Z', 'Z')
}

export function parseYmdhmToIso(raw) {
  const token = String(raw || '').trim()
  if (!/^\d{12}$/.test(token)) return null
  const d = new Date(Date.UTC(
    Number(token.slice(0, 4)), Number(token.slice(4, 6)) - 1,
    Number(token.slice(6, 8)), Number(token.slice(8, 10)),
    Number(token.slice(10, 12)), 0, 0
  ))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z')
}

export function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}${m}${day}T${hh}${mm}${ss}Z`
}
