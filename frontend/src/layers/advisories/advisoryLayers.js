export const ADVISORY_LAYER_DEFS = {
  sigmet: {
    sourceId: 'kma-sigmet-advisories',
    fillLayerId: 'kma-sigmet-advisories-fill',
    lineLayerId: 'kma-sigmet-advisories-line',
    labelLayerId: 'kma-sigmet-advisories-label',
    color: '#dc2626',
    label: 'SIGMET',
  },
  airmet: {
    sourceId: 'kma-airmet-advisories',
    fillLayerId: 'kma-airmet-advisories-fill',
    lineLayerId: 'kma-airmet-advisories-line',
    labelLayerId: 'kma-airmet-advisories-label',
    color: '#f59e0b',
    label: 'AIRMET',
  },
}

function formatAltitude(item) {
  const altitude = item?.altitude

  if (!altitude) {
    return ''
  }

  const lower = altitude.lower_fl ? `FL${altitude.lower_fl}` : ''
  const upper = altitude.upper_fl ? `FL${altitude.upper_fl}` : ''

  if (lower && upper) {
    return `${lower}-${upper}`
  }

  return upper || lower
}

function formatMotion(item) {
  const motion = item?.motion

  if (!motion || !Number.isFinite(motion.speed_kt) || motion.speed_kt <= 0) {
    return ''
  }

  return Number.isFinite(motion.direction_deg)
    ? `${Math.round(motion.direction_deg)}deg ${Math.round(motion.speed_kt)}KT`
    : `${Math.round(motion.speed_kt)}KT`
}

function formatLabel(item, kind) {
  const base = kind === 'sigmet' ? 'SIGMET' : 'AIRMET'
  const phenomenon = item?.phenomenon_code || item?.phenomenon_label || ''
  const sequence = item?.sequence_number ? ` ${item.sequence_number}` : ''
  return `${base}${sequence}${phenomenon ? ` ${phenomenon}` : ''}`
}

function formatDescription(item, kind) {
  const parts = [
    formatLabel(item, kind),
    item?.valid_from && item?.valid_to ? `${item.valid_from} - ${item.valid_to}` : '',
    formatAltitude(item),
    formatMotion(item),
  ].filter(Boolean)

  return parts.join('\n')
}

function bboxCenter(item) {
  const bbox = item?.bbox

  if (!bbox) {
    return null
  }

  const lon = (bbox.min_lon + bbox.max_lon) / 2
  const lat = (bbox.min_lat + bbox.max_lat) / 2

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  return [lon, lat]
}

function geometryCenter(geometry) {
  const coordinates = geometry?.coordinates?.[0]

  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null
  }

  const points = coordinates.filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]))

  if (points.length === 0) {
    return null
  }

  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

export function advisoryItemsToFeatureCollection(payload, kind) {
  const items = Array.isArray(payload?.items) ? payload.items : []

  return {
    type: 'FeatureCollection',
    features: items
      .filter((item) => item?.geometry?.type && item?.geometry?.coordinates)
      .map((item, index) => ({
        type: 'Feature',
        id: item.id || `${kind}-${index}`,
        properties: {
          id: item.id || `${kind}-${index}`,
          kind,
          label: formatLabel(item, kind),
          phenomenon: item.phenomenon_code || '',
          phenomenonLabel: item.phenomenon_label || '',
          sequence: item.sequence_number || '',
          validFrom: item.valid_from || '',
          validTo: item.valid_to || '',
          altitude: formatAltitude(item),
          motion: formatMotion(item),
          description: formatDescription(item, kind),
        },
        geometry: item.geometry,
      })),
  }
}

export function advisoryItemsToLabelFeatureCollection(payload, kind) {
  const items = Array.isArray(payload?.items) ? payload.items : []

  return {
    type: 'FeatureCollection',
    features: items
      .map((item, index) => {
        const center = bboxCenter(item) || geometryCenter(item.geometry)

        if (!center) {
          return null
        }

        return {
          type: 'Feature',
          id: item.id || `${kind}-label-${index}`,
          properties: {
            id: item.id || `${kind}-${index}`,
            kind,
            label: formatLabel(item, kind),
            description: formatDescription(item, kind),
          },
          geometry: {
            type: 'Point',
            coordinates: center,
          },
        }
      })
      .filter(Boolean),
  }
}

export function addAdvisoryLayers(map, kind, featureData, labelData) {
  const def = ADVISORY_LAYER_DEFS[kind]

  if (!def) {
    return
  }

  if (!map.getSource(def.sourceId)) {
    map.addSource(def.sourceId, {
      type: 'geojson',
      data: featureData,
    })
  }

  const labelSourceId = `${def.sourceId}-labels`

  if (!map.getSource(labelSourceId)) {
    map.addSource(labelSourceId, {
      type: 'geojson',
      data: labelData,
    })
  }

  if (!map.getLayer(def.fillLayerId)) {
    map.addLayer({
      id: def.fillLayerId,
      type: 'fill',
      source: def.sourceId,
      slot: 'top',
      paint: {
        'fill-color': def.color,
        'fill-opacity': kind === 'sigmet' ? 0.16 : 0.12,
      },
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
    })
  }

  if (!map.getLayer(def.lineLayerId)) {
    map.addLayer({
      id: def.lineLayerId,
      type: 'line',
      source: def.sourceId,
      slot: 'top',
      paint: {
        'line-color': def.color,
        'line-opacity': 0.9,
        'line-width': kind === 'sigmet' ? 2.4 : 2,
        'line-dasharray': kind === 'sigmet' ? [1, 0] : [2, 1.5],
      },
    })
  }

  if (!map.getLayer(def.labelLayerId)) {
    map.addLayer({
      id: def.labelLayerId,
      type: 'symbol',
      source: labelSourceId,
      slot: 'top',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans CJK JP Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#111827',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.8,
      },
    })
  }
}

export function updateAdvisoryLayerData(map, kind, featureData, labelData) {
  const def = ADVISORY_LAYER_DEFS[kind]

  if (!def) {
    return
  }

  addAdvisoryLayers(map, kind, featureData, labelData)
  map.getSource(def.sourceId)?.setData(featureData)
  map.getSource(`${def.sourceId}-labels`)?.setData(labelData)
}

export function setAdvisoryVisibility(map, kind, isVisible) {
  const def = ADVISORY_LAYER_DEFS[kind]

  if (!def) {
    return
  }

  const visibility = isVisible ? 'visible' : 'none'

  for (const layerId of [def.fillLayerId, def.lineLayerId, def.labelLayerId]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility)
    }
  }
}
