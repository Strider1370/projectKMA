import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_CONFIG } from '../../config/mapConfig.js'
import { addAviationWfsLayers } from '../../layers/aviation/addAviationWfsLayers.js'
import { AVIATION_WFS_LAYERS } from '../../layers/aviation/aviationWfsLayers.js'
import './MapView.css'

const ROAD_VISIBILITY_ZOOM = 8
const HIDDEN_ROAD_COLOR = 'rgba(255, 255, 255, 0)'
const VISIBLE_ROAD_COLORS = {
  roads: '#d6dde6',
  trunks: '#c6d1dd',
  motorways: '#b9c7d4',
}

function applyRoadVisibility(map, showRoads) {
  map.setConfigProperty('basemap', 'colorRoads', showRoads ? VISIBLE_ROAD_COLORS.roads : HIDDEN_ROAD_COLOR)
  map.setConfigProperty('basemap', 'colorTrunks', showRoads ? VISIBLE_ROAD_COLORS.trunks : HIDDEN_ROAD_COLOR)
  map.setConfigProperty('basemap', 'colorMotorways', showRoads ? VISIBLE_ROAD_COLORS.motorways : HIDDEN_ROAD_COLOR)
}

function setLayerVisibility(map, layer, isVisible) {
  const visibility = isVisible ? 'visible' : 'none'

  if (layer.fillLayerId && map.getLayer(layer.fillLayerId)) {
    map.setLayoutProperty(layer.fillLayerId, 'visibility', visibility)
  }

  if (map.getLayer(layer.lineLayerId)) {
    map.setLayoutProperty(layer.lineLayerId, 'visibility', visibility)
  }
}

function createInitialLayerVisibility() {
  return AVIATION_WFS_LAYERS.reduce((visibility, layer) => {
    visibility[layer.id] = layer.defaultVisible
    return visibility
  }, {})
}

function MapView() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const [layerVisibility, setLayerVisibilityState] = useState(createInitialLayerVisibility)

  function toggleAviationLayer(layerId) {
    setLayerVisibilityState((currentVisibility) => ({
      ...currentVisibility,
      [layerId]: !currentVisibility[layerId],
    }))
  }

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return undefined
    }

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      config: {
        basemap: {
          showPlaceLabels: false,
          showPedestrianRoads: false,
          showPointOfInterestLabels: false,
          showRoadLabels: false,
          show3dObjects: false,
          show3dBuildings: false,
          show3dTrees: false,
          show3dLandmarks: false,
          showIndoorLabels: false,
          theme: 'faded',
          font: 'Noto Sans CJK JP',
          colorWater: '#88bedd',
          colorGreenspace: '#c5dcb8',
        },
      },
      center: MAP_CONFIG.center,
      zoom: MAP_CONFIG.zoom,
      minZoom: MAP_CONFIG.minZoom,
      maxZoom: MAP_CONFIG.maxZoom,
      language: 'ko',
      localIdeographFontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif',
    })

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

    map.on('style.load', () => {
      let roadsVisible = map.getZoom() >= ROAD_VISIBILITY_ZOOM

      applyRoadVisibility(map, roadsVisible)
      addAviationWfsLayers(map, import.meta.env.VITE_VWORLD_KEY, import.meta.env.VITE_VWORLD_DOMAIN)
      AVIATION_WFS_LAYERS.forEach((layer) => {
        setLayerVisibility(map, layer, layerVisibility[layer.id])
      })

      map.on('zoom', () => {
        const shouldShowRoads = map.getZoom() >= ROAD_VISIBILITY_ZOOM

        if (shouldShowRoads !== roadsVisible) {
          roadsVisible = shouldShowRoads
          applyRoadVisibility(map, roadsVisible)
        }
      })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map?.isStyleLoaded()) {
      return
    }

    AVIATION_WFS_LAYERS.forEach((layer) => {
      setLayerVisibility(map, layer, layerVisibility[layer.id])
    })
  }, [layerVisibility])

  return (
    <div className="map-view-wrapper">
      <div ref={mapContainerRef} className="map-view" />
      <div className="dev-layer-panel" aria-label="Developer layer toggles">
        <div className="dev-layer-panel-title">Layers</div>
        {AVIATION_WFS_LAYERS.map((layer) => (
          <label key={layer.id} className="dev-layer-toggle">
            <input
              type="checkbox"
              checked={layerVisibility[layer.id]}
              onChange={() => toggleAviationLayer(layer.id)}
            />
            <span className="dev-layer-swatch" style={{ background: layer.color }} />
            <span>{layer.nameEn}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default MapView
