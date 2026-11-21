# Flat Finder

Rank every housing society in Gurugram by how well it fits **you**: budget, smallest bedroom, commute, amenities and what matters most to you.

A web app (`homefit/`) backed by a reproducible Python pipeline (`pipeline/`) that builds the dataset from public sources.

> Derived from [kairothq/flat-finder](https://github.com/kairothq/flat-finder) (MIT). This project reuses its Gurugram dataset approach and replaces the pass/fail map with a weighted ranking.

## Repository layout

| Path | What it holds |
|---|---|
| `homefit/` | The web app (Vite + MapLibre GL). Scoring logic in `src/score.js`, with tests |
| `pipeline/` | Python data pipeline: crawling, parsing, OCR, pricing, room-size estimation, tests |
| `data/` | City configuration (`cities.json`) and hand-verified research per city (`data/verified/`) |

## Highlights

- **Fit score from 0 to 100**, weighted by the priorities you set (price, bedroom size, amenities, nearby places, commute, value, resident ratings).
- **Commute-aware ranking**: drop a workplace pin to get a drive-time estimate and a commute limit.
- **Value signal**: price per sq ft is compared with the area median.
- **Honest about missing data**: unknown values are skipped and labelled "no data", and each card shows how much of the score is backed by facts.
- **Shortlist and compare** up to six societies side by side.
- **Shareable link** stores filters, priorities and shortlist in the URL.

## Data pipeline

The pipeline in `pipeline/` turns public sources into the data file the app reads:

| Stage | Module | Purpose |
|---|---|---|
| Crawl | `mb_crawl.py`, `mb_parse.py` | Polite, cached, resumable Magicbricks crawler and parser |
| Geometry | `osm_fetch.py`, `geo.py` | Residential areas and building footprints from OpenStreetMap |
| Floor plans | `ocr.py`, `plan_ocr.py`, `brochure_ocr.py`, `found_ocr.py`, `hrera.py`, `jev_reader.py` | Read bedroom sizes from brochures, HRERA filings and floor plans |
| Estimates | `pricing.py`, `rooms_model.py` | Labelled price estimates and a cautious lower bound for the smallest bedroom |
| Build | `build_city.py`, `verified.py` | Merge everything with hand-verified research into the web data files |

The OCR stages use the macOS Vision framework, so they run on macOS. The web app and the rest of the pipeline run anywhere.

## Run the web app

Requires Node.js 18 or later.

```bash
cd homefit
npm install
npm run dev      # http://localhost:5173
npm test         # scoring tests
npm run build
```

## Run the pipeline tests

Requires Python 3.10 or later and `pytest`.

```bash
cd pipeline
pip install pytest
pytest
```

## How the score works

Hard limits remove a society: wrong type, over budget by more than 15%, a bedroom read from a plan below your minimum, a missing must-have amenity, or a drive longer than 125% of your limit. Everything else is scored from 0 to 1 per priority, then averaged by your weights. Estimated bedroom sizes never fail a society and score lower than sizes read from plans.

## Limitations

- Gurugram only for now. `data/cities.json` is set up for other cities.
- Prices marked `~` are estimates, not live listings.
- Commute is a rough peak-hour figure: straight line x 1.4 at 22 km/h, plus 5 minutes.
- Check any figure against the listing before acting on it.

## Credits

Dataset approach and original project: [kairothq/flat-finder](https://github.com/kairothq/flat-finder), MIT licensed.
