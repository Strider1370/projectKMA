import { useState } from 'react'
import { AIRPORT_NAME_KO } from '../../api/weatherApi.js'
import './AirportPanel.css'

const TABS = [
  { id: 'metar', label: 'METAR' },
  { id: 'taf',   label: 'TAF' },
  { id: 'amos',  label: 'AMOS' },
  { id: 'warn',  label: 'WARNING' },
]

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${dd}/${hh}${mm}Z`
  } catch { return iso }
}

function fmtKst(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const kst = new Date(d.getTime() + 9 * 3600 * 1000)
    return kst.toISOString().replace('T', ' ').slice(0, 16) + ' KST'
  } catch { return iso }
}

// ── METAR tab ────────────────────────────────────────────────────────────────

function MetarTab({ metar }) {
  if (!metar) return <div className="ap-empty">METAR 데이터 없음</div>
  const obs = metar.observation
  const disp = obs?.display
  const hdr  = metar.header

  return (
    <div className="ap-metar">
      {metar.raw && <div className="ap-raw">{metar.raw}</div>}
      <dl className="ap-dl">
        <div><dt>관측시각</dt><dd>{fmtTime(hdr?.observation_time || hdr?.issue_time)}</dd></div>
        <div><dt>바람</dt><dd>{disp?.wind ?? '—'}</dd></div>
        <div><dt>시정</dt><dd>{disp?.visibility != null ? `${disp.visibility} m` : '—'}</dd></div>
        {disp?.weather && <div><dt>현재날씨</dt><dd>{disp.weather}</dd></div>}
        <div><dt>구름</dt><dd>{disp?.clouds ?? '—'}</dd></div>
        <div><dt>기온/이슬점</dt><dd>{disp?.temperature ?? '—'}</dd></div>
        <div><dt>QNH</dt><dd>{disp?.qnh ?? '—'}</dd></div>
        {obs?.rvr?.length > 0 && (
          <div><dt>RVR</dt><dd>{obs.rvr.map((r) => `R${r.runway}/${r.mean}m`).join(' ')}</dd></div>
        )}
        {obs?.wind_shear && (
          <div>
            <dt>Wind Shear</dt>
            <dd>{obs.wind_shear.all_runways ? 'All Rwys' : obs.wind_shear.runways?.join(', ') || '—'}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

// ── TAF tab ──────────────────────────────────────────────────────────────────

function TafPeriod({ period }) {
  const typeLabel = {
    base: 'BASE', becmg: 'BECMG', tempo: 'TEMPO', prob30: 'PROB30', prob40: 'PROB40',
  }[period.type] || period.type?.toUpperCase() || '—'

  const wind = period.wind
    ? `${String(period.wind.direction).padStart(3, '0')}/${period.wind.speed}${period.wind.gust ? `G${period.wind.gust}` : ''}${period.wind.unit || 'KT'}`
    : null

  const vis = period.visibility?.value != null ? `${period.visibility.value} m` : null
  const clouds = period.clouds?.map((c) => `${c.amount}${c.height}`).join(' ') || null
  const wx = period.weather?.map((w) => w.raw || w).join(' ') || null

  return (
    <div className="ap-taf-period">
      <div className="ap-taf-period-header">
        <span className={`ap-taf-type ap-taf-type--${period.type}`}>{typeLabel}</span>
        <span className="ap-taf-time">{fmtTime(period.from)} – {fmtTime(period.to)}</span>
      </div>
      <div className="ap-taf-period-body">
        {wind && <span>{wind}</span>}
        {vis && <span>{vis}</span>}
        {wx && <span>{wx}</span>}
        {clouds && <span>{clouds}</span>}
      </div>
    </div>
  )
}

function TafTab({ taf }) {
  if (!taf) return <div className="ap-empty">TAF 데이터 없음</div>
  const hdr = taf.header
  const periods = taf.periods || []

  return (
    <div className="ap-taf">
      {hdr && (
        <div className="ap-taf-header">
          <span>발표: {fmtTime(hdr.issued)}</span>
          <span>유효: {fmtTime(hdr.valid_start)} – {fmtTime(hdr.valid_end)}</span>
        </div>
      )}
      {periods.length === 0
        ? <div className="ap-empty">예보 기간 없음</div>
        : periods.map((p, i) => <TafPeriod key={i} period={p} />)
      }
    </div>
  )
}

// ── AMOS tab ─────────────────────────────────────────────────────────────────

function AmosTab({ amos }) {
  if (!amos) return <div className="ap-empty">AMOS 데이터 없음</div>
  const rf = amos.daily_rainfall

  return (
    <div className="ap-amos">
      <dl className="ap-dl">
        <div><dt>관측소</dt><dd>{amos.amos_stn ?? '—'}</dd></div>
        <div><dt>일강수량</dt><dd>{rf?.mm != null ? `${rf.mm} mm` : '—'}</dd></div>
        <div><dt>관측시각</dt><dd>{rf?.observed_tm_kst ? fmtKst(rf.observed_tm_kst) : '—'}</dd></div>
        <div><dt>데이터 상태</dt><dd>{rf?.stale ? '⚠ 이전 데이터' : '최신'}</dd></div>
      </dl>
    </div>
  )
}

// ── WARNING tab ───────────────────────────────────────────────────────────────

const WARNING_LEVEL_COLOR = {
  1: '#f59e0b', 2: '#f97316', 3: '#ef4444', 4: '#dc2626',
}

function WarningTab({ warning }) {
  const warnings = warning?.warnings || []

  if (warnings.length === 0) return <div className="ap-empty">현재 활성 경보 없음</div>

  return (
    <div className="ap-warnings">
      {warnings.map((w, i) => (
        <div key={i} className="ap-warning-item" style={{ borderLeftColor: WARNING_LEVEL_COLOR[w.level] || '#94a3b8' }}>
          <div className="ap-warning-title">
            <span className="ap-warning-type">{w.type_label || w.type || '경보'}</span>
            {w.level && <span className="ap-warning-level">Level {w.level}</span>}
          </div>
          <div className="ap-warning-time">
            {fmtKst(w.start)} – {fmtKst(w.end)}
          </div>
          {w.text && <div className="ap-warning-text">{w.text}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

function AirportPanel({ airport, weatherData, onClose }) {
  const [tab, setTab] = useState('metar')

  if (!airport) return null

  const icao = airport.icao
  const name = airport.nameKo || AIRPORT_NAME_KO[icao] || airport.name || icao

  const metar   = weatherData?.metar?.airports?.[icao] || null
  const taf     = weatherData?.taf?.airports?.[icao] || null
  const amos    = weatherData?.amos?.airports?.[icao] || null
  const warning = weatherData?.warning?.airports?.[icao] || null
  const warnCount = warning?.warnings?.length || 0

  return (
    <aside className="airport-panel">
      <header className="airport-panel-head">
        <div className="airport-panel-info">
          <span className="airport-panel-icao">{icao}</span>
          <span className="airport-panel-name">{name}</span>
        </div>
        <button className="airport-panel-close" onClick={onClose} aria-label="닫기">✕</button>
      </header>

      <nav className="airport-panel-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`airport-panel-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'warn' && warnCount > 0 && (
              <span className="ap-tab-badge">{warnCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="airport-panel-body">
        {tab === 'metar' && <MetarTab metar={metar} />}
        {tab === 'taf'   && <TafTab taf={taf} />}
        {tab === 'amos'  && <AmosTab amos={amos} />}
        {tab === 'warn'  && <WarningTab warning={warning} />}
      </div>
    </aside>
  )
}

export default AirportPanel
