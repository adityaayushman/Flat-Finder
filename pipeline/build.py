"""Turn crawled projects + OSM points into the compact file Homefit loads.

    python build.py <city>   ->  ../homefit/public/data/<city>.json and cities.json

Every number we did not read from a source is an estimate and is flagged as one:
  - per-BHK buy price = typical unit size x the project's price per sq ft, kept within its listed price range
  - rent = buy price x a rental yield that depends on BHK
  - smallest bedroom = from unit size with a simple room-share model (quality 'est')
"""
import json
import math
import pathlib
import statistics
import sys

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"
SITE = ROOT.parent / "homefit" / "public" / "data"
CITIES = json.loads((ROOT.parent / "data" / "cities.json").read_text())

AMENITY_WORDS = {
    "squash": ["squash"], "pool": ["swimming pool", "pool"], "gym": ["gym"], "club": ["club house", "clubhouse"],
    "tennis": ["tennis"], "badminton": ["badminton"], "jogging": ["jogging"], "kids": ["kids play", "children's play", "kids club", "play area"],
}
RENT_YIELD = {1: 0.040, 2: 0.030, 3: 0.025, 4: 0.022, 5: 0.020}


def kind_of(row):
    text = f"{row.get('ptype') or ''} {row.get('kind') or ''}".lower()
    if "apartment" in text:  # mixed projects (apartments plus villas) count as apartments
        return "apartment"
    if "villa" in text:
        return "villa"
    if "plot" in text or "land" in text:
        return "plot"
    if "builder floor" in text or "independent floor" in text:
        return "builder floor"
    if any(w in text for w in ("office", "shop", "commercial", "retail")):
        return "commercial"
    return "apartment" if row.get("units") or "apartment" in text else "other"


def amenity_keys(names):
    low = [n.lower() for n in names]
    return [k for k, words in AMENITY_WORDS.items() if any(w in n for n in low for w in words)]


def bedroom_estimate(sqft, bhk):
    """Smallest bedroom from unit size. Bedrooms take a share of the area; the smallest is the least of them."""
    area = max(60.0, 0.075 * sqft + 20 - 8 * max(0, bhk - 3))
    short = math.sqrt(area / 1.3)
    return {"s": round(short, 1), "a": round(area), "q": "est"}


def buy_estimate(sqft, psf, row):
    v = sqft * psf
    lo, hi = row.get("sale_min") or row.get("price_min"), row.get("sale_max") or row.get("price_max")
    if lo and hi and hi >= lo:
        v = min(max(v, lo * 0.8), hi * 1.2)
    return round(v)


def haversine_m(lng1, lat1, lng2, lat2):
    r = math.pi / 180
    a = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lng2 - lng1) * r / 2) ** 2
    return 12742000 * math.asin(math.sqrt(a))


class PoiIndex:
    """Nearest point of each kind, using a coarse grid so 2,500 projects x 2,500 points stays fast."""
    CELL = 0.02  # about 2 km

    def __init__(self, pois):
        self.grid = {}
        for p in pois:
            p = {**p, "k": "rail" if p["k"] == "metro" else p["k"]}
            self.grid.setdefault((p["k"], int(p["lng"] / self.CELL), int(p["lat"] / self.CELL)), []).append(p)

    def nearest(self, kind, lng, lat, rings=3):
        cx, cy = int(lng / self.CELL), int(lat / self.CELL)
        best = None
        for r in range(rings + 1):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    for p in self.grid.get((kind, cx + dx, cy + dy), []):
                        d = haversine_m(lng, lat, p["lng"], p["lat"])
                        if best is None or d < best:
                            best = d
            if best is not None and best <= r * self.CELL * 80000:  # nothing in a farther ring can beat it
                break
        return round(best) if best is not None else None


def society(row, pois):
    lat, lng = row.get("lat"), row.get("lng")
    if not lat or not lng:
        return None
    units, prices = [], {}
    psf = None
    if row.get("psf_low"):
        psf = (row["psf_low"] + row.get("psf_high", row["psf_low"])) / 2
    sizes_all = [u["sqft"] for u in row.get("units", [])]
    lo, hi = row.get("sale_min") or row.get("price_min"), row.get("sale_max") or row.get("price_max")
    if not psf and sizes_all and lo and hi:  # no printed rate: spread the price range over the typical unit size
        psf = (lo + hi) / 2 / statistics.median(sizes_all)
    by_bhk = {}
    for u in row.get("units", []):
        by_bhk.setdefault(u["bhk"], []).append(u["sqft"])
    for bhk, sizes in by_bhk.items():
        for sf in sizes:
            units.append({"b": bhk, "sf": sf, "r": bedroom_estimate(sf, bhk)})
        if psf:
            mid = statistics.median(sizes)
            buy = buy_estimate(mid, psf, row)
            rent = round(buy * RENT_YIELD.get(min(bhk, 5), 0.02) / 12 / 500) * 500
            prices[str(bhk)] = {"buy": [buy, 1, 0], "rent": [rent, 1, 0] if rent else None, "psf": round(psf)}
    near = {}
    for kind in ("park", "rail", "school", "hospital", "shopping"):
        d = pois.nearest(kind, lng, lat)
        if d is not None:
            near[kind] = d
    ready = "ready" in (row.get("status") or "").lower()
    return {
        "id": row["id"], "n": row.get("name"), "d": row.get("developer"), "l": row.get("locality"), "y": lat, "x": lng,
        "k": kind_of(row), "st": "ready" if ready else "uc", "po": row.get("possession"),
        "u": int(row["homes"]) if row.get("homes") else None, "ac": row.get("acres"),
        "am": amenity_keys(row.get("amenities", [])), "ra": row.get("rating") or None, "rc": row.get("rating_n", 0),
        "nr": near, "un": units, "pr": prices, "psf": round(psf) if psf else None, "v": 0,
        "url": row.get("url"), "gm": None,
    }


def build(city):
    rows = json.loads((OUT / city / "projects.json").read_text())
    pois = PoiIndex(json.loads((OUT / city / "pois.json").read_text()))
    seen, socs = set(), []
    for r in rows:
        s = society(r, pois)
        key = s and (s["n"], round(s["y"], 3), round(s["x"], 3))
        if s and key not in seen:
            seen.add(key)
            socs.append(s)
    by_loc = {}
    for s in socs:
        if s["psf"] and s["l"]:
            by_loc.setdefault(s["l"], []).append(s["psf"])
    cfg = CITIES[city]
    data = {
        "city": {"id": city, "name": cfg["name"], "center": cfg["center"], "zoom": cfg["zoom"]},
        "cityPsf": statistics.median([s["psf"] for s in socs if s["psf"]] or [0]) or None,
        "locPsf": {k: statistics.median(v) for k, v in by_loc.items() if len(v) >= 3},
        "counts": {"crawled": len(rows), "on_map": len(socs), "with_price": sum(1 for s in socs if s["psf"])},
        "societies": socs,
    }
    SITE.mkdir(parents=True, exist_ok=True)
    (SITE / f"{city}.json").write_text(json.dumps(data, separators=(",", ":")))
    built = sorted(p.stem for p in SITE.glob("*.json") if p.stem in CITIES)
    (SITE / "cities.json").write_text(json.dumps({c: {"name": CITIES[c]["name"]} for c in built}))
    print(city, data["counts"])


if __name__ == "__main__":
    build(sys.argv[1])
