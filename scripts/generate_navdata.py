from __future__ import annotations

import json
import math
import re
from html.parser import HTMLParser
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "public" / "data"
REFERENCE = ROOT / "reference"
REFERENCE_HTML = REFERENCE / "html"
OUT_DIR = PUBLIC_DATA / "navdata"

AIRAC_CYCLE = "AIRAC 2026-04-15"
ROUTE_KIND_BY_PREFIX = {
    "L": "RNAV",
    "Y": "RNAV",
    "Z": "RNAV",
}


class TableExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._table_depth = 0
        self._row = None
        self._cell = None
        self._current_table = None
        self._class_stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "")
        self._class_stack.append(classes)

        if tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._current_table = []
            return

        if self._table_depth != 1:
            return

        if tag == "tr":
            self._row = {"class": classes, "cells": []}
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = {"class": classes, "text": ""}

    def handle_endtag(self, tag):
        if tag == "table":
            if self._table_depth == 1 and self._current_table is not None:
                self.tables.append(self._current_table)
                self._current_table = None
            self._table_depth = max(0, self._table_depth - 1)
        elif self._table_depth == 1 and tag in {"td", "th"} and self._cell is not None:
            self._cell["text"] = normalize_text(self._cell["text"])
            self._row["cells"].append(self._cell)
            self._cell = None
        elif self._table_depth == 1 and tag == "tr" and self._row is not None:
            self._current_table.append(self._row)
            self._row = None

        if self._class_stack:
            self._class_stack.pop()

    def handle_data(self, data):
        if self._table_depth == 1 and self._cell is not None:
            self._cell["text"] += data


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def read_geojson(name: str) -> dict:
    with (PUBLIC_DATA / name).open("r", encoding="utf-8") as file:
        return json.load(file)


def coordinates(feature: dict) -> dict:
    lon, lat = feature["geometry"]["coordinates"]
    return {"lat": lat, "lon": lon}


def haversine_nm(a: dict, b: dict) -> float:
    radius_nm = 3440.065
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    dlat = math.radians(b["lat"] - a["lat"])
    dlon = math.radians(b["lon"] - a["lon"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(radius_nm * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h)), 2)


def point_from_feature(feature: dict, id_field: str) -> dict:
    props = feature["properties"]
    point = {
        "id": props[id_field],
        "coordinates": coordinates(feature),
        "source": props.get("source"),
    }

    for key, value in props.items():
        if key in {id_field, "source"}:
            continue
        point[key] = value

    return point


def index_features(geojson: dict, id_field: str) -> dict:
    items = [point_from_feature(feature, id_field) for feature in geojson["features"]]
    return {item["id"]: item for item in sorted(items, key=lambda item: item["id"])}


def extract_pdf_text(filename: str) -> str:
    reader = PdfReader(str(REFERENCE / filename))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_html_tables(filename: str) -> list[list[dict]]:
    path = REFERENCE_HTML / filename
    if not path.exists():
        return []

    parser = TableExtractor()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser.tables


def route_kind(route_id: str, route_sources: set[str]) -> str:
    if route_id[:1] in ROUTE_KIND_BY_PREFIX:
        return ROUTE_KIND_BY_PREFIX[route_id[:1]]
    if route_sources == {"ENR 3.2"}:
        return "RNAV"
    return "ATS"


def find_route_sections(texts: dict[str, str], route_ids: set[str]) -> dict[str, list[dict]]:
    route_pattern = "|".join(re.escape(route_id) for route_id in sorted(route_ids, key=len, reverse=True))
    start_pattern = re.compile(rf"(?<![A-Z0-9])({route_pattern})(?=\s|[A-Z][a-z]|Daegu|Incheon|\*)")
    sections: dict[str, list[dict]] = {route_id: [] for route_id in route_ids}

    for source, text in texts.items():
        starts = []
        for match in start_pattern.finditer(text):
            route_id = match.group(1)
            header = text[match.start() : match.start() + 220]
            if "ACC" not in header and "FREQ" not in header and "Route designator" not in header:
                continue
            starts.append((match.start(), route_id))

        starts.sort()
        for index, (start, route_id) in enumerate(starts):
            end = starts[index + 1][0] if index + 1 < len(starts) else len(text)
            section = text[start:end]
            sections[route_id].append({"source": source, "text": section})

    return sections


def route_designator_from_table(table: list[dict], route_ids: set[str]) -> str | None:
    for row in table:
        if "AmdtDeleted" in row.get("class", ""):
            continue
        if "Table-row-type-1" not in row.get("class", ""):
            continue
        if not row["cells"]:
            continue

        joined = row["cells"][0]["text"]
        route_match = re.match(r"^\*?\s*([A-Z]\d{2,3})(?=\*|\(|\s|$)", joined)
        if route_match and route_match.group(1) in route_ids:
            return route_match.group(1)

    return None


