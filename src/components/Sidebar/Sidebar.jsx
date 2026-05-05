import { Cloud, Clock, FileText, Layers, Settings, TriangleAlert } from 'lucide-react'
import './Sidebar.css'

const topItems = [
  { label: 'Layers', icon: Layers, active: true },
  { label: 'Cloud', icon: Cloud },
  { label: 'Alerts', icon: TriangleAlert },
  { label: 'Documents', icon: FileText },
]

const bottomItems = [
  { label: 'Clock', icon: Clock },
  { label: 'Settings', icon: Settings },
]

function SidebarButton({ item, onClick }) {
  const Icon = item.icon

  return (
    <button
      className={`sidebar-button${item.active ? ' is-active' : ''}`}
      type="button"
      aria-label={item.label}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={2} />
    </button>
  )
}

function Sidebar({ activePanel, onPanelToggle }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-group">
        {topItems.map((item) => (
          <SidebarButton
            key={item.label}
            item={{ ...item, active: item.label === 'Layers' ? activePanel === 'route-check' : item.active }}
            onClick={item.label === 'Layers' ? () => onPanelToggle('route-check') : undefined}
          />
        ))}
      </div>
      <div className="sidebar-group sidebar-group-bottom">
        {bottomItems.map((item) => (
          <SidebarButton key={item.label} item={item} />
        ))}
      </div>
    </aside>
  )
}

export default Sidebar
