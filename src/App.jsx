import { useEffect, useState } from 'react'
import MapView from './components/Map/MapView.jsx'
import Sidebar from './components/Sidebar/Sidebar.jsx'

function formatUtcTime(date) {
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')

  return `${day}/${month} ${hours}:${minutes} UTC`
}

function App() {
  const [utcTime, setUtcTime] = useState(() => formatUtcTime(new Date()))
  const [activePanel, setActivePanel] = useState(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUtcTime(formatUtcTime(new Date()))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  function togglePanel(panelId) {
    setActivePanel((currentPanel) => (currentPanel === panelId ? null : panelId))
  }

  return (
    <div className="app">
      <Sidebar activePanel={activePanel} onPanelToggle={togglePanel} />
      <main className="map-shell">
        <MapView activePanel={activePanel} />
      </main>
      <div className="utc-bar">{utcTime}</div>
    </div>
  )
}

export default App
