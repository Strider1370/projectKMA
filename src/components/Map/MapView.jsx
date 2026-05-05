import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_CONFIG } from '../../config/mapConfig.js'
import { addAviationWfsLayers } from '../../layers/aviation/addAviationWfsLayers.js'
import { AVIATION_WFS_LAYERS } from '../../layers/aviation/aviationWfsLayers.js'
import { buildBriefingRoute } from '../../services/navdata/routePlanner.js'
import './MapView.css'

const ROAD_VISIBILITY_ZOOM = 8
const ROUTE_PREVIEW_SOURCE_ID = 'briefing-route-preview'
const ROUTE_PREVIEW_LINE_LAYER_ID = 'briefing-route-preview-line'
const ROUTE_PREVIEW_POINT_LAYER_ID = 'briefing-route-preview-point'
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

  if (layer.maskLayerId && map.getLayer(layer.maskLayerId)) {
    map.setLayoutProperty(layer.maskLayerId, 'visibility', visibility)
  }

  if (layer.hoverLayerId && map.getLayer(layer.hoverLayerId)) {
    map.setLayoutProperty(layer.hoverLayerId, 'visibility', visibility)
  }

  if (layer.pointMaskLayerId && map.getLayer(layer.pointMaskLayerId)) {
    map.setLayoutProperty(layer.pointMaskLayerId, 'visibility', visibility)
  }

  if (layer.pointLayerId && map.getLayer(layer.pointLayerId)) {
    map.setLayoutProperty(layer.pointLayerId, 'visibility', visibility)
  }

  const pointLabelMaskLayerId = layer.pointLabelMaskLayerId ?? `${layer.pointLabelLayerId}-mask`
  if (layer.pointLabelLayerId && map.getLayer(pointLabelMaskLayerId)) {
    map.setLayoutProperty(pointLabelMaskLayerId, 'visibility', visibility)
  }

  if (layer.pointLabelLayerId && map.getLayer(layer.pointLabelLayerId)) {
    map.setLayoutProperty(layer.pointLabelLayerId, 'visibility', visibility)
  }

  if (layer.lineLayerId && map.getLayer(layer.lineLayerId)) {
    map.setLayoutProperty(layer.lineLayerId, 'visibility', visibility)
  }

  if (layer.routeLabelLayerId && map.getLayer(layer.routeLabelLayerId)) {
    map.setLayoutProperty(layer.routeLabelLayerId, 'visibility', visibility)
  }

  if (layer.tickLayerId && map.getLayer(layer.tickLayerId)) {
    map.setLayoutProperty(layer.tickLayerId, 'visibility', visibility)
  }

  if (layer.externalLabelLayerId && map.getLayer(layer.externalLabelLayerId)) {
    map.setLayoutProperty(layer.externalLabelLayerId, 'visibility', visibility)
  }

  if (layer.internalLabelLayerId && map.getLayer(layer.internalLabelLayerId)) {
    map.setLayoutProperty(layer.internalLabelLayerId, 'visibility', visibility)
  }

  if (layer.labelLayerId && map.getLayer(layer.labelLayerId)) {
    map.setLayoutProperty(layer.labelLayerId, 'visibility', visibility)
  }

  layer.neighborBoundaries?.forEach((boundary) => {
    if (map.getLayer(boundary.tickLayerId)) {
      map.setLayoutProperty(boundary.tickLayerId, 'visibility', visibility)
    }
  })
}

function createInitialLayerVisibility() {
  return AVIATION_WFS_LAYERS.reduce((visibility, layer) => {
    visibility[layer.id] = layer.defaultVisible
    return visibility
  }, {})
}

function bindSectorHover(map) {
  const sectorLayer = AVIATION_WFS_LAYERS.find((layer) => layer.id === 'sector')

  if (!sectorLayer?.fillLayerId || !sectorLayer.hoverLayerId) {
    return
  }

  map.on('mousemove', sectorLayer.fillLayerId, (event) => {
    const sectorIds = [...new Set(event.features.map((feature) => feature.properties.sectorId).filter(Boolean))]

    map.getCanvas().style.cursor = sectorIds.length > 0 ? 'pointer' : ''
    map.setFilter(sectorLayer.hoverLayerId, ['in', ['get', 'sectorId'], ['literal', sectorIds]])
  })

  map.on('mouseleave', sectorLayer.fillLayerId, () => {
    map.getCanvas().style.cursor = ''
    map.setFilter(sectorLayer.hoverLayerId, ['in', ['get', 'sectorId'], ['literal', []]])
  })
}

function addRoutePreviewLayers(map) {
  if (!map.getSource(ROUTE_PREVIEW_SOURCE_ID)) {
    map.addSource(ROUTE_PREVIEW_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
  }

  if (!map.getLayer(ROUTE_PREVIEW_LINE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_PREVIEW_LINE_LAYER_ID,
      type: 'line',
      source: ROUTE_PREVIEW_SOURCE_ID,
      slot: 'top',
      filter: ['==', ['get', 'role'], 'route-preview-line'],
      paint: {
        'line-color': '#f97316',
        'line-width': 4,
        'line-opacity': 0.9,
      },
    })
  }

  if (!map.getLayer(ROUTE_PREVIEW_POINT_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_PREVIEW_POINT_LAYER_ID,
      type: 'circle',
      source: ROUTE_PREVIEW_SOURCE_ID,
      slot: 'top',
      filter: ['==', ['get', 'role'], 'route-preview-point'],
      paint: {
        'circle-color': '#f97316',
        'circle-radius': 4,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    })
  }
}

function updateRoutePreview(map, geojson) {
  addRoutePreviewLayers(map)
  map.getSource(ROUTE_PREVIEW_SOURCE_ID).setData(geojson)
}