def navpoint_ident_from_name(name: str, navpoint_ids: set[str]) -> str | None:
    for match in re.finditer(r"\(([A-Z0-9]{3,5})\)", name):
        ident = match.group(1)
        if ident in navpoint_ids:
            return ident

    for match in re.finditer(r"(?<![A-Z0-9])([A-Z0-9]{3,5})(?![A-Z0-9])", name):
        ident = match.group(1)
        if ident in navpoint_ids:
            return ident

    return None


def extract_html_route_sequences(route_ids: set[str], navpoint_ids: set[str]) -> dict[str, dict]:
    html_sources = {
        "ENR 3.1 HTML": "KR-ENR-3.1-en-GB.html",
        "ENR 3.3 HTML": "KR-ENR-3.3-en-GB.html",
    }
    sequences: dict[str, dict] = {}

    for source, filename in html_sources.items():
        for table in parse_html_tables(filename):
            route_id = route_designator_from_table(table, route_ids)
            if not route_id:
                continue

            sequence = []
            for row in table:
                row_class = row.get("class", "")
                if "AmdtDeleted" in row_class or "Table-row-type-2" not in row_class:
                    continue

                cells = row["cells"]
                if len(cells) < 2:
                    continue

                marker = cells[0]["text"]
                if not marker or marker == " ":
                    continue

                ident = navpoint_ident_from_name(cells[1]["text"], navpoint_ids)
                if ident and ident not in sequence:
                    sequence.append(ident)

            if len(sequence) > len(sequences.get(route_id, {}).get("sequence", [])):
                sequences[route_id] = {
                    "sequence": sequence,
                    "source": source,
                }

    return sequences


def trim_route_section(section: str) -> str:
    start_candidates = [section.find(marker) for marker in ("△", "▲", "♀", "°") if section.find(marker) >= 0]
    if start_candidates:
        section = section[min(start_candidates) :]

    end_candidates = []
    for marker in ("1. Critical DME", "2. DME GAP", "Change :", "OFFICE OF CIVIL AVIATION"):
        pos = section.find(marker)
        if pos >= 0:
            end_candidates.append(pos)

    if end_candidates:
        section = section[: min(end_candidates)]

    return section


def extract_route_sequence(section: str, navpoint_ids: set[str]) -> list[str]:
    sequence = []
    marker_pattern = re.compile(r"[△▲♀°¤]+")
    trimmed_section = trim_route_section(section)

    for match in marker_pattern.finditer(trimmed_section):
        window = trimmed_section[match.end() : match.end() + 140]
        candidates = []

        for paren in re.finditer(r"\(([A-Z0-9]{3,5})\)", window):
            ident = paren.group(1)
            if ident in navpoint_ids:
                candidates.append((paren.start(), ident))

        for ident_match in re.finditer(r"(?<![A-Z0-9])([A-Z]{3,5})(?=(?:\(|\d|N/A|\s))", window):
            ident = ident_match.group(1)
            if ident in navpoint_ids:
                candidates.append((ident_match.start(), ident))

        if not candidates:
            continue

        ident = min(candidates, key=lambda candidate: candidate[0])[1]
        if ident not in sequence:
            sequence.append(ident)

    return sequence


def build_routes(waypoints: dict, navaids: dict) -> tuple[dict, list[dict]]:
    route_sources: dict[str, set[str]] = {}

    for waypoint in waypoints.values():
        for route_id in waypoint.get("routes", []):
            route_sources.setdefault(route_id, set()).update(waypoint.get("sources", []))

    texts = {
        "ENR 3.1": extract_pdf_text("ENR 3.1.pdf"),
        "ENR 3.2": extract_pdf_text("ENR 3.2.pdf"),
    }
    sections = find_route_sections(texts, set(route_sources))
    navpoints = {**waypoints, **navaids}
    navpoint_ids = set(navpoints)
    html_sequences = extract_html_route_sequences(set(route_sources), navpoint_ids)
    routes = {}
    route_segments = []

    for route_id in sorted(route_sources):
        best_sequence = []
        best_source = None

        if route_id in html_sequences:
            best_sequence = html_sequences[route_id]["sequence"]
            best_source = html_sequences[route_id]["source"]

        if not best_sequence:
            for section in sections.get(route_id, []):
                sequence = extract_route_sequence(section["text"], navpoint_ids)
                if len(sequence) > len(best_sequence):
                    best_sequence = sequence
                    best_source = section["source"]

        sources = sorted(route_sources[route_id])
        kind = route_kind(route_id, route_sources[route_id])
        routes[route_id] = {
            "id": route_id,
            "type": kind,
            "sources": sources,
            "sequenceSource": best_source,
            "sequence": best_sequence,
            "segmentCount": max(0, len(best_sequence) - 1),
            "cycle": AIRAC_CYCLE,
        }

        for index, (start_id, end_id) in enumerate(zip(best_sequence, best_sequence[1:])):
            start = navpoints[start_id]["coordinates"]
            end = navpoints[end_id]["coordinates"]
            route_segments.append(
                {
                    "id": f"{route_id}-{index + 1:03d}",
                    "routeId": route_id,
                    "routeType": kind,
                    "sequence": index + 1,
                    "from": start_id,
                    "to": end_id,
                    "distanceNm": haversine_nm(start, end),
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[start["lon"], start["lat"]], [end["lon"], end["lat"]]],
                    },
                    "source": best_source,
                    "cycle": AIRAC_CYCLE,
                }
            )

    return routes, route_segments


