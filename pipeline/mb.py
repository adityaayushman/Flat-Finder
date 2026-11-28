"""Fetching and reading Magicbricks pages. Pages carry their data as a JSON blob assigned to
window.SERVER_PRELOADED_STATE_; we cache each page on disk (gzip) so a crawl is resumable and polite."""
import gzip
import hashlib
import json
import pathlib
import re
import time
import urllib.request

ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache" / "mb"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
DELAY = 1.2  # seconds between requests per worker
BASE = "https://www.magicbricks.com/"


def fetch(url, retries=3):
    """Return page HTML, from cache when we have it. None after repeated failures."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html.gz")
    if f.exists() and f.stat().st_size > 2000:
        return gzip.decompress(f.read_bytes()).decode("utf-8", "ignore")
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
            f.write_bytes(gzip.compress(html.encode("utf-8"), 9))
            time.sleep(DELAY)
            return html
        except Exception as e:
            print("  retry", attempt + 1, url, e, flush=True)
            time.sleep(5 * (attempt + 1))
    return None


def state(html):
    """The page's preloaded state as a dict, or {} when absent."""
    m = re.search(r"SERVER_PRELOADED_STATE_\s*=\s*", html or "")
    if not m:
        return {}
    try:
        obj, _ = json.JSONDecoder().raw_decode(html[m.end():])
        return obj
    except ValueError:
        return {}


def list_page(html):
    """(total project count, [project cards]) from a results page."""
    st = state(html)
    total = int(st.get("searchAdditionalDataBean", {}).get("totalCount") or 0)
    return total, st.get("searchResult") or []


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def project_page(html):
    """Facts from one project page. Missing values stay None; nothing is guessed."""
    pd = state(html).get("projectDetailData") or {}
    pm = pd.get("prjMobileBean") or {}
    info, detail, rating = pm.get("infoBean") or {}, pm.get("detailBean") or {}, pm.get("ratingBean") or {}
    units = []
    for part in (pd.get("mUnitInfo") or "").split("|"):
        bits = [b.strip() for b in part.split(",")]
        m = re.search(r"([\d.]+)\s*Sq", part)
        if len(bits) >= 3 and m and bits[0].isdigit():
            units.append({"bhk": int(bits[0]), "sqft": float(m.group(1))})
    psf = [_num(x) for x in re.findall(r"[\d.]+", detail.get("rate") or "")]
    acres = re.search(r"([\d.]+)\s*Acre", detail.get("projArea") or "")
    return {
        "lat": _num(info.get("psmLatitude")), "lng": _num(info.get("psmLongitude")),
        "locality": info.get("localityName"), "developer": info.get("devName"),
        "price_min": _num(info.get("minPrice")), "price_max": _num(info.get("maxPrice")),
        "sale_min": _num(info.get("minSalePrice")), "sale_max": _num(info.get("maxSalePrice")),
        "rent_min": _num(info.get("minRentPrice")), "rent_max": _num(info.get("maxRentPrice")),
        "psf_low": psf[0] if psf else None, "psf_high": psf[-1] if psf else None,
        "status": detail.get("status"), "possession": detail.get("possessionByDate"),
        "kind": detail.get("propType"), "towers": _num(detail.get("towers")), "homes": _num(detail.get("units")),
        "acres": float(acres.group(1)) if acres else None,
        "amenities": [a["amenityName"] for a in pm.get("amenitiesList") or [] if a.get("isExists") == "true"],
        "units": units, "rating": _num(rating.get("psmAvgRt")), "rating_n": int(_num(rating.get("totalReview")) or 0),
        "listings_sale": int(_num(pm.get("sellCountProperty")) or 0), "listings_rent": int(_num(pm.get("rentCountProperty")) or 0),
    }
