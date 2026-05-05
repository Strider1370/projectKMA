import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_CONFIG } from '../../config/mapConfig.js'
import { addAviationWfsLayers } from '../../layers/aviation/addAviationWfsLayers.js'
import { AVIATION_WFS_LAYERS } from '../../layers/aviation/aviationWfsLayers.js'
import {
  ADVISORY_LAYER_DEFS,
  addAdvisoryLayers,
  advisoryItemsToFeatureCollection,
  advisoryItemsToLabelFeatureCollection,
  setAdvisoryVisibility,
  updateAdvisoryLayerData,
} from '../../layers/advisories/advisoryLayers.js'
import { buildBriefingRoute } from '../../services/navdata/routePlanner.js'
import './MapView.css'

// ── Constants ────────────────────────────────────────────────────────────────

const ROAD_VISIBILITY_ZOOM  = 8
const ROUTE_PREVIEW_SOURCE  = 'briefing-route-preview'
const ROUTE_PREVIEW_LINE    = 'briefing-route-preview-line'
const ROUTE_PREVIEW_POINT   = 'briefing-route-preview-point'

const AIRPORT_SOURCE_ID     = 'kma-weather-airports'
const AIRPORT_CIRCLE_LAYER  = 'kma-weather-airports-circle'
const AIRPORT_LABEL_LAYER   = 'kma-weather-airports-label'

const SATELLITE_SOURCE      = 'kma-satellite-overlay'
const SATELLITE_LAYER       = 'kma-satellite-overlay'
const RADAR_SOURCE          = 'kma-radar-overlay'
const RADAR_LAYER           = 'kma-radar-overlay'
const SIGWX_SOURCE          = 'kma-sigwx-overlay'
const SIGWX_LAYER           = 'kma-sigwx-overlay'
const LIGHTNING_SOURCE      = 'kma-lightning'
const LIGHTNING_GROUND_LAYER = 'kma-lightning-ground'
const LIGHTNING_CLOUD_LAYER  = 'kma-lightning-cloud'

const HIDDEN_ROAD_COLOR = 'rgba(255,255,255,0)'
const VISIBLE_ROAD_COLORS = { roads: '#d6dde6', trunks: '#c6d1dd', motorways: '#b9c7d4' }

// MET layer definitions (order = display order in panel)
const MET_LAYERS = [
  { id: 'radar',     label: 'Radar',     color: '#38bdf8' },
  { id: 'satellite', label: 'Satellite', color: '#64748b' },
  { id: 'lightning', label: 'Lightning', color: '#facc15' },
  { id: 'sigmet',    label: 'SIGMET',    color: ADVISORY_LAYER_DEFS.sigmet.color },
  { id: 'airmet',    label: 'AIRMET',    color: ADVISORY_LAYER_DEFS.airmet.color },
  { id: 'sigwx',     label: 'SIGWX',     color: '#a78bfa' },
]

const emptyGeoJSON = { type: 'FeatureCollection', features: [] }

// ── Helpers ──────────────────────────────────────────────────────────────────

function applyRoadVisibility(map, show) {
  map.setConfigProperty('basemap', 'colorRoads',     show ? VISIBLE_ROAD_COLORS.roads     : HIDDEN_ROAD_COLOR)
  map.setConfigProperty('basemap', 'colorTrunks',    show ? VISIBLE_ROAD_COLORS.trunks    : HIDDEN_ROAD_COLOR)
  map.setConfigProperty('basemap', 'colorMotorways', show ? VISIBLE_ROAD_COLORS.motorways : HIDDEN_ROAD_COLOR)
}

function setLayerVisibility(map, layer, isVisible) {
  const v = isVisible ? 'visible' : 'none'
  const ids = [
    layer.fillLayerId, layer.maskLayerId, layer.hoverLayerId,
    layer.pointMaskLayerId, layer.pointLayerId,
    layer.lineLayerId, layer.routeLabelLayerId,
    layer.tickLayerId, layer.externalLabelLayerId,
    layer.internalLabelLayerId, layer.labelLayerId,
    layer.pointLabelLayerId ? (layer.pointLabelMaskLayerId ?? `${layer.pointLabelLayerId}-mask`) : null,
    layer.pointLabelLayerId,
  ].filter(Boolean)

  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  })

  layer.neighborBoundaries?.forEach((b) => {
    if (map.getLayer(b.tickLayerId)) map.setLayoutProperty(b.tickLayerId, 'visibility', v)
  })
}

