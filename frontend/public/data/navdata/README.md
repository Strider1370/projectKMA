# Navigation Data

This folder contains briefing-oriented navigation data generated from the map GeoJSON files and AIP reference PDFs.

Source files:
- `public/data/airports.geojson`
- `public/data/waypoints.geojson`
- `public/data/navaids.geojson`
- `reference/AD 1.3.pdf`
- `reference/ENR 3.1.pdf`
- `reference/ENR 3.2.pdf`
- `reference/ENR 4.1.pdf`

Generated files:
- `airports.json`: airport index keyed by ICAO.
- `waypoints.json`: waypoint index keyed by ident.
- `navaids.json`: NAVAID index keyed by ident.
- `navpoints.json`: combined waypoint/NAVAID index for route graph lookup.
- `routes.json`: route catalog with extracted point sequences when available.
- `route-segments.json`: route graph edge list with from/to navpoints and simple LineString geometry.
- `route-graph.json`: bidirectional adjacency index derived from route segments.
- `airport-route-links.json`: temporary nearest-fix airport access candidates until SID/STAR data is modeled.
- `cycle.json`: cycle and source metadata.

Notes:
- Route sequences are extracted from AIP ENR 3.1/3.2 PDF text and require review before operational use.
- `airport-route-links.json` is intentionally approximate. It is a placeholder for enroute briefing experiments until SID/STAR transition fixes are added.
- Regenerate with `scripts/generate_navdata.py`.
