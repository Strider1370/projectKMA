import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_CONFIG } from '../../config/mapConfig.js'
import './MapView.css'

const ROAD_VISIBILITY_ZOOM = 8
const HIDDEN_ROAD_COLOR = 'rgba(255, 255, 255, 0)'
const VISIBLE_ROAD_COLORS = {
  roads: '#d6dde6',
  trunks: '#c6d1dd',
  motorways: '#b9c7d4',
}
const FIR_SOURCE_ID = 'rkrr-fir'
const FIR_OUTLINE_LAYER_ID = 'rkrr-fir-outline'

function applyRoadVisibility(map, showRoads) {
  map.setConfigProperty('basemap', 'colorRoads', showRoads ? VISIBLE_ROAD_COLORS.roads : HIDDEN_ROAD_COLOR)
  map.setConfigProperty('basemap', 'colorTrunks', showRoads ? VISIBLE_ROAD_COLORS.trunks : HIDDEN_ROAD_COLOR)
  map.setConfigProperty('basemap', 'colorMotorways', showRoads ? VISIBLE_ROAD_COLORS.motorways : HIDDEN_ROAD_COLOR)
}

function addFirLayers(map) {
  if (!map.getSource(FIR_SOURCE_ID)) {
    map.addSource(FIR_SOURCE_ID, {
      type: 'geojson',
      data: '/rkrr_fir.geojson',
    })
  }

  if (!map.getLayer(FIR_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: FIR_OUTLINE_LAYER_ID,
      type: 'line',
      source: FIR_SOURCE_ID,
      slot: 'top',
      paint: {
        'line-color': '#2563eb',
        'line-width': 2,
        'line-opacity': 0.85,
      },
    })
  }
}

function MapView() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)

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
      addFirLayers(map)

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

  return <div ref={mapContainerRef} className="map-view" />
}

export default MapView