function setMapLayerVisible(map, layerId, isVisible) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none')
  }
}

function buildImageCoordinates(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null
  const [[south, west], [north, east]] = bounds
  if (![south, west, north, east].every(Number.isFinite)) return null
  return [[west, north], [east, north], [east, south], [west, south]]
}

function addOrUpdateImageOverlay(map, { sourceId, layerId, frame, opacity }) {
  const coordinates = buildImageCoordinates(frame?.bounds)
  if (!frame?.path || !coordinates) return false

  const image = { url: frame.path, coordinates }
  const source = map.getSource(sourceId)

  if (source?.updateImage) {
    source.updateImage(image)
  } else if (!source) {
    map.addSource(sourceId, { type: 'image', ...image })
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      slot: 'top',
      paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
    })
  }

  return true
}

function createAirportGeoJSON(airports) {
  return {
    type: 'FeatureCollection',
    features: airports
      .filter((a) => Number.isFinite(a.lon) && Number.isFinite(a.lat))
      .map((a) => ({
        type: 'Feature',
        id: a.icao,
        properties: { icao: a.icao, name: a.nameKo || a.name || a.icao },
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      })),
  }
}

function createLightningGeoJSON(lightningData) {
  const strikes = lightningData?.strikes || []
  return {
    type: 'FeatureCollection',
    features: strikes
      .filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat))
      .map((s, i) => ({
        type: 'Feature',
        id: i,
        properties: { type: s.type || 'cloud' },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
  }
}

function getRadarFrame(echoMeta) {
  return echoMeta?.nationwide || echoMeta?.frames?.[echoMeta.frames.length - 1] || null
}

function getSatFrame(satMeta) {
  return satMeta?.latest || satMeta?.frames?.[satMeta.frames.length - 1] || null
}

// ── Initial state factories ───────────────────────────────────────────────────

function initAviationVisibility() {
  return AVIATION_WFS_LAYERS.reduce((acc, l) => { acc[l.id] = l.defaultVisible; return acc }, {})
}

function initMetVisibility() {
  return MET_LAYERS.reduce((acc, l) => { acc[l.id] = false; return acc }, {})
}

// ── Route helpers (unchanged from original) ──────────────────────────────────

function addRoutePreviewLayers(map) {
  if (!map.getSource(ROUTE_PREVIEW_SOURCE)) {
    map.addSource(ROUTE_PREVIEW_SOURCE, { type: 'geojson', data: emptyGeoJSON })
  }
  if (!map.getLayer(ROUTE_PREVIEW_LINE)) {
    map.addLayer({
      id: ROUTE_PREVIEW_LINE, type: 'line', source: ROUTE_PREVIEW_SOURCE, slot: 'top',
      filter: ['==', ['get', 'role'], 'route-preview-line'],
      paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.9 },
    })
  }
  if (!map.getLayer(ROUTE_PREVIEW_POINT)) {
    map.addLayer({
      id: ROUTE_PREVIEW_POINT, type: 'circle', source: ROUTE_PREVIEW_SOURCE, slot: 'top',
      filter: ['==', ['get', 'role'], 'route-preview-point'],
      paint: { 'circle-color': '#f97316', 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    })
  }
}

function bindSectorHover(map) {
  const sector = AVIATION_WFS_LAYERS.find((l) => l.id === 'sector')
  if (!sector?.fillLayerId || !sector.hoverLayerId) return

  map.on('mousemove', sector.fillLayerId, (e) => {
    const ids = [...new Set(e.features.map((f) => f.properties.sectorId).filter(Boolean))]
    map.getCanvas().style.cursor = ids.length > 0 ? 'pointer' : ''
    map.setFilter(sector.hoverLayerId, ['in', ['get', 'sectorId'], ['literal', ids]])
  })
  map.on('mouseleave', sector.fillLayerId, () => {
    map.getCanvas().style.cursor = ''
    map.setFilter(sector.hoverLayerId, ['in', ['get', 'sectorId'], ['literal', []]])
  })
}

// ── Airport layers ────────────────────────────────────────────────────────────

function addAirportLayers(map, data) {
  if (!map.getSource(AIRPORT_SOURCE_ID)) {
    map.addSource(AIRPORT_SOURCE_ID, { type: 'geojson', data })
  }
  if (!map.getLayer(AIRPORT_CIRCLE_LAYER)) {
    map.addLayer({
      id: AIRPORT_CIRCLE_LAYER, type: 'circle', source: AIRPORT_SOURCE_ID, slot: 'top',
      paint: {
        'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 12, 9],
        'circle-color':  ['case', ['boolean', ['feature-state', 'selected'], false], '#f97316', '#0f766e'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95,
      },
    })
  }
  if (!map.getLayer(AIRPORT_LABEL_LAYER)) {
    map.addLayer({
      id: AIRPORT_LABEL_LAYER, type: 'symbol', source: AIRPORT_SOURCE_ID, slot: 'top',
      layout: {
        'text-field': ['get', 'icao'],
        'text-font': ['Noto Sans CJK JP Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    })
  }
}

// ── Lightning layers ──────────────────────────────────────────────────────────

function addLightningLayers(map, data) {
  if (!map.getSource(LIGHTNING_SOURCE)) {
    map.addSource(LIGHTNING_SOURCE, { type: 'geojson', data })
  }
  if (!map.getLayer(LIGHTNING_GROUND_LAYER)) {
    map.addLayer({
      id: LIGHTNING_GROUND_LAYER, type: 'circle', source: LIGHTNING_SOURCE, slot: 'top',
      filter: ['==', ['get', 'type'], 'ground'],
      paint: { 'circle-radius': 4, 'circle-color': '#facc15', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
    })
  }
  if (!map.getLayer(LIGHTNING_CLOUD_LAYER)) {
    map.addLayer({
      id: LIGHTNING_CLOUD_LAYER, type: 'circle', source: LIGHTNING_SOURCE, slot: 'top',
      filter: ['==', ['get', 'type'], 'cloud'],
      paint: { 'circle-radius': 3, 'circle-color': '#a78bfa', 'circle-opacity': 0.7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
    })
  }
}

function setLightningVisibility(map, isVisible) {
  setMapLayerVisible(map, LIGHTNING_GROUND_LAYER, isVisible)
  setMapLayerVisible(map, LIGHTNING_CLOUD_LAYER, isVisible)
}

// ── Route state ───────────────────────────────────────────────────────────────

const initialRouteForm = {
  departureAirport: 'RKSS', entryFix: 'GOGET',
  exitFix: 'REMOS', arrivalAirport: 'RKPC', routeType: 'ALL',
}

// ── Component ─────────────────────────────────────────────────────────────────

function MapView({
  activePanel,
  airports = [],
  echoMeta = null,
  satMeta = null,
  sigmetData = null,
  airmetData = null,
  lightningData = null,
  sigwxFrontMeta = null,
  selectedAirport,
  onAirportSelect,
}) {
  const mapContainerRef  = useRef(null)
  const mapRef           = useRef(null)
  const onSelectRef      = useRef(onAirportSelect)
  const [error,               setError]             = useState(null)
  const [isStyleReady,        setIsStyleReady]       = useState(false)
  const [aviationVisibility,  setAviationVisibility] = useState(initAviationVisibility)
  const [metVisibility,       setMetVisibility]      = useState(initMetVisibility)
  const [routeForm,           setRouteForm]          = useState(initialRouteForm)
  const [routeResult,         setRouteResult]        = useState(null)
  const [routeError,          setRouteError]         = useState(null)
  const [routeLoading,        setRouteLoading]       = useState(false)

  useEffect(() => { onSelectRef.current = onAirportSelect }, [onAirportSelect])

  const airportGeoJSON   = useMemo(() => createAirportGeoJSON(airports),         [airports])
  const lightningGeoJSON = useMemo(() => createLightningGeoJSON(lightningData),   [lightningData])
  const radarFrame       = useMemo(() => getRadarFrame(echoMeta),                 [echoMeta])
  const satFrame         = useMemo(() => getSatFrame(satMeta),                    [satMeta])
  const sigmetFeatures   = useMemo(() => advisoryItemsToFeatureCollection(sigmetData, 'sigmet'),      [sigmetData])
  const sigmetLabels     = useMemo(() => advisoryItemsToLabelFeatureCollection(sigmetData, 'sigmet'), [sigmetData])
  const airmetFeatures   = useMemo(() => advisoryItemsToFeatureCollection(airmetData, 'airmet'),      [airmetData])
  const airmetLabels     = useMemo(() => advisoryItemsToLabelFeatureCollection(airmetData, 'airmet'), [airmetData])

  const sigmetCount  = sigmetFeatures.features.length
  const airmetCount  = airmetFeatures.features.length
  const lightningCount = lightningGeoJSON.features.length

  function toggleAviation(id) {
    setAviationVisibility((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleMet(id) {
    setMetVisibility((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // ── Map init ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined

    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) { setError('VITE_MAPBOX_TOKEN is required.'); return undefined }

    mapboxgl.accessToken = token

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      config: {
        basemap: {
          showPlaceLabels: false, showPedestrianRoads: false,
          showPointOfInterestLabels: false, showRoadLabels: false,
          show3dObjects: false, show3dBuildings: false,
          show3dTrees: false, show3dLandmarks: false,
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
      localIdeographFontFamily: '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif',
    })

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

    let airportHandlerBound = false
    let advisoryHandlerBound = false

    map.on('style.load', () => {
      let roadsVisible = map.getZoom() >= ROAD_VISIBILITY_ZOOM
      applyRoadVisibility(map, roadsVisible)

      // Aviation WFS
      addAviationWfsLayers(map, import.meta.env.VITE_VWORLD_KEY, import.meta.env.VITE_VWORLD_DOMAIN)
      AVIATION_WFS_LAYERS.forEach((l) => setLayerVisibility(map, l, aviationVisibility[l.id]))

      // Route preview
      addRoutePreviewLayers(map)
      bindSectorHover(map)

      // Satellite overlay
      const hasSat = addOrUpdateImageOverlay(map, { sourceId: SATELLITE_SOURCE, layerId: SATELLITE_LAYER, frame: satFrame, opacity: 0.92 })
      setMapLayerVisible(map, SATELLITE_LAYER, hasSat && metVisibility.satellite)

      // Radar overlay
      const hasRadar = addOrUpdateImageOverlay(map, { sourceId: RADAR_SOURCE, layerId: RADAR_LAYER, frame: radarFrame, opacity: 0.88 })
      setMapLayerVisible(map, RADAR_LAYER, hasRadar && metVisibility.radar)

      // SIGWX overlay
      const hasSigwx = addOrUpdateImageOverlay(map, { sourceId: SIGWX_SOURCE, layerId: SIGWX_LAYER, frame: sigwxFrontMeta, opacity: 0.85 })
      setMapLayerVisible(map, SIGWX_LAYER, hasSigwx && metVisibility.sigwx)

      // SIGMET / AIRMET advisories
      addAdvisoryLayers(map, 'sigmet', sigmetFeatures, sigmetLabels)
      addAdvisoryLayers(map, 'airmet', airmetFeatures, airmetLabels)
      setAdvisoryVisibility(map, 'sigmet', metVisibility.sigmet)
      setAdvisoryVisibility(map, 'airmet', metVisibility.airmet)

      // Lightning
      addLightningLayers(map, lightningGeoJSON)
      setLightningVisibility(map, metVisibility.lightning)

      // Airport circles
      addAirportLayers(map, airportGeoJSON)

      if (!airportHandlerBound) {
        airportHandlerBound = true
        map.on('click', AIRPORT_CIRCLE_LAYER, (e) => {
          const icao = e.features?.[0]?.properties?.icao
          if (icao) onSelectRef.current?.(icao)
        })
        map.on('mouseenter', AIRPORT_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', AIRPORT_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = '' })
      }

      if (!advisoryHandlerBound) {
        advisoryHandlerBound = true
        const advisoryLayerIds = [
          ADVISORY_LAYER_DEFS.sigmet.fillLayerId, ADVISORY_LAYER_DEFS.sigmet.lineLayerId,
          ADVISORY_LAYER_DEFS.airmet.fillLayerId, ADVISORY_LAYER_DEFS.airmet.lineLayerId,
        ]
        advisoryLayerIds.forEach((layerId) => {
          map.on('click', layerId, (e) => {
            const desc = e.features?.[0]?.properties?.description
            if (!desc) return
            new mapboxgl.Popup({ closeButton: true, maxWidth: '320px' })
              .setLngLat(e.lngLat)
              .setHTML(`<pre class="mapbox-advisory-popup">${desc.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</pre>`)
              .addTo(map)
          })
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
        })
      }

      map.on('zoom', () => {
        const should = map.getZoom() >= ROAD_VISIBILITY_ZOOM
        if (should !== roadsVisible) { roadsVisible = should; applyRoadVisibility(map, roadsVisible) }
      })

      setIsStyleReady(true)
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync aviation layer visibility ───────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    AVIATION_WFS_LAYERS.forEach((l) => setLayerVisibility(map, l, aviationVisibility[l.id]))
  }, [aviationVisibility])

  // ── Sync MET overlays ─────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isStyleReady) return

    const hasSat   = addOrUpdateImageOverlay(map, { sourceId: SATELLITE_SOURCE, layerId: SATELLITE_LAYER, frame: satFrame,   opacity: 0.92 })
    const hasRadar = addOrUpdateImageOverlay(map, { sourceId: RADAR_SOURCE,     layerId: RADAR_LAYER,     frame: radarFrame, opacity: 0.88 })
    const hasSigwx = addOrUpdateImageOverlay(map, { sourceId: SIGWX_SOURCE,     layerId: SIGWX_LAYER,     frame: sigwxFrontMeta, opacity: 0.85 })

    setMapLayerVisible(map, SATELLITE_LAYER, hasSat   && metVisibility.satellite)
    setMapLayerVisible(map, RADAR_LAYER,     hasRadar && metVisibility.radar)
    setMapLayerVisible(map, SIGWX_LAYER,     hasSigwx && metVisibility.sigwx)
  }, [satFrame, radarFrame, sigwxFrontMeta, metVisibility, isStyleReady])

  // ── Sync SIGMET / AIRMET ──────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isStyleReady) return
    updateAdvisoryLayerData(map, 'sigmet', sigmetFeatures, sigmetLabels)
    updateAdvisoryLayerData(map, 'airmet', airmetFeatures, airmetLabels)
    setAdvisoryVisibility(map, 'sigmet', metVisibility.sigmet)
    setAdvisoryVisibility(map, 'airmet', metVisibility.airmet)
  }, [sigmetFeatures, sigmetLabels, airmetFeatures, airmetLabels, metVisibility.sigmet, metVisibility.airmet, isStyleReady])

  // ── Sync lightning ────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isStyleReady) return
    addLightningLayers(map, lightningGeoJSON)
    map.getSource(LIGHTNING_SOURCE)?.setData(lightningGeoJSON)
    setLightningVisibility(map, metVisibility.lightning)
  }, [lightningGeoJSON, metVisibility.lightning, isStyleReady])

  // ── Sync airport data ─────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isStyleReady) return
    addAirportLayers(map, airportGeoJSON)
    map.getSource(AIRPORT_SOURCE_ID)?.setData(airportGeoJSON)
  }, [airportGeoJSON, isStyleReady])

  // ── Sync airport selected state ───────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isStyleReady || !map.getSource(AIRPORT_SOURCE_ID)) return
    airportGeoJSON.features.forEach((f) => {
      map.setFeatureState(
        { source: AIRPORT_SOURCE_ID, id: f.properties.icao },
        { selected: f.properties.icao === selectedAirport },
      )
    })
  }, [airportGeoJSON, selectedAirport, isStyleReady])

  // ── Route panel clear ─────────────────────────────────────────────────────

  useEffect(() => {
    if (activePanel === 'route-check') return
    setRouteResult(null)
    setRouteError(null)
    const map = mapRef.current
    if (map?.isStyleLoaded() && map.getSource(ROUTE_PREVIEW_SOURCE)) {
      map.getSource(ROUTE_PREVIEW_SOURCE).setData(emptyGeoJSON)
    }
  }, [activePanel])

  // ── Route search ──────────────────────────────────────────────────────────

  function updateRouteField(field, value) {
    setRouteForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleRouteSearch(e) {
    e.preventDefault()
    setRouteLoading(true)
    setRouteError(null)
    try {
      const result = await buildBriefingRoute(routeForm)
      setRouteResult(result)
      const map = mapRef.current
      if (map?.isStyleLoaded()) {
        addRoutePreviewLayers(map)
        map.getSource(ROUTE_PREVIEW_SOURCE).setData(result.previewGeojson)
        const coords = result.previewGeojson.features.flatMap((f) =>
          f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates
        )
        if (coords.length > 0) {
          const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]))
          map.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 500 })
        }
      }
    } catch (err) {
      setRouteResult(null)
      setRouteError(err.message)
    } finally {
      setRouteLoading(false)
    }
  }

  // ── Layer panel helpers ───────────────────────────────────────────────────

  function isMetLayerDisabled(id) {
    if (id === 'radar')     return !radarFrame
    if (id === 'satellite') return !satFrame
    if (id === 'lightning') return lightningCount === 0
    if (id === 'sigmet')    return sigmetCount === 0
    if (id === 'airmet')    return airmetCount === 0
    if (id === 'sigwx')     return !sigwxFrontMeta
    return false
  }

  function metLayerBadge(id) {
    if (id === 'sigmet')    return sigmetCount  > 0 ? sigmetCount  : null
    if (id === 'airmet')    return airmetCount  > 0 ? airmetCount  : null
    if (id === 'lightning') return lightningCount > 0 ? lightningCount : null
    return null
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="map-view-wrapper">
      <div ref={mapContainerRef} className="map-view" />

      {error && <div className="map-view-error" role="alert">{error}</div>}

      {/* Route check panel */}
      {activePanel === 'route-check' && (
        <section className="route-check-panel" aria-label="Route check panel">
          <div className="route-check-title">Route Check</div>
          <form className="route-check-form" onSubmit={handleRouteSearch}>
            <label>DEP Airport<input value={routeForm.departureAirport} onChange={(e) => updateRouteField('departureAirport', e.target.value)} /></label>
            <label>Entry Fix<input value={routeForm.entryFix} onChange={(e) => updateRouteField('entryFix', e.target.value)} /></label>
            <label>Exit Fix<input value={routeForm.exitFix} onChange={(e) => updateRouteField('exitFix', e.target.value)} /></label>
            <label>ARR Airport<input value={routeForm.arrivalAirport} onChange={(e) => updateRouteField('arrivalAirport', e.target.value)} /></label>
            <label>Route Type
              <select value={routeForm.routeType} onChange={(e) => updateRouteField('routeType', e.target.value)}>
                <option value="ALL">All</option>
                <option value="RNAV">RNAV</option>
                <option value="ATS">ATS</option>
              </select>
            </label>
            <button type="submit" disabled={routeLoading}>{routeLoading ? 'Searching...' : 'Search'}</button>
          </form>
          {routeError && <div className="route-check-error">{routeError}</div>}
          {routeResult && (
            <div className="route-check-result">
              <div className="route-check-summary">
                {[routeResult.departureAirport, routeResult.entryFix, routeResult.exitFix, routeResult.arrivalAirport].map((v) => (
                  <span key={v}>{v}</span>
                ))}
              </div>
              <dl>
                <div><dt>Distance</dt><dd>{routeResult.distanceNm} NM</dd></div>
                <div><dt>Routes</dt><dd>{routeResult.routeIds.join(', ')}</dd></div>
                <div><dt>Types</dt><dd>{routeResult.routeTypes.join(', ')}</dd></div>
                <div><dt>Segments</dt><dd>{routeResult.segments.length}</dd></div>
              </dl>
              <div className="route-check-sequence">{routeResult.displaySequence.join(' → ')}</div>
            </div>
          )}
        </section>
      )}

      {/* Layers panel */}
      <div className="dev-layer-panel" aria-label="Layer toggles">
        <div className="dev-layer-panel-title">Layers</div>

        {/* ── MET ── */}
        <div className="dev-layer-section-title">MET</div>
        {MET_LAYERS.map((layer) => {
          const disabled = isMetLayerDisabled(layer.id)
          const badge    = metLayerBadge(layer.id)
          return (
            <label key={layer.id} className={`dev-layer-toggle${disabled ? ' is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={metVisibility[layer.id]}
                disabled={disabled}
                onChange={() => toggleMet(layer.id)}
              />
              <span className="dev-layer-swatch" style={{ background: layer.color }} />
              <span>{layer.label}</span>
              {badge != null && <span className="dev-layer-count">{badge}</span>}
            </label>
          )
        })}

        {/* ── AVIATION ── */}
        <div className="dev-layer-section-title">AVIATION</div>
        {AVIATION_WFS_LAYERS.map((layer) => (
          <label key={layer.id} className="dev-layer-toggle">
            <input
              type="checkbox"
              checked={aviationVisibility[layer.id]}
              onChange={() => toggleAviation(layer.id)}
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
