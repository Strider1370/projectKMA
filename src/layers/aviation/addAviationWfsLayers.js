import { AVIATION_WFS_LAYERS, buildWfsUrl } from './aviationWfsLayers.js'

const POLYGON_FILTER = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]
const LINE_FILTER = ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']]
const POINT_FILTER = ['==', ['geometry-type'], 'Point']

function roleFilter(role, geometryFilter) {
  return ['all', ['==', ['get', 'role'], role], geometryFilter]
}

function layerFilter(role, geometryFilter) {
  return role ? roleFilter(role, geometryFilter) : geometryFilter
}

function combineFilter(baseFilter, extraFilter) {
  return extraFilter ? ['all', baseFilter, extraFilter] : baseFilter
}

function ensureFirTickIcon(map, imageId, color, direction = 'outer') {
  if (map.hasImage(imageId)) {
    return
  }

  const size = 18
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  context.strokeStyle = color
  context.lineWidth = 2
  context.lineCap = 'butt'
  context.beginPath()
  context.moveTo(size / 2, size / 2)
  context.lineTo(size / 2, direction === 'inner' ? size - 2 : 2)
  context.stroke()

  map.addImage(imageId, context.getImageData(0, 0, size, size))
}

function ensureIconImages(map, layer) {
  if (!layer.iconImageByProperty) {
    return
  }

  Object.values(layer.iconImageByProperty.values).forEach((icon) => {
    if (map.hasImage(icon.imageId)) {
      return
    }

    const image = new Image()

    image.onload = () => {
      if (map.hasImage(icon.imageId)) {
        return
      }

      map.addImage(icon.imageId, image)
    }

    image.src = icon.url
  })
}

function addFirLabelLayer(map, layer, labelLayerId, role, textOffset, visibility) {
  if (map.getLayer(labelLayerId)) {
    return
  }

  map.addLayer({
    id: labelLayerId,
    type: 'symbol',
    source: layer.sourceId,
    slot: 'top',
    filter: roleFilter(role, POINT_FILTER),
    layout: {
      visibility,
      'text-field': [
        'format',
        ['get', 'code'],
        { 'font-scale': 1.35 },
        '\n',
        {},
        ['get', 'label'],
        { 'font-scale': 0.82 },
      ],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        9,
        7,
        12,
        10,
        15,
      ],
      'text-font': ['Noto Sans CJK JP Bold'],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-line-height': 1.25,
      'text-max-width': 14,
      'text-offset': textOffset,
      'text-rotation-alignment': 'viewport',
    },
    paint: {
      'text-color': layer.color,
    },
  })
}

function addSectorLabelLayer(map, layer, visibility) {
  if (!layer.labelLayerId || map.getLayer(layer.labelLayerId)) {
    return
  }

  map.addLayer({
    id: layer.labelLayerId,
    type: 'symbol',
    source: layer.sourceId,
    slot: 'top',
    filter: POLYGON_FILTER,
    layout: {
      visibility,
      'text-field': ['coalesce', ['get', 'displayName'], ['get', 'name']],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        9,
        8,
        12,
        10,
        14,
      ],
      'text-font': ['Noto Sans CJK JP Bold'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-max-width': 10,
    },
    paint: {
      'text-color': layer.color,
      'text-halo-color': '#eef6ed',
      'text-halo-width': 4,
      'text-halo-blur': 0,
    },
  })
}

function addHoverLayer(map, layer, visibility) {
  if (!layer.hoverLayerId || map.getLayer(layer.hoverLayerId)) {
    return
  }

  map.addLayer({
    id: layer.hoverLayerId,
    type: 'fill',
    source: layer.sourceId,
    slot: 'top',
    filter: ['in', ['get', 'sectorId'], ['literal', []]],
    paint: {
      'fill-color': layer.color,
      'fill-opacity': 0.12,
    },
    layout: {
      visibility,
    },
  })
}

