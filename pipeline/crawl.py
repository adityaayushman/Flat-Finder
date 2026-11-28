"""Crawl one city from Magicbricks.

    python crawl.py list <city>       # result pages -> out/<city>/index.json
    python crawl.py projects <city>   # each project page -> out/<city>/projects.json

Both steps are cached and resumable. maxListPages in data/cities.json caps big cities."""
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import mb

ROOT = pathlib.Path(__file__).parent
CITIES = json.loads((ROOT.parent / "data" / "cities.json").read_text())


def out_dir(city):
    d = ROOT / "out" / city
    d.mkdir(parents=True, exist_ok=True)
    return d


def crawl_list(city):
    cfg = CITIES[city]
    url = mb.BASE + "residential-projects-in-" + cfg["slug"] + "-nprid/page-{}"
    total, _ = mb.list_page(mb.fetch(url.format(1)))
    pages = min(-(-total // 20), cfg.get("maxListPages", 10 ** 6))
    found = {}
    for n in range(1, pages + 1):
        _, cards = mb.list_page(mb.fetch(url.format(n)))
        for c in cards:
            found[c["psmid"]] = {"id": c["psmid"], "name": c.get("psmName"), "url": mb.BASE + c["pdpUrl"], "ptype": c.get("propertyTypeDesc"), "city_total": total}
        print(f"list {n}/{pages}: {len(found)} projects", flush=True)
    (out_dir(city) / "index.json").write_text(json.dumps(list(found.values())))


def crawl_projects(city):
    d = out_dir(city)
    index = json.loads((d / "index.json").read_text())

    def one(p):
        html = mb.fetch(p["url"])
        try:
            facts = mb.project_page(html) if html else {}
        except Exception as e:  # one odd page should not stop the crawl
            print("  parse failed", p["url"], e, flush=True)
            facts = {}
        return {**p, **{k: v for k, v in facts.items() if v not in (None, [], "")}}

    done = []
    with ThreadPoolExecutor(max_workers=2) as ex:
        for i, row in enumerate(ex.map(one, index), 1):
            done.append(row)
            if i % 100 == 0 or i == len(index):
                print(f"project {i}/{len(index)}", flush=True)
                (d / "projects.json").write_text(json.dumps(done))


if __name__ == "__main__":
    step, city = sys.argv[1], sys.argv[2]
    {"list": crawl_list, "projects": crawl_projects}[step](city)
