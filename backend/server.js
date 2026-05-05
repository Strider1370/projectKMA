import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import store from './src/store.js'
import stats from './src/stats.js'
import config from './src/config.js'
import { main as startScheduler } from './src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.BACKEND_PORT || 3001

// Static: /data/* → backend/data/
app.use('/data', express.static(path.join(__dirname, 'data')))

function sendLatest(res, type) {
  const data = store.getCached(type)
  if (data) return res.json(data)
  res.status(503).json({ error: `${type} data unavailable` })
}

function sendJsonFile(res, filePath) {
  try {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    res.status(503).json({ error: 'data unavailable' })
  }
}

// ── API endpoints ────────────────────────────────────────────────────────────
app.get('/api/metar',           (_, res) => sendLatest(res, 'metar'))
app.get('/api/taf',             (_, res) => sendLatest(res, 'taf'))
app.get('/api/warning',         (_, res) => sendLatest(res, 'warning'))
app.get('/api/sigmet',          (_, res) => sendLatest(res, 'sigmet'))
app.get('/api/airmet',          (_, res) => sendLatest(res, 'airmet'))
app.get('/api/sigwx-low',       (_, res) => sendLatest(res, 'sigwx_low'))
app.get('/api/lightning',       (_, res) => sendLatest(res, 'lightning'))
app.get('/api/amos',            (_, res) => sendLatest(res, 'amos'))
app.get('/api/adsb',            (_, res) => sendLatest(res, 'adsb'))
app.get('/api/ground-forecast', (_, res) => sendLatest(res, 'ground_forecast'))
app.get('/api/ground-overview', (_, res) => sendLatest(res, 'ground_overview'))
app.get('/api/environment',     (_, res) => sendLatest(res, 'environment'))

app.get('/api/radar/echo-meta', (_, res) =>
  sendJsonFile(res, path.join(__dirname, 'data', 'radar', 'echo_meta.json'))
)
app.get('/api/satellite/meta', (_, res) =>
  sendJsonFile(res, path.join(__dirname, 'data', 'satellite', 'sat_meta.json'))
)

app.get('/api/airports', (_, res) => res.json(config.airports))

app.get('/api/sigwx-front-meta', (_, res) => {
  const data = store.getCached('sigwx_low')
  if (!data?.tmfc) return res.status(503).json({ error: 'sigwx data unavailable' })
  sendJsonFile(res, path.join(__dirname, 'data', 'sigwx_low', `fronts_meta_${data.tmfc}.json`))
})

app.get('/api/stats',  (_, res) => res.json(stats.getStats()))
app.get('/api/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }))

// ── Boot ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[server] Backend running on port ${PORT}`))

startScheduler().catch((err) => {
  console.error('[server] Scheduler startup error:', err.message)
  process.exit(1)
})
