import { AVIATION_WFS_LAYERS, buildWfsUrl } from './aviationWfsLayers.js'

const POLYGON_FILTER = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]
const LINE_FILTER = ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']]

export function addAviationWfsLayers(map, vworldKey, domain) {
  AVIATION_WFS_LAYERS.forEach((layer) => {
    if (!map.getSource(layer.sourceId)) {
      map.addSource(layer.sourceId, {
        type: 'geojson',
        data: buildWfsUrl(layer.typeName, vworldKey, domain),
      })
    }

    const visibility = layer.defaultVisible ? 'visible' : 'none'

    if (layer.fillLayerId && !map.getLayer(layer.fillLayerId)) {
      map.addLayer({
        id: layer.fillLayerId,
        type: 'fill',
        source: layer.sourceId,
        slot: 'top',
        filter: POLYGON_FILTER,
        paint: {
          'fill-color': layer.color,
          'fill-opacity': layer.fillOpacity,
        },
        layout: {
          visibility,
        },
      })
    }

    if (!map.getLayer(layer.lineLayerId)) {
      map.addLayer({
        id: layer.lineLayerId,
        type: 'line',
        source: layer.sourceId,
        slot: 'top',
        filter: layer.fillLayerId ? POLYGON_FILTER : LINE_FILTER,
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
  })
}
