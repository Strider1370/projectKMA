const NAVDATA_BASE_URL = '/data/navdata'

let navdataCache = null

async function fetchJson(path) {
  const response = await fetch(`${NAVDATA_BASE_URL}/${path}`)

  if (!response.ok) {
    throw new Error(`Failed to load ${path}`)
  }

  return response.json()
}

export async function loadNavdata() {
  if (!navdataCache) {
    const [airports, navpoints, routeGraph, routeSegments, routes] = await Promise.all([
      fetchJson('airports.json'),
      fetchJson('navpoints.json'),
      fetchJson('route-graph.json'),
      fetchJson('route-segments.json'),
      fetchJson('routes.json'),
    ])

    navdataCache = {
      airports,
      navpoints,
      routeGraph,
      routeSegmentsById: Object.fromEntries(routeSegments.map((segment) => [segment.id, segment])),
      routes,
    }
  }

  return navdataCache
}

function normalizeIdent(value) {
  return value.trim().toUpperCase()
}

function coordinatesOf(point) {
  return [point.coordinates.lon, point.coordinates.lat]
}

function getRouteType(segment) {
  return segment.routeType?.toUpperCase()
}

function isAllowedRouteType(segment, routeType) {
  return routeType === 'ALL' || getRouteType(segment) === routeType
}

function findShortestPath(routeGraph, routeSegmentsById, startId, endId, routeType) {
  const distances = new Map([[startId, 0]])
  const previous = new Map()
  const visited = new Set()
  const queue = [{ id: startId, distance: 0 }]

  while (queue.length > 0) {
    queue.sort((a, b) => a.distance - b.distance)
    const current = queue.shift()

    if (visited.has(current.id)) {
      continue
    }

    if (current.id === endId) {
      break
    }

    visited.add(current.id)

    for (const link of routeGraph[current.id] ?? []) {
      const segment = routeSegmentsById[link.segmentId]

      if (!segment || !isAllowedRouteType(segment, routeType)) {
        continue
      }

      const nextDistance = current.distance + link.distanceNm
      const currentBest = distances.get(link.to) ?? Number.POSITIVE_INFINITY

      if (nextDistance < currentBest) {
        distances.set(link.to, nextDistance)
        previous.set(link.to, {
          from: current.id,
          segmentId: link.segmentId,
        })
        queue.push({ id: link.to, distance: nextDistance })
      }
    }
  }

  if (!previous.has(endId) && startId !== endId) {
    return null
  }

  const segmentIds = []
  const navpointIds = [endId]
  let cursor = endId

  while (cursor !== startId) {
    const step = previous.get(cursor)

    if (!step) {
      return null
    }

    segmentIds.unshift(step.segmentId)
    navpointIds.unshift(step.from)
    cursor = step.from
  }

  return {
    distanceNm: Number((distances.get(endId) ?? 0).toFixed(2)),
    navpointIds,
    segmentIds,
  }
}

function buildPreviewGeometry(departureAirport, arrivalAirport, navpoints, path) {
  const coordinates = [
    coordinatesOf(departureAirport),
    ...path.navpointIds.map((id) => coordinatesOf(navpoints[id])),
    coordinatesOf(arrivalAirport),
  ]

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          role: 'route-preview-line',
        },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
      ...coordinates.map((coordinate, index) => ({
        type: 'Feature',
        properties: {
          role: 'route-preview-point',
          sequence: index + 1,
        },
        geometry: {
          type: 'Point',
          coordinates: coordinate,
        },
      })),
    ],
  }
}

function buildRouteDisplaySequence(departureAirport, arrivalAirport, path, segments) {
  const sequence = [departureAirport, path.navpointIds[0]]
  let currentRouteId = null

  segments.forEach((segment, index) => {
    if (segment.routeId !== currentRouteId) {
      sequence.push(segment.routeId)
      currentRouteId = segment.routeId
    }

    sequence.push(path.navpointIds[index + 1])
  })

  sequence.push(arrivalAirport)

  return sequence
}

export async function buildBriefingRoute({ departureAirport, entryFix, exitFix, arrivalAirport, routeType }) {
  const navdata = await loadNavdata()
  const departureId = normalizeIdent(departureAirport)
  const arrivalId = normalizeIdent(arrivalAirport)
  const entryId = normalizeIdent(entryFix)
  const exitId = normalizeIdent(exitFix)
  const selectedRouteType = routeType ?? 'ALL'

  const departure = navdata.airports[departureId]
  const arrival = navdata.airports[arrivalId]
  const entry = navdata.navpoints[entryId]
  const exit = navdata.navpoints[exitId]

  if (!departure) {
    throw new Error(`${departureId} airport not found`)
  }

  if (!arrival) {
    throw new Error(`${arrivalId} airport not found`)
  }

  if (!entry) {
    throw new Error(`${entryId} navpoint not found`)
  }

  if (!exit) {
    throw new Error(`${exitId} navpoint not found`)
  }

  const path = findShortestPath(
    navdata.routeGraph,
    navdata.routeSegmentsById,
    entryId,
    exitId,
    selectedRouteType,
  )

  if (!path) {
    throw new Error(`No ${selectedRouteType} route path found from ${entryId} to ${exitId}`)
  }

  const segments = path.segmentIds.map((id) => navdata.routeSegmentsById[id])
  const routeIds = [...new Set(segments.map((segment) => segment.routeId))]
  const routeTypes = [...new Set(segments.map((segment) => segment.routeType))]

  return {
    departureAirport: departureId,
    arrivalAirport: arrivalId,
    entryFix: entryId,
    exitFix: exitId,
    routeType: selectedRouteType,
    distanceNm: path.distanceNm,
    navpointIds: path.navpointIds,
    routeIds,
    routeTypes,
    segments,
    displaySequence: buildRouteDisplaySequence(departureId, arrivalId, path, segments),
    previewGeojson: buildPreviewGeometry(departure, arrival, navdata.navpoints, path),
  }
}
