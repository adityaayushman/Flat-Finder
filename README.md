# Homefit

Rank every housing society in a city by how well it fits **you**: budget, smallest bedroom, commute, amenities and what matters most. Cities so far: Gurugram and Chennai.

## What it does

- **Fit score, 0 to 100.** You say how much price, bedroom size, amenities, nearby places, commute, value and resident ratings matter. Hard limits (type, budget, a must-have amenity, a too-long drive) remove a society outright.
- **Commute.** Drop a workplace pin on the map and set a longest drive. The estimate is rough peak-hour traffic, not live routing.
- **Value for money.** Each society's price per sq ft is compared with its area's median.
- **Honest about gaps.** An unknown is scored cautiously and labelled "no data". Every card says how much of its score is backed by facts.
- **Shortlist and compare** up to 6 societies side by side. Filters and shortlist live in a shareable link.
- **List, sort and export.** Sort by fit, price, commute, rating or value, and export the results as CSV. On phones the panels become tabs.

## Run it

```powershell
cd homefit
npm install
npm run dev      # app, http://localhost:5173
npm test         # scoring tests
npm run build
```

## Build a city's data (`pipeline/`, Python 3.9 or later, standard library only)

```powershell
cd pipeline
python crawl.py list chennai        # result pages -> out/chennai/index.json   (cached, resumable)
python crawl.py projects chennai    # project pages -> out/chennai/projects.json
python osm.py chennai               # parks, stations, schools, hospitals, malls from OpenStreetMap
python build.py chennai             # -> homefit/public/data/chennai.json
python -m unittest discover -s tests
```

Add a city by adding an entry to `data/cities.json` (Magicbricks slug, bounding box, map centre, optional `maxListPages`). Crawling is polite: about one request a second per worker, with every page cached on disk.

## How the numbers are made

What is read from the source: location, developer, status, possession, unit sizes, price per sq ft, amenities, resident ratings, listing counts. Everything below is **our estimate and is marked `~`** in the app:

- per-BHK buy price = typical unit size x the project's price per sq ft, kept within its listed price range (when no rate is printed, the price range spread over the typical size);
- rent = that price x a rental yield by BHK (4% for 1 BHK down to 2% for 5);
- smallest bedroom = a simple share-of-area model from unit size. It never fails a society on its own and scores lower than a measured plan would.

Nearby distances are straight-line to the closest OpenStreetMap point. Check anything important against the listing link before acting on it.

## Limits

Many projects list no unit sizes or rates, so about half of Chennai has no price. Bedroom sizes are estimates, not floor-plan readings. Commute is not live traffic.

## Credits

Project data comes from Magicbricks project pages and places from OpenStreetMap contributors (ODbL). The idea of ranking societies by room size and budget on a map was inspired by [kairothq/flat-finder](https://github.com/kairothq/flat-finder) (MIT). No code or data from that project is included here.