function addPointLayer(map, layer, visibility) {
  if (!layer.pointLayerId || map.getLayer(layer.pointLayerId)) {
    return
  }

  if (layer.iconImageByProperty) {
    const { property, fallback, values } = layer.iconImageByProperty
    const fallbackImage = values[fallback].imageId
    const iconMatch = ['match', ['get', property]]

    Object.entries(values).forEach(([value, icon]) => {
      iconMatch.push(value, icon.imageId)
    })

    iconMatch.push(fallbackImage)

    map.addLayer({
      id: layer.pointLayerId,
      type: 'symbol',
      source: layer.sourceId,
      slot: 'top',
      filter: POINT_FILTER,
      layout: {
        visibility,
        'icon-image': iconMatch,
        'icon-size': layer.iconSize ?? 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
    return
  }

  map.addLayer({
    id: layer.pointLayerId,
    type: 'circle',
    source: layer.sourceId,
    slot: 'top',
    filter: POINT_FILTER,
    paint: {
      'circle-color': layer.color,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        Math.max(1.8, layer.pointRadius - 1),
        9,
        layer.pointRadius,
        12,
        layer.pointRadius + 1,
      ],
      'circle-stroke-color': 'rgba(255, 255, 255, 0.85)',
      'circle-stroke-width': 1,
    },
    layout: {
      visibility,
    },
  })
}

function addPointMaskLayer(map, layer, visibility) {
  if (!layer.pointMaskLayerId || map.getLayer(layer.pointMaskLayerId)) {
    return
  }

  map.addLayer({
    id: layer.pointMaskLayerId,
    type: 'circle',
    source: layer.sourceId,
    slot: 'top',
    filter: POINT_FILTER,
    paint: {
      'circle-color': '#eef6ed',
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        Math.max(4, layer.pointMaskRadius - 2),
        9,
        layer.pointMaskRadius,
        12,
        layer.pointMaskRadius + 2,
      ],
      'circle-opacity': 0.96,
    },
    layout: {
      visibility,
    },
  })
}

function addPointLabelLayer(map, layer, visibility) {
  if (!layer.pointLabelLayerId || map.getLayer(layer.pointLabelLayerId)) {
    return
  }

  map.addLayer({
    id: layer.pointLabelLayerId,
    type: 'symbol',
    source: layer.sourceId,
    slot: 'top',
    filter: POINT_FILTER,
    layout: {
      visibility,
      'text-field': ['get', layer.labelField ?? 'ident'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        8,
        8,
        10,
        11,
        12,
      ],
      'text-font': ['Noto Sans CJK JP Bold'],
      'text-anchor': 'top',
      'text-offset': [0, 0.75],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': layer.color,
    },
  })
}

function addPointLabelMaskLayer(map, layer, visibility) {
  if (!layer.pointLabelLayerId) {
    return
  }

  const labelMaskLayerId = layer.pointLabelMaskLayerId ?? `${layer.pointLabelLayerId}-mask`
  if (map.getLayer(labelMaskLayerId)) {
    return
  }

  map.addLayer({
    id: labelMaskLayerId,
    type: 'symbol',
    source: layer.sourceId,
    slot: 'top',
    filter: POINT_FILTER,
    layout: {
      visibility,
      'text-field': ['get', layer.labelField ?? 'ident'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        8,
        8,
        10,
        11,
        12,
      ],
      'text-font': ['Noto Sans CJK JP Bold'],
      'text-anchor': 'top',
      'text-offset': [0, 0.75],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#eef6ed',
      'text-halo-color': '#eef6ed',
      'text-halo-width': 3,
      'text-halo-blur': 0,
    },
  })
}

function addRouteLabelLayer(map, layer, visibility) {
  if (!layer.routeLabelLayerId || map.getLayer(layer.routeLabelLayerId)) {
    return
  }

  map.addLayer({
    id: layer.routeLabelLayerId,
    type: 'symbol',
    source: layer.sourceId,
    slot: 'top',
    filter: combineFilter(LINE_FILTER, layer.routePrefixFilter),
    layout: {
      visibility,
      'symbol-placement': 'line',
      'symbol-spacing': 320,
      'text-field': ['get', 'ident_txt'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        9,
        8,
        11,
        11,
        13,
      ],
      'text-font': ['Noto Sans CJK JP Bold'],
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map',
      'text-keep-upright': true,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 2,
    },
    paint: {
      'text-color': layer.color,
      'text-halo-color': '#eef6ed',
      'text-halo-width': 1.5,
      'text-halo-blur': 0,
    },
  })
}

function movePointLayersToTop(map) {
  AVIATION_WFS_LAYERS.forEach((layer) => {
    ;[layer.pointMaskLayerId, layer.pointLayerId].forEach((layerId) => {
      if (layerId && map.getLayer(layerId)) {
        map.moveLayer(layerId)
      }
    })
  })

  AVIATION_WFS_LAYERS.forEach((layer) => {
    const labelMaskLayerId = layer.pointLabelMaskLayerId ?? `${layer.pointLabelLayerId}-mask`
    if (layer.pointLabelLayerId && map.getLayer(labelMaskLayerId)) {
      map.moveLayer(labelMaskLayerId)
    }

    if (layer.pointLabelLayerId && map.getLayer(layer.pointLabelLayerId)) {
      map.moveLayer(layer.pointLabelLayerId)
    }
  })
}

export function addAviationWfsLayers(map, vworldKey, domain) {
  AVIATION_WFS_LAYERS.forEach((layer) => {
    if (layer.tickIconId) {
      ensureFirTickIcon(map, layer.tickIconId, layer.color)
    }

    if (layer.innerTickIconId) {
      ensureFirTickIcon(map, layer.innerTickIconId, layer.color, 'inner')
    }

    ensureIconImages(map, layer)

    if (!map.getSource(layer.sourceId)) {
      map.addSource(layer.sourceId, {
        type: 'geojson',
        data: layer.dataUrl ?? buildWfsUrl(layer.typeName, vworldKey, domain),
      })
    }

    const visibility = layer.defaultVisible ? 'visible' : 'none'

    if (layer.maskLayerId && !map.getLayer(layer.maskLayerId)) {
      map.addLayer({
        id: layer.maskLayerId,
        type: 'fill',
        source: layer.sourceId,
        slot: 'top',
        filter: roleFilter('outside-mask', POLYGON_FILTER),
        paint: {
          'fill-color': '#1f78a8',
          'fill-opacity': 0.22,
        },
        layout: {
          visibility,
        },
      })
    }

    if (layer.fillLayerId && !map.getLayer(layer.fillLayerId)) {
      map.addLayer({
        id: layer.fillLayerId,
        type: 'fill',
        source: layer.sourceId,
        slot: 'top',
        filter: layerFilter(layer.fillRole, POLYGON_FILTER),
        paint: {
          'fill-color': layer.color,
          'fill-opacity': layer.fillOpacity,
        },
        layout: {
          visibility,
        },
      })
    }

    addPointMaskLayer(map, layer, visibility)
    addPointLayer(map, layer, visibility)
    addPointLabelMaskLayer(map, layer, visibility)
    addPointLabelLayer(map, layer, visibility)
    addHoverLayer(map, layer, visibility)

    if (layer.lineLayerId && !map.getLayer(layer.lineLayerId)) {
      map.addLayer({
        id: layer.lineLayerId,
        type: 'line',
        source: layer.sourceId,
        slot: 'top',
        filter: combineFilter(
          layer.lineRole ? layerFilter(layer.lineRole, LINE_FILTER) : layer.fillLayerId ? POLYGON_FILTER : LINE_FILTER,
          layer.routePrefixFilter,
        ),
        paint: {
          'line-color': layer.color,
          'line-width': layer.lineWidth,
          'line-opacity': layer.lineOpacity,
        },
        layout: {
          visibility,
        },
      })
    }

    addRouteLabelLayer(map, layer, visibility)

    if (layer.tickLayerId && !map.getLayer(layer.tickLayerId)) {
      map.addLayer({
        id: layer.tickLayerId,
        type: 'symbol',
        source: layer.sourceId,
        slot: 'top',
        filter: roleFilter('incheon-fir-boundary', LINE_FILTER),
        layout: {
          visibility,
          'symbol-placement': 'line',
          'symbol-spacing': layer.tickSpacing,
          'icon-image': layer.tickIconId,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-keep-upright': false,
          'icon-rotation-alignment': 'map',
        },
        paint: {
          'icon-opacity': layer.lineOpacity,
        },
      })
    }

    layer.neighborBoundaries?.forEach((boundary) => {
      if (map.getLayer(boundary.tickLayerId)) {
        return
      }

      map.addLayer({
        id: boundary.tickLayerId,
        type: 'symbol',
        source: layer.sourceId,
        slot: 'top',
        filter: ['all', ['==', ['get', 'role'], 'inner-boundary'], ['==', ['get', 'neighbor'], boundary.id], LINE_FILTER],
        layout: {
          visibility,
          'symbol-placement': 'line',
          'symbol-spacing': layer.innerTickSpacing,
          'icon-image': layer.innerTickIconId,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-keep-upright': false,
          'icon-rotation-alignment': 'map',
        },
        paint: {
          'icon-opacity': layer.lineOpacity,
        },
      })
    })

    if (layer.externalLabelLayerId) {
      addFirLabelLayer(map, layer, layer.externalLabelLayerId, 'external-label', [0, 0], visibility)
    }

    if (layer.internalLabelLayerId) {
      addFirLabelLayer(map, layer, layer.internalLabelLayerId, 'internal-label', [0, 0], visibility)
    }

    addSectorLabelLayer(map, layer, visibility)
  })

  movePointLayersToTop(map)
}
