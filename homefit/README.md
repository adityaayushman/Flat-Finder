# Homefit

Rank every housing society in Gurugram by how well it fits **you**: budget, smallest bedroom, commute, amenities and what matters most.

Inspired by [kairothq/flat-finder](https://github.com/kairothq/flat-finder) (MIT). Homefit reuses its Gurugram dataset (Magicbricks listings, OpenStreetMap, brochure and HRERA readings) and replaces the pass/fail map with a ranking.

## What is new compared with flat-finder

| flat-finder | Homefit |
|---|---|
| Each society is match, likely or no | A **fit score from 0 to 100**, weighted by what you say matters |
| No commute | **Drop a workplace pin**: drive-time estimate, limit and ranking |
| No value signal | **Price per sq ft against the area median** feeds the score |
| Missing data hides or passes a society | Missing data is **scored cautiously and labelled "no data"**; the card shows how much of the score is backed by facts |
| One card at a time | **Shortlist of 6 with a side-by-side comparison**, best value per row highlighted |
| Settings lost on reload | **Shareable link** holds filters, priorities and shortlist |
| 28 MB of map data, macOS OCR to rebuild | **2 MB slim data file**, runs anywhere with Node |
| Map only | Ranked list, sort by fit, price, commute, rating or value, CSV export, phone tabs |

## Run it

```powershell
npm install
npm run dev      # http://localhost:5173
npm test         # scoring tests
npm run build
```

Rebuild the slim data from a flat-finder checkout:

```powershell
node scripts/slim.mjs path\to\flat-finder\web\public\data\gurgaon.json
```

## How the score works (`src/score.js`)

Hard limits remove a society: wrong type, over budget by more than 15%, a bedroom read from a plan below your minimum, a missing must-have amenity, a drive longer than 125% of your limit. Everything else is scored 0 to 1 per priority (price, bedroom size, amenities, nearby places, commute, value, resident ratings), then averaged by your weights. Estimated bedroom sizes never fail a society and score lower than plan readings. Prices marked `~` are estimates, not live listings. Commute is a rough peak-hour figure: straight line x 1.4 at 22 km/h plus 5 minutes.

## Limits

Gurugram only for now. Data is as of flat-finder's last build. Check any figure with the Listings link before acting on it.
