import config from './config.js'

const { api } = config

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldDecodeEucKr(contentType) {
  return /euc-kr|ks_c_5601|cp949/i.test(contentType || '')
}

async function responseToText(response) {
  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())
  if (shouldDecodeEucKr(contentType)) {
    try { return new TextDecoder('euc-kr').decode(buffer) } catch {}
  }
  return buffer.toString('utf8')
}

export function buildUrl(type, icao = null) {
  const endpoint = api.endpoints[type]
  if (!endpoint) throw new Error(`Unknown API type: ${type}`)

  const params = new URLSearchParams({
    ...api.default_params,
    authKey: api.auth_key,
  })

  if (icao) params.set('icao', icao)
  return `${api.base_url}${endpoint}?${params.toString()}`
}

export function buildSigwxLowUrl(tmfc) {
  const params = new URLSearchParams({
    tmfc,
    authKey: api.auth_key,
  })
  return `${api.sigwx_low_url}?${params.toString()}`
}

function parseApiHeader(xmlText) {
  const codeMatch = xmlText.match(/<resultCode>([^<]+)<\/resultCode>/i)
  const msgMatch = xmlText.match(/<resultMsg>([^<]+)<\/resultMsg>/i)
  return {
    resultCode: codeMatch ? codeMatch[1].trim() : null,
    resultMsg: msgMatch ? msgMatch[1].trim() : null,
  }
}

function isSuccessByType(type, resultCode, resultMsg) {
  if (type === 'sigwx_low') return true
  if (resultCode == null) return false
  if (resultCode === '00') return true
  if (type === 'warning' && resultCode === '03' && /NO_DATA/i.test(resultMsg || '')) return true
  return false
}

async function fetchTextWithRetries(url, type, options = {}) {
  const configuredRetries = Number(api.max_retries)
  const requestedRetries = Number(options.maxRetries)
  const maxRetries = Math.min(
    3,
    Math.max(
      1,
      Number.isFinite(requestedRetries)
        ? requestedRetries
        : (Number.isFinite(configuredRetries) ? configuredRetries : 1)
    )
  )

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), api.timeout_ms)

    try {
      const response = await fetch(url, { signal: controller.signal })
      const body = await responseToText(response)

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`)
        if (response.status < 500 && response.status !== 429) {
          error.nonRetryable = true
        }
        throw error
      }

      const { resultCode, resultMsg } = parseApiHeader(body)
      if (type === 'sigwx_low' && !/<odmap_ml[\s>]/i.test(body)) {
        throw new Error('SIGWX LOW payload missing odmap_ml')
      }
      if (!isSuccessByType(type, resultCode, resultMsg)) {
        const error = new Error(`API ${resultCode}: ${resultMsg || 'UNKNOWN_ERROR'}`)
        if (/유효한 인증키/i.test(resultMsg || '')) {
          error.nonRetryable = true
        }
        throw error
      }

      return body
    } catch (error) {
      if (error.nonRetryable || attempt === maxRetries) throw error
      await sleep(60 * 1000)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('Unexpected fetch flow')
}

export async function fetchApi(type, icao = null, options = {}) {
  const url = buildUrl(type, icao)
  return fetchTextWithRetries(url, type, options)
}

export async function fetchSigwxLow(tmfc, options = {}) {
  const url = buildSigwxLowUrl(tmfc)
  return fetchTextWithRetries(url, 'sigwx_low', options)
}

export default {
  fetch: fetchApi,
  fetchSigwxLow,
  buildUrl,
  buildSigwxLowUrl,
}
