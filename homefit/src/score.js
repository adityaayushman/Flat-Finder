// Pure scoring logic. No DOM. A society gets a fit score 0-100 from weighted components,
// plus a list of hard-filter failures. Unknown data never counts for or against a society:
// the component is skipped and the society's "coverage" drops, so the UI can say "based on 4 of 7 priorities".

export const AMENITIES = { pool: 'Pool', gym: 'Gym', club: 'Clubhouse', squash: 'Squash', tennis: 'Tennis', badminton: 'Badminton', jogging: 'Jogging track', kids: 'Kids play' };
export const NEARBY = {
  rail: { label: 'Metro or rail', ideal: 500, max: 3000 },
  park: { label: 'Park', ideal: 300, max: 1500 },
  school: { label: 'School', ideal: 500, max: 2500 },
  hospital: { label: 'Hospital', ideal: 800, max: 4000 },
  shopping: { label: 'Mall or market', ideal: 500, max: 3000 },
};

export const DEFAULTS = {
  mode: 'buy', kinds: ['apartment'], bhk: [], budget: null, minSqft: null, maxSqft: null,
  minRoom: null, // smallest bedroom short side, in feet
  amenities: [], near: [], ready: false,
  work: null, // [lng, lat]
  maxCommute: null, // minutes
  w: { budget: 2, room: 2, amenities: 2, near: 1, commute: 2, value: 1, quality: 1 },
};

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (v, best, worst) => clamp((worst - v) / (worst - best));

export function haversineKm(lng1, lat1, lng2, lat2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Rough peak-hour drive: straight line x 1.4 for roads, about 22 km/h in Gurugram traffic, plus 5 min to park and walk.
export function commuteMinutes(s, work) {
  if (!work) return null;
  return Math.round(((haversineKm(s.x, s.y, work[0], work[1]) * 1.4) / 22) * 60 + 5);
}

// Cheapest price among the BHKs chosen, preferring real listing medians over our estimates.
export function priceFor(s, mode, bhk) {
  let best = null;
  for (const [b, p] of Object.entries(s.pr)) {
    if (bhk.length && !bhk.includes(+b)) continue;
    const v = p[mode];
    if (v && (!best || v[0] < best.value)) best = { value: v[0], est: !!v[1], bhk: +b, n: v[2] };
  }
  return best;
}

export function unitsFor(s, c) {
  return s.un.filter((u) => (!c.bhk.length || c.bhk.includes(u.b)) &&
    (!c.minSqft || u.sf == null || u.sf >= c.minSqft) &&
    (!c.maxSqft || u.sf == null || u.sf <= c.maxSqft));
}

// Best known smallest-bedroom among eligible units. q says how much to trust it.
export function bestRoom(s, c) {
  let best = null;
  for (const u of unitsFor(s, c)) {
    if (!u.r) continue;
    if (!best || u.r.s > best.s) best = u.r;
  }
  return best;
}

export function evaluate(s, c, ctx) {
  const fails = [];
  const parts = [];
  const add = (key, score, note) => parts.push({ key, score, note, w: c.w[key] ?? 1 });

  if (c.kinds.length && !c.kinds.includes(s.k)) fails.push('type');
  if (c.ready && s.st !== 'ready') fails.push('not ready');
  for (const a of c.amenities) if (!s.am.includes(a)) fails.push(`no ${a}`);

  const units = unitsFor(s, c);
  if ((c.bhk.length || c.minSqft || c.maxSqft) && s.un.length && !units.length) fails.push('size');

  const p = priceFor(s, c.mode, c.bhk);
  if (c.budget && p) {
    if (p.value > c.budget * 1.15) fails.push('over budget');
    else add('budget', p.value <= c.budget ? 0.6 + 0.4 * clamp((1 - p.value / c.budget) * 2) : 0.3, p.value > c.budget ? 'a stretch' : 'in budget');
  }

  const room = bestRoom(s, c);
  if (c.minRoom && room) {
    if (room.q !== 'est' && room.s < c.minRoom - 0.05) fails.push('small rooms');
    else {
      const trust = { read: 1, part: 0.9, ai: 0.8, est: 0.55 }[room.q];
      add('room', room.s >= c.minRoom ? trust : trust * 0.3, room.q === 'est' ? 'estimated from unit size' : 'from the floor plan');
    }
  }

  if (c.amenities.length) add('amenities', 1, 'all wanted');

  if (c.near.length) {
    const vals = c.near.map((k) => (s.nr[k] != null ? lerp(s.nr[k], NEARBY[k].ideal, NEARBY[k].max) : null)).filter((v) => v != null);
    if (vals.length) add('near', vals.reduce((a, b) => a + b, 0) / vals.length, 'nearby places');
  }

  const mins = commuteMinutes(s, c.work);
  if (mins != null) {
    if (c.maxCommute && mins > c.maxCommute * 1.25) fails.push('long commute');
    else add('commute', lerp(mins, 10, c.maxCommute ? c.maxCommute * 1.25 : 70), `${mins} min`);
  }

  const loc = ctx.locPsf?.[s.l] ?? ctx.cityPsf;
  if (s.psf && loc) add('value', clamp(0.5 + (loc - s.psf) / (2 * loc)), s.psf < loc ? 'below the area median' : 'above the area median');

  if (s.ra) add('quality', clamp((s.ra - 2.5) / 2.5) * Math.min(1, 0.5 + s.rc / 10), `${s.ra} from residents`);

  // Priorities the user switched on but we have no data for count at a cautious 0.35,
  // so a society with facts beats one with gaps, and the card says "no data" instead of hiding it.
  const active = { budget: !!c.budget, room: !!c.minRoom, amenities: c.amenities.length > 0, near: c.near.length > 0, commute: !!c.work, value: true, quality: true };
  const have = new Set(parts.map((x) => x.key));
  for (const [key, on] of Object.entries(active)) if (on && !have.has(key) && (c.w[key] ?? 0) > 0) parts.push({ key, score: 0.35, note: 'no data', w: c.w[key], missing: true });

  const wsum = parts.reduce((t, x) => t + x.w, 0);
  const known = parts.filter((x) => !x.missing).reduce((t, x) => t + x.w, 0);
  const score = wsum ? Math.round((parts.reduce((t, x) => t + x.score * x.w, 0) / wsum) * 100) : 50;
  return { score, parts, fails, price: p, room, mins, coverage: wsum ? known / wsum : 0 };
}

export function evaluateAll(societies, c, meta) {
  const out = new Map();
  for (const s of societies) out.set(s.id, evaluate(s, c, meta));
  return out;
}

export function fmtINR(r) {
  if (r == null) return '-';
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1).replace(/\.0$/, '')} L`;
  return `₹${Math.round(r / 1000)}k`;
}

// URL state: JSON in the hash, base64 encoded.
export function encodeState(state) { return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }
export function decodeState(str) { try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch { return null; } }
