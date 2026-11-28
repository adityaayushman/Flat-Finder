"""Fetch points of interest for a city bbox from OpenStreetMap (Overpass), once, and cache them.

    python osm.py <city>   ->  out/<city>/pois.json   [{k, name, lng, lat}]
k is one of: park, rail, school, hospital, shopping."""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).parent
CITIES = json.loads((ROOT.parent / "data" / "cities.json").read_text())
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

QUERY = """[out:json][timeout:240];(
  nwr["leisure"="park"]{bb};
  node["railway"~"^(station|halt)$"]{bb}; node["station"="subway"]{bb};
  nwr["amenity"="school"]{bb}; nwr["amenity"="hospital"]{bb};
  nwr["shop"~"^(mall|supermarket)$"]{bb};
);out center tags;"""


def kind_of(tags):
    if tags.get("leisure") == "park":
        return "park"
    if tags.get("railway") in ("station", "halt") or tags.get("station") == "subway":
        return "rail"
    if tags.get("amenity") in ("school", "hospital"):
        return tags["amenity"]
    if tags.get("shop") in ("mall", "supermarket"):
        return "shopping"
    return None


def parse(elements):
    out = []
    for el in elements:
        c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        k = kind_of(el.get("tags", {}))
        if c and k:
            out.append({"k": k, "name": el["tags"].get("name"), "lng": round(c["lon"], 5), "lat": round(c["lat"], 5)})
    return out


def fetch(city):
    s, w, n, e = CITIES[city]["bbox"]
    body = urllib.parse.urlencode({"data": QUERY.replace("{bb}", f"({s},{w},{n},{e})")}).encode()
    for attempt in range(2):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "homefit-pipeline/1.0"})
                return json.loads(urllib.request.urlopen(req, timeout=300).read())["elements"]
            except Exception as ex:
                print("mirror failed", url, str(ex)[:80], flush=True)
                time.sleep(10)
    raise SystemExit("all Overpass mirrors failed")


if __name__ == "__main__":
    city = sys.argv[1]
    out = ROOT / "out" / city
    out.mkdir(parents=True, exist_ok=True)
    pois = parse(fetch(city))
    (out / "pois.json").write_text(json.dumps(pois))
    print(city, len(pois), "points of interest")