def build_navpoints(waypoints: dict, navaids: dict) -> dict:
    navpoints = {}

    for ident, waypoint in waypoints.items():
        navpoints[ident] = {
            **waypoint,
            "id": ident,
            "kind": "waypoint",
        }

    for ident, navaid in navaids.items():
        navpoints[ident] = {
            **navaid,
            "id": ident,
            "kind": "navaid",
        }

    return {key: navpoints[key] for key in sorted(navpoints)}


def build_route_graph(route_segments: list[dict]) -> dict:
    graph = {}

    for segment in route_segments:
        for start_id, end_id in ((segment["from"], segment["to"]), (segment["to"], segment["from"])):
            graph.setdefault(start_id, []).append(
                {
                    "to": end_id,
                    "routeId": segment["routeId"],
                    "routeType": segment["routeType"],
                    "segmentId": segment["id"],
                    "distanceNm": segment["distanceNm"],
                }
            )

    for links in graph.values():
        links.sort(key=lambda link: (link["to"], link["routeId"]))

    return {key: graph[key] for key in sorted(graph)}


def build_airport_route_links(airports: dict, waypoints: dict) -> dict:
    links = {}

    for airport_id, airport in airports.items():
        nearby = []
        for waypoint_id, waypoint in waypoints.items():
            distance_nm = haversine_nm(airport["coordinates"], waypoint["coordinates"])
            if distance_nm <= 80:
                nearby.append(
                    {
                        "fix": waypoint_id,
                        "distanceNm": distance_nm,
                        "routes": waypoint.get("routes", []),
                    }
                )

        nearby.sort(key=lambda item: item["distanceNm"])
        links[airport_id] = {
            "airport": airport_id,
            "method": "nearest-waypoint-placeholder",
            "notes": "Temporary enroute access candidates until SID/STAR transition fixes are modeled.",
            "nearbyFixes": nearby[:8],
        }

    return links


def write_json(name: str, data) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / name).open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=True, indent=2, sort_keys=True)
        file.write("\n")


def main() -> None:
    airports = index_features(read_geojson("airports.geojson"), "icao")
    waypoints = index_features(read_geojson("waypoints.geojson"), "ident")
    navaids = index_features(read_geojson("navaids.geojson"), "ident")
    routes, route_segments = build_routes(waypoints, navaids)
    navpoints = build_navpoints(waypoints, navaids)
    route_graph = build_route_graph(route_segments)
    airport_route_links = build_airport_route_links(airports, waypoints)

    write_json("airports.json", airports)
    write_json("waypoints.json", waypoints)
    write_json("navaids.json", navaids)
    write_json("navpoints.json", navpoints)
    write_json("routes.json", routes)
    write_json("route-segments.json", route_segments)
    write_json("route-graph.json", route_graph)
    write_json("airport-route-links.json", airport_route_links)
    write_json(
        "cycle.json",
        {
            "cycle": AIRAC_CYCLE,
            "references": ["AD 1.3", "ENR 3.1", "ENR 3.2", "ENR 4.1"],
            "notes": [
                "SID/STAR links are intentionally excluded.",
                "Route sequences are extracted from AIP ENR 3.1/3.2 text and should be reviewed before operational use.",
            ],
        },
    )

    print(
        json.dumps(
            {
                "airports": len(airports),
                "waypoints": len(waypoints),
                "navaids": len(navaids),
                "navpoints": len(navpoints),
                "routes": len(routes),
                "routeSegments": len(route_segments),
                "routeGraphNodes": len(route_graph),
                "airportRouteLinks": len(airport_route_links),
                "routesWithSequence": sum(1 for route in routes.values() if route["sequence"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
