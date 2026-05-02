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

function SidebarButton({ item }) {
  const Icon = item.icon

  return (
    <button
      className={`sidebar-button${item.active ? ' is-active' : ''}`}
      type="button"
      aria-label={item.label}
    >
      <Icon size={20} strokeWidth={2} />
    </button>
  )
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-group">
        {topItems.map((item) => (
          <SidebarButton key={item.label} item={item} />
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
