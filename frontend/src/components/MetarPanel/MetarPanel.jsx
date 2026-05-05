import { useEffect, useState } from 'react'
import './MetarPanel.css'

function formatTime(isoString) {
  if (!isoString) return 'N/A'
  try {
    const d = new Date(isoString)
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${dd}/${hh}${mm}Z`
  } catch {
    return isoString
  }
}

function MetarPanel({ icao, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)

  useEffect(() => {
    if (!icao) return

    setLoading(true)
    setError(null)
    setData(null)

    fetch('/api/metar')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        setFetchedAt(json.fetched_at)
        const airport = json.airports?.[icao]
        if (!airport) throw new Error(`No METAR data for ${icao}`)
        setData(airport)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [icao])

  const obs = data?.observation
  const display = obs?.display
  const header = data?.header

  return (
    <div className="metar-panel">
      <div className="metar-panel-header">
        <span className="metar-panel-icao">{icao}</span>
        {header?.airport_name && <span className="metar-panel-name">{header.airport_name}</span>}
        <button className="metar-panel-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="metar-panel-body">
        {loading && <div className="metar-panel-status">Loading...</div>}
        {error && <div className="metar-panel-status metar-panel-error">{error}</div>}

        {data && (
          <dl className="metar-data">
            <div>
              <dt>Type</dt>
              <dd>{header?.report_type ?? '—'}</dd>
            </div>
            <div>
              <dt>Obs Time</dt>
              <dd>{formatTime(header?.observation_time)}</dd>
            </div>
            <div>
              <dt>Wind</dt>
              <dd>{display?.wind ?? '—'}</dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>{display?.visibility != null ? `${display.visibility} m` : '—'}</dd>
            </div>
            {display?.weather && (
              <div>
                <dt>Weather</dt>
                <dd>{display.weather}</dd>
              </div>
            )}
            <div>
              <dt>Clouds</dt>
              <dd>{display?.clouds ?? '—'}</dd>
            </div>
            <div>
              <dt>Temp / Dew</dt>
              <dd>{display?.temperature ?? '—'}</dd>
            </div>
            <div>
              <dt>QNH</dt>
              <dd>{display?.qnh ?? '—'}</dd>
            </div>
            {obs?.rvr?.length > 0 && (
              <div>
                <dt>RVR</dt>
                <dd>{obs.rvr.map((r) => `R${r.runway}/${r.mean}m`).join(' ')}</dd>
              </div>
            )}
            {obs?.wind_shear && (
              <div>
                <dt>Wind Shear</dt>
                <dd>{obs.wind_shear.all_runways ? 'All runways' : (obs.wind_shear.runways?.join(', ') ?? '—')}</dd>
              </div>
            )}
          </dl>
        )}

        {fetchedAt && (
          <div className="metar-panel-fetched">
            Fetched: {fetchedAt.replace('T', ' ').slice(0, 19)} UTC
          </div>
        )}
      </div>
    </div>
  )
}

export default MetarPanel
