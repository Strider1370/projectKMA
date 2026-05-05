# Project Architecture

This project is a Vite + React aviation weather dashboard focused on Mapbox-based Korean aviation map layers and route briefing data.

## Root Structure

```text
ProjectKMA/
  agents.md
  Architecture.md
  index.html
  package.json
  package-lock.json
  vite.config.js
  public/
  reference/
  scripts/
  src/
```

## Application Source

```text
src/
  main.jsx
  App.jsx
  App.css
  components/
    Map/
      MapView.jsx
      MapView.css
    Sidebar/
      Sidebar.jsx
      Sidebar.css
  config/
    mapConfig.js
  layers/
    aviation/
      aviationWfsLayers.js
      addAviationWfsLayers.js
  services/
    navdata/
      routePlanner.js
```

- `App.jsx`: owns global shell state such as active side panel and UTC clock.
- `components/Sidebar`: fixed left navigation rail.
- `components/Map`: Mapbox map view, aviation layer toggles, route check panel, and route preview rendering.
- `config/mapConfig.js`: initial map center, zoom limits, and max bounds.
- `layers/aviation`: aviation layer definitions and Mapbox source/layer creation.
- `services/navdata/routePlanner.js`: loads generated navdata and finds route paths between entry/exit fixes.

## Public Static Assets

```text
public/
  favicon.svg
  data/
    fir.geojson
    sectors.geojson
    waypoints.geojson
    navaids.geojson
    airports.geojson
    navdata/
      airports.json
      waypoints.json
      navaids.json
      navpoints.json
      routes.json
      route-segments.json
      route-graph.json
      airport-route-links.json
      cycle.json
      README.md
  Symbols/
```

- `public/data/*.geojson`: map display data consumed directly by Mapbox.
- `public/data/navdata/*.json`: normalized briefing and route-planning data.
- `public/Symbols`: aviation chart symbols and app-specific colored symbol variants.

## Reference Data

```text
reference/
  AD 1.3.pdf
  ENR 2.1.pdf
  ENR 3.1.pdf
  ENR 3.2.pdf
  ENR 4.1.pdf
  html/
    KR-ENR-3.1-en-GB.html
    KR-ENR-3.3-en-GB.html
    KR-ENR-4.1-en-GB.html
```

- PDF files are retained as source references.
- HTML eAIP files are preferred for route parsing because table structure is more reliable than PDF text extraction.

## Scripts

```text
scripts/
  generate_navdata.py
```

`generate_navdata.py` reads map GeoJSON and AIP/eAIP reference files, then generates normalized route-planning JSON under `public/data/navdata`.

## Data Flow

```text
AIP / eAIP references
  -> scripts/generate_navdata.py
  -> public/data/navdata/*.json
  -> src/services/navdata/routePlanner.js
  -> src/components/Map/MapView.jsx
```

Map display data follows a separate direct path:

```text
public/data/*.geojson
  -> src/layers/aviation/addAviationWfsLayers.js
  -> Mapbox sources and layers
```

## Current Route Check Scope

The route check panel supports:

- departure airport
- entry fix
- exit fix
- arrival airport
- route type filter: `ALL`, `RNAV`, or `ATS`

It does not yet model SID/STAR transitions. Airport-to-entry and exit-to-airport links are shown as direct preview connections for validation only.
