import { useEffect, useMemo, useState } from 'react'
import { loadWeatherData } from './api/weatherApi.js'
import AirportPanel from './components/AirportPanel/AirportPanel.jsx'
import MapView from './components/Map/MapView.jsx'
import Sidebar from './components/Sidebar/Sidebar.jsx'

function formatUtcTime(date) {
  const day   = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const mins  = String(date.getUTCMinutes()).padStart(2, '0')
  return `${day}/${month} ${hours}:${mins} UTC`
}

const REFRESH_INTERVAL_MS = 60_000

function App() {
  const [utcTime, setUtcTime] = useState(() => formatUtcTime(new Date()))
  const [activePanel, setActivePanel] = useState(null)
  const [selectedAirport, setSelectedAirport] = useState(null)
  const [weatherData, setWeatherData] = useState(null)

  // UTC clock
  useEffect(() => {
    const timer = window.setInterval(() => setUtcTime(formatUtcTime(new Date())), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Weather data fetch loop
  useEffect(() => {
    let mounted = true

    async function fetchData() {
      try {
        const data = await loadWeatherData()
        if (mounted) setWeatherData(data)
      } catch (err) {
        console.warn('[App] Weather data fetch failed:', err.message)
      }
    }

    fetchData()
    const timer = window.setInterval(fetchData, REFRESH_INTERVAL_MS)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [])

  function togglePanel(panelId) {
    setActivePanel((cur) => (cur === panelId ? null : panelId))
  }

  const selectedAirportMeta = useMemo(
    () => weatherData?.airports?.find((a) => a.icao === selectedAirport) || null,
    [weatherData, selectedAirport],
  )

  return (
    <div className="app">
      <Sidebar activePanel={activePanel} onPanelToggle={togglePanel} />
      <main className="map-shell">
        <MapView
          activePanel={activePanel}
          airports={weatherData?.airports || []}
          echoMeta={weatherData?.echoMeta || null}
          satMeta={weatherData?.satMeta || null}
          sigmetData={weatherData?.sigmet || null}
          airmetData={weatherData?.airmet || null}
          lightningData={weatherData?.lightning || null}
          sigwxFrontMeta={weatherData?.sigwxFrontMeta || null}
          selectedAirport={selectedAirport}
          onAirportSelect={setSelectedAirport}
        />
      </main>
      <AirportPanel
        airport={selectedAirportMeta}
        weatherData={weatherData}
        onClose={() => setSelectedAirport(null)}
      />
      <div className="utc-bar">{utcTime}</div>
    </div>
  )
}

export default App
