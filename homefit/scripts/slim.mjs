// Turns the big flat-finder city file (10 MB) into a slim file (~1.5 MB) with only what Homefit needs.
// Usage: node scripts/slim.mjs <path to flat-finder gurgaon.json>
import fs from 'node:fs';

const src = process.argv[2] || '../../ref/flat-finder/web/public/data/gurgaon.json';
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));

const AMEN = {
  squash: ['squash'], pool: ['swimming pool', 'pool'], gym: ['gym'], club: ['club house', 'clubhouse'],
  tennis: ['tennis'], badminton: ['badminton'], jogging: ['jogging'], kids: ['kids play', "children's play", 'kids club'],
};
const amenKeys = (s) => Object.entries(AMEN).filter(([k, words]) => {
  const f = s.amen_facts?.[k];
  if (f) return f.value === 'yes';
  return s.amenities.some((a) => words.some((w) => a.toLowerCase().includes(w)));
}).map(([k]) => k);

const price = (p, mode) => {
  const real = p.flags?.[mode] ? null : p[mode]?.median;
  if (real) return [Math.round(real), 0, p[mode].n || 0];
  const est = p[`${mode}_est`]?.value;
  return est ? [Math.round(est), 1, 0] : null;
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// smallest bedroom we know for a unit: read plans first, then Jev, then a size-based estimate
function room(u) {
  if (u.bedrooms?.length) {
    const smallest = u.bedrooms.reduce((m, [a, b]) => (a * b < m[0] * m[1] ? [a, b] : m));
    return { s: Math.min(...smallest), a: Math.round(smallest[0] * smallest[1]), q: u.rooms_complete ? 'read' : 'part' };
  }
  if (u.ai?.min_short != null) return { s: u.ai.min_short, a: u.ai.area_lb ?? null, q: 'ai' };
  if (u.est_short != null) return { s: u.est_short, a: u.est_area, q: 'est' };
  return null;
}

const societies = raw.societies.filter((s) => s.lat && s.lng).map((s) => {
  const prices = {};
  for (const [b, p] of Object.entries(s.prices || {})) {
    prices[b] = { buy: price(p, 'buy'), rent: price(p, 'rent'), psf: p.psf || null };
  }
  const units = s.unit_types.map((u) => ({
    b: u.bhk, sf: u.size_sqft || u.super_sqft || u.carpet_sqft || null, r: room(u),
  })).filter((u) => u.b || u.sf);
  const near = {};
  for (const [k, v] of Object.entries(s.nearby || {})) if (v?.m != null) near[k] = Math.round(v.m);
  return {
    id: s.id, n: s.name, d: s.developer, l: s.locality, y: s.lat, x: s.lng, k: s.kind,
    st: /ready/i.test(s.status || '') ? 'ready' : 'uc', po: s.possession || null, u: s.units || null, ac: s.acres || null,
    am: amenKeys(s), ra: s.rating || null, rc: s.rating_count || 0, nr: near, un: units, pr: prices,
    psf: s.psf_now || null, v: s.verified ? 1 : 0, url: s.url || null, gm: s.gmaps || null,
  };
});

// locality median price per sq ft, used for the value score
const byLoc = {};
for (const s of societies) if (s.psf) (byLoc[s.l] ||= []).push(s.psf);
const locPsf = {};
for (const [l, a] of Object.entries(byLoc)) if (a.length >= 3) locPsf[l] = median(a);
const cityPsf = median(societies.map((s) => s.psf).filter(Boolean));

const out = { city: raw.city, cityPsf, locPsf, counts: raw.counts, societies };
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/gurgaon.json', JSON.stringify(out));
console.log(`wrote ${societies.length} societies, ${(fs.statSync('public/data/gurgaon.json').size / 1e6).toFixed(2)} MB`);