function fitRoutePreview(map, geojson) {
  const coordinates = geojson.features.flatMap((feature) => {
    if (feature.geometry.type === 'Point') {
      return [feature.geometry.coordinates]
    }

    return feature.geometry.coordinates
  })

  if (coordinates.length === 0) {
    return
  }

  const bounds = coordinates.reduce(
    (currentBounds, coordinate) => currentBounds.extend(coordinate),
    new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]),
  )

  map.fitBounds(bounds, {
    padding: 80,
    maxZoom: 8,
    duration: 500,
  })
}

const initialRouteForm = {
  departureAirport: 'RKSS',
  entryFix: 'GOGET',
  exitFix: 'REMOS',
  arrivalAirport: 'RKPC',
  routeType: 'ALL',
}

const emptyRoutePreviewGeojson = {
  type: 'FeatureCollection',
  features: [],
}

function MapView({ activePanel }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const [error, setError] = useState(null)
  const [layerVisibility, setLayerVisibilityState] = useState(createInitialLayerVisibility)
  const [routeForm, setRouteForm] = useState(initialRouteForm)
  const [routeResult, setRouteResult] = useState(null)
  const [routeError, setRouteError] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)

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

    const token = import.meta.env.VITE_MAPBOX_TOKEN

    if (!token) {
      setError('VITE_MAPBOX_TOKEN is required to load the Mapbox map.')
      return undefined
    }

    mapboxgl.accessToken = token

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
      maxBounds: MAP_CONFIG.maxBounds,
      logoPosition: 'bottom-right',
      language: 'ko',
      localIdeographFontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif',
    })

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

    map.on('style.load', () => {
      let roadsVisible = map.getZoom() >= ROAD_VISIBILITY_ZOOM

      applyRoadVisibility(map, roadsVisible)
      addAviationWfsLayers(map, import.meta.env.VITE_VWORLD_KEY, import.meta.env.VITE_VWORLD_DOMAIN)
      addRoutePreviewLayers(map)
      bindSectorHover(map)
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

  useEffect(() => {
    if (activePanel === 'route-check') {
      return
    }

    setRouteResult(null)
    setRouteError(null)

    const map = mapRef.current

    if (map?.isStyleLoaded() && map.getSource(ROUTE_PREVIEW_SOURCE_ID)) {
      map.getSource(ROUTE_PREVIEW_SOURCE_ID).setData(emptyRoutePreviewGeojson)
    }
  }, [activePanel])

  function updateRouteFormField(field, value) {
    setRouteForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  async function handleRouteSearch(event) {
    event.preventDefault()
    setRouteLoading(true)
    setRouteError(null)

    try {
      const result = await buildBriefingRoute(routeForm)
      setRouteResult(result)

      const map = mapRef.current

      if (map?.isStyleLoaded()) {
        updateRoutePreview(map, result.previewGeojson)
        fitRoutePreview(map, result.previewGeojson)
      }
    } catch (searchError) {
      setRouteResult(null)
      setRouteError(searchError.message)
    } finally {
      setRouteLoading(false)
    }
  }

  return (
    <div className="map-view-wrapper">
      <div ref={mapContainerRef} className="map-view" />
      {error && (
        <div className="map-view-error" role="alert">
          {error}
        </div>
      )}
      {activePanel === 'route-check' && (
        <section className="route-check-panel" aria-label="Route check panel">
          <div className="route-check-title">Route Check</div>
          <form className="route-check-form" onSubmit={handleRouteSearch}>
            <label>
              DEP Airport
              <input
                value={routeForm.departureAirport}
                onChange={(event) => updateRouteFormField('departureAirport', event.target.value)}
              />
            </label>
            <label>
              Entry Fix
              <input
                value={routeForm.entryFix}
                onChange={(event) => updateRouteFormField('entryFix', event.target.value)}
              />
            </label>
            <label>
              Exit Fix
              <input value={routeForm.exitFix} onChange={(event) => updateRouteFormField('exitFix', event.target.value)} />
            </label>
            <label>
              ARR Airport
              <input
                value={routeForm.arrivalAirport}
                onChange={(event) => updateRouteFormField('arrivalAirport', event.target.value)}
              />
            </label>
            <label>
              Route Type
              <select value={routeForm.routeType} onChange={(event) => updateRouteFormField('routeType', event.target.value)}>
                <option value="ALL">All</option>
                <option value="RNAV">RNAV</option>
                <option value="ATS">ATS</option>
              </select>
            </label>
            <button type="submit" disabled={routeLoading}>
              {routeLoading ? 'Searching...' : 'Search'}
            </button>
          </form>

          {routeError && <div className="route-check-error">{routeError}</div>}

          {routeResult && (
            <div className="route-check-result">
              <div className="route-check-summary">
                <span>{routeResult.departureAirport}</span>
                <span>{routeResult.entryFix}</span>
                <span>{routeResult.exitFix}</span>
                <span>{routeResult.arrivalAirport}</span>
              </div>
              <dl>
                <div>
                  <dt>Distance</dt>
                  <dd>{routeResult.distanceNm} NM</dd>
                </div>
                <div>
                  <dt>Routes</dt>
                  <dd>{routeResult.routeIds.join(', ')}</dd>
                </div>
                <div>
                  <dt>Types</dt>
                  <dd>{routeResult.routeTypes.join(', ')}</dd>
                </div>
                <div>
                  <dt>Segments</dt>
                  <dd>{routeResult.segments.length}</dd>
                </div>
              </dl>
              <div className="route-check-sequence">{routeResult.displaySequence.join(' -> ')}</div>
            </div>
          )}
        </section>
      )}
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
