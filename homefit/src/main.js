import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { AMENITIES, NEARBY, DEFAULTS, evaluateAll, fmtINR, encodeState, decodeState, commuteMinutes } from './score.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const store = {
  get: (k, d) => safe(() => JSON.parse(localStorage.getItem(k)) ?? d, d),
  set: (k, v) => safe(() => localStorage.setItem(k, JSON.stringify(v))),
};

const STYLES = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' };
const WEIGHT_LABELS = { budget: 'Price', room: 'Bedroom size', amenities: 'Amenities', near: 'Nearby places', commute: 'Commute', value: 'Value for money', quality: 'Resident ratings' };
const LEVELS = ['Ignore', 'Low', 'Medium', 'High'];

let data, byId = new Map(), c, results = new Map(), shown = [];
let sort = 'score', selected = null, picking = false, mapMode = store.get('hf-map', 'dark');
let shortlist = store.get('hf-short', []);
let map, workMarker;

const clone = (o) => JSON.parse(JSON.stringify(o));
const fresh = () => clone(DEFAULTS);

// ---------- boot ----------
async function boot() {
  c = fresh();
  const res = await fetch('/data/gurgaon.json');
  data = await res.json();
  for (const s of data.societies) byId.set(s.id, s);
  loadHash();
  buildControls();
  initMap();
  update();
}

function loadHash() {
  const m = location.hash.match(/s=([^&]+)/);
  const st = m && decodeState(m[1]);
  if (!st) return;
  c = { ...fresh(), ...st.c, w: { ...DEFAULTS.w, ...(st.c?.w || {}) } };
  if (st.sort) sort = st.sort;
  if (Array.isArray(st.short)) { shortlist = st.short.filter((id) => byId.has(id)); store.set('hf-short', shortlist); }
}
function saveHash() {
  const st = { c, sort, short: shortlist };
  history.replaceState(null, '', `#s=${encodeState(st)}`);
}

// ---------- controls ----------
function chips(el, items, isOn, onToggle) {
  el.innerHTML = '';
  for (const [key, label] of items) {
    const b = document.createElement('button');
    b.className = 'chip' + (isOn(key) ? ' on' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', isOn(key));
    b.onclick = () => { onToggle(key); b.classList.toggle('on', isOn(key)); b.setAttribute('aria-pressed', isOn(key)); update(); };
    el.append(b);
  }
}
const toggle = (arr, v) => { const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v); };

function budgetScale() { return c.mode === 'buy' ? { max: 150, step: 1, unit: 1e6 } : { max: 60, step: 1, unit: 5000 }; }

function buildControls() {
  chips($('f-bhk'), [1, 2, 3, 4, 5].map((n) => [n, `${n}`]), (k) => c.bhk.includes(k), (k) => toggle(c.bhk, k));
  chips($('f-kind'), [['apartment', 'Apartment'], ['builder floor', 'Builder floor'], ['villa', 'Villa'], ['plot', 'Plot']], (k) => c.kinds.includes(k), (k) => toggle(c.kinds, k));
  chips($('f-am'), Object.entries(AMENITIES), (k) => c.amenities.includes(k), (k) => toggle(c.amenities, k));
  chips($('f-near'), Object.entries(NEARBY).map(([k, v]) => [k, v.label]), (k) => c.near.includes(k), (k) => toggle(c.near, k));

  document.querySelectorAll('#mode button').forEach((b) => {
    b.onclick = () => { c.mode = b.dataset.v; c.budget = null; syncInputs(); update(); };
  });

  $('f-budget').oninput = (e) => { const v = +e.target.value; c.budget = v ? v * budgetScale().unit : null; update(); };
  $('f-min').oninput = (e) => { c.minSqft = +e.target.value || null; update(); };
  $('f-max').oninput = (e) => { c.maxSqft = +e.target.value || null; update(); };
  $('f-room').oninput = (e) => { c.minRoom = +e.target.value || null; update(); };
  $('f-ready').onchange = (e) => { c.ready = e.target.checked; update(); };
  $('f-commute').oninput = (e) => { c.maxCommute = +e.target.value || null; update(); };
  $('btn-clear-work').onclick = () => setWork(null);
  $('btn-work').onclick = () => { picking = !picking; document.body.classList.toggle('picking', picking); if (picking) { toast('Click the map to place your workplace'); document.body.dataset.tab = 'map'; syncTabs(); } };
  $('btn-reset').onclick = () => { c = fresh(); setWork(null, true); buildControls(); syncInputs(); update(); };
  $('btn-share').onclick = share;
  $('btn-short').onclick = () => toggleDrawer();
  $('btn-csv').onclick = exportCsv;
  $('btn-theme').onclick = () => { mapMode = mapMode === 'dark' ? 'light' : 'dark'; store.set('hf-map', mapMode); applyTheme(); map.setStyle(STYLES[mapMode]); };
  $('sort').onchange = (e) => { sort = e.target.value; update(); };

  const wbox = $('weights');
  wbox.innerHTML = '';
  for (const [k, label] of Object.entries(WEIGHT_LABELS)) {
    const row = document.createElement('label');
    row.className = 'weight';
    row.innerHTML = `<span>${label}</span><input type="range" min="0" max="3" step="1" value="${c.w[k]}" aria-label="${label} importance"><output>${LEVELS[c.w[k]]}</output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    inp.oninput = () => { c.w[k] = +inp.value; out.textContent = LEVELS[c.w[k]]; update(); };
    wbox.append(row);
  }

  document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { document.body.dataset.tab = b.dataset.t; syncTabs(); }; });
  buildSearch();
  syncInputs();
  applyTheme();
}

function syncTabs() { document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === document.body.dataset.tab)); }
function applyTheme() { document.documentElement.dataset.theme = mapMode; }

function syncInputs() {
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === c.mode));
  const sc = budgetScale(), f = $('f-budget');
  f.max = sc.max; f.step = sc.step; f.value = c.budget ? Math.round(c.budget / sc.unit) : 0;
  $('f-min').value = c.minSqft || ''; $('f-max').value = c.maxSqft || '';
  $('f-room').value = c.minRoom || 0; $('f-ready').checked = c.ready;
  $('f-commute').value = c.maxCommute || 0;
  $('sort').value = sort;
  chips($('f-bhk'), [1, 2, 3, 4, 5].map((n) => [n, `${n}`]), (k) => c.bhk.includes(k), (k) => toggle(c.bhk, k));
  chips($('f-kind'), [['apartment', 'Apartment'], ['builder floor', 'Builder floor'], ['villa', 'Villa'], ['plot', 'Plot']], (k) => c.kinds.includes(k), (k) => toggle(c.kinds, k));
  chips($('f-am'), Object.entries(AMENITIES), (k) => c.amenities.includes(k), (k) => toggle(c.amenities, k));
  chips($('f-near'), Object.entries(NEARBY).map(([k, v]) => [k, v.label]), (k) => c.near.includes(k), (k) => toggle(c.near, k));
}

function labels() {
  $('o-budget').textContent = c.budget ? `up to ${fmtINR(c.budget)}${c.mode === 'rent' ? '/mo' : ''}` : 'Any';
  $('o-size').textContent = c.minSqft || c.maxSqft ? `${c.minSqft || 0} to ${c.maxSqft || 'any'} sq ft` : 'Any';
  const gaj = c.minRoom ? ` (${Math.round(c.minRoom * 0.333 * 10) / 10} m)` : '';
  $('o-room').textContent = c.minRoom ? `at least ${c.minRoom} ft${gaj}` : 'Any';
  $('o-commute').textContent = c.maxCommute ? `${c.maxCommute} min` : 'Any';
  $('commute-box').hidden = !c.work;
  $('work-hint').hidden = !!c.work;
  $('btn-work').textContent = c.work ? 'Move workplace' : 'Set workplace';
  // commute weight is meaningless without a workplace
  document.querySelectorAll('.weight')[4]?.classList.toggle('dim', !c.work);
}

// ---------- search ----------
function buildSearch() {
  const q = $('q'), ol = $('q-results');
  q.oninput = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { ol.hidden = true; return; }
    const hits = data.societies.filter((s) => { const h = `${s.n} ${s.d} ${s.l}`.toLowerCase(); return words.every((w) => h.includes(w)); }).slice(0, 8);
    ol.innerHTML = hits.map((s) => `<li><button data-id="${s.id}"><b>${esc(s.n)}</b><span>${esc(s.l)}</span></button></li>`).join('') || '<li class="none">No match</li>';
    ol.hidden = false;
  };
  ol.onclick = (e) => { const b = e.target.closest('button'); if (b) { ol.hidden = true; q.value = ''; openCard(b.dataset.id, true); } };
  addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); q.focus(); }
    if (e.key === 'Escape') { picking = false; document.body.classList.remove('picking'); closeCard(); ol.hidden = true; $('drawer').hidden = true; }
  });
}

// ---------- map ----------
function colorExpr() {
  const light = mapMode === 'light';
  return ['interpolate', ['linear'], ['get', 'score'],
    0, light ? '#9aa3b2' : '#3b4a66', 40, light ? '#6c8ed6' : '#4f7fd0', 60, light ? '#e0a21b' : '#f0b84a', 80, light ? '#e8590c' : '#ffd98a', 100, light ? '#c92a2a' : '#fff4d6'];
}

function initMap() {
  map = new maplibregl.Map({ container: 'map', style: STYLES[mapMode], center: data.city.center, zoom: 11.2, attributionControl: { compact: true }, dragRotate: false });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('style.load', addLayers);
  map.on('click', (e) => {
    if (picking) { setWork([e.lngLat.lng, e.lngLat.lat]); picking = false; document.body.classList.remove('picking'); return; }
    const f = map.queryRenderedFeatures(e.point, { layers: ['dots', 'dots-out'] })[0];
    if (f) openCard(f.properties.id); else closeCard();
  });
  map.on('mousemove', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['dots'] });
    map.getCanvas().style.cursor = picking ? 'crosshair' : f.length ? 'pointer' : '';
  });
  if (c.work) placeWork();
}

function addLayers() {
  if (map.getSource('soc')) return;
  map.addSource('soc', { type: 'geojson', data: features() });
  map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const r = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 14, b, 17, b * 1.8];
  map.addLayer({ id: 'dots-out', type: 'circle', source: 'soc', filter: ['==', ['get', 'ok'], 0],
    paint: { 'circle-radius': r(1.5, 3), 'circle-color': mapMode === 'light' ? '#b8bcc4' : '#2a2d35', 'circle-opacity': 0.55 } });
  map.addLayer({ id: 'dots', type: 'circle', source: 'soc', filter: ['==', ['get', 'ok'], 1],
    layout: { 'circle-sort-key': ['get', 'score'] },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['+', 2, ['/', ['get', 'score'], 40]], 14, ['+', 5, ['/', ['get', 'score'], 12]], 17, 14],
      'circle-color': colorExpr(), 'circle-opacity': 0.92, 'circle-stroke-width': 0.8, 'circle-stroke-color': mapMode === 'light' ? '#fff' : '#0b0c10' } });
  map.addLayer({ id: 'dots-label', type: 'symbol', source: 'soc', minzoom: 14, filter: ['==', ['get', 'ok'], 1],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-optional': true },
    paint: { 'text-color': mapMode === 'light' ? '#222' : '#eee', 'text-halo-color': mapMode === 'light' ? '#fff' : '#000', 'text-halo-width': 1.2 } });
  map.addLayer({ id: 'sel-ring', type: 'circle', source: 'sel', paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#4dabf7' } });
  drawSelected();
}

function features() {
  return { type: 'FeatureCollection', features: data.societies.map((s) => {
    const r = results.get(s.id);
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [s.x, s.y] },
      properties: { id: s.id, name: s.n, score: r ? r.score : 0, ok: r && !r.fails.length ? 1 : 0 } };
  }) };
}

function drawSelected() {
  const src = map?.getSource('sel');
  if (!src) return;
  const s = selected && byId.get(selected);
  src.setData({ type: 'FeatureCollection', features: s ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.x, s.y] }, properties: {} }] : [] });
}

function placeWork() {
  if (workMarker) workMarker.remove();
  if (!c.work || !map) return;
  const el = document.createElement('div');
  el.className = 'work-pin'; el.title = 'Your workplace (drag to move)'; el.textContent = 'W';
  workMarker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(c.work).addTo(map);
  workMarker.on('dragend', () => { const p = workMarker.getLngLat(); c.work = [p.lng, p.lat]; update(); });
}
function setWork(pt, silent) {
  c.work = pt;
  if (!pt) { c.maxCommute = null; $('f-commute').value = 0; workMarker?.remove(); workMarker = null; }
  else { placeWork(); if (!c.maxCommute) { c.maxCommute = 45; $('f-commute').value = 45; } }
  if (!silent) update();
}

// ---------- update ----------
let raf = 0;
function update() {
  labels();
  results = evaluateAll(data.societies, c, data);
  const ok = data.societies.filter((s) => !results.get(s.id).fails.length);
  const key = {
    score: (s) => -results.get(s.id).score,
    price: (s) => results.get(s.id).price?.value ?? Infinity,
    commute: (s) => results.get(s.id).mins ?? Infinity,
    rating: (s) => -(s.ra || 0) * Math.min(1, 0.5 + s.rc / 10),
    value: (s) => (s.psf && (data.locPsf[s.l] || data.cityPsf) ? s.psf / (data.locPsf[s.l] || data.cityPsf) : Infinity),
  }[sort];
  shown = ok.sort((a, b) => key(a) - key(b) || a.n.localeCompare(b.n));
  $('res-n').textContent = shown.length.toLocaleString('en-IN');
  $('res-sub').textContent = `of ${data.societies.length.toLocaleString('en-IN')}`;
  renderList();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { map?.getSource('soc')?.setData(features()); });
  $('short-n').textContent = shortlist.length;
  saveHash();
  if (selected) renderCard(byId.get(selected));
  if (!$('drawer').hidden) renderDrawer();
}

function renderList() {
  const ol = $('list');
  if (!shown.length) { ol.innerHTML = '<li class="empty">Nothing fits all of these limits. Try a higher budget, a smaller bedroom or fewer must-haves.</li>'; return; }
  ol.innerHTML = shown.slice(0, 80).map((s) => {
    const r = results.get(s.id);
    const p = r.price;
    const price = p ? `${p.est ? '~' : ''}${fmtINR(p.value)}${c.mode === 'rent' ? '/mo' : ''} · ${p.bhk} BHK` : 'Price unknown';
    return `<li><button class="item${s.id === selected ? ' on' : ''}" data-id="${s.id}">
      <span class="sc" style="--s:${r.score}">${r.score}</span>
      <span class="tx"><b>${esc(s.n)}</b><small>${esc(s.l)} · ${price}${r.mins != null ? ` · ${r.mins} min` : ''}</small></span>
      ${shortlist.includes(s.id) ? '<span class="star">★</span>' : ''}</button></li>`;
  }).join('') + (shown.length > 80 ? `<li class="more">Showing the top 80. Narrow the filters to see the rest.</li>` : '');
}
$('list').addEventListener('click', (e) => { const b = e.target.closest('.item'); if (b) openCard(b.dataset.id, true); });

// ---------- card ----------
function openCard(id, fly) {
  selected = id;
  const s = byId.get(id);
  renderCard(s);
  $('card').hidden = false;
  drawSelected();
  if (fly) map.flyTo({ center: [s.x, s.y], zoom: Math.max(map.getZoom(), 14.5), duration: 900 });
  document.querySelectorAll('.item').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  if (innerWidth < 820) document.body.dataset.tab = 'map', syncTabs();
}
function closeCard() { selected = null; $('card').hidden = true; drawSelected(); document.querySelectorAll('.item.on').forEach((b) => b.classList.remove('on')); }

const QUALITY = { read: 'read from the plan', part: 'read from the plan (not every bedroom)', ai: 'read by a model, unverified', est: 'estimated from unit size' };
const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

function renderCard(s) {
  const r = results.get(s.id);
  const loc = data.locPsf[s.l] || data.cityPsf;
  const rows = Object.entries(s.pr).map(([b, p]) => `<tr><td>${b} BHK</td><td>${p.buy ? `${p.buy[1] ? '~' : ''}${fmtINR(p.buy[0])}` : '-'}</td><td>${p.rent ? `${p.rent[1] ? '~' : ''}${fmtINR(p.rent[0])}/mo` : '-'}</td><td>${p.psf ? `₹${p.psf.toLocaleString('en-IN')}` : '-'}</td></tr>`).join('');
  const units = s.un.filter((u) => u.b).slice(0, 12).map((u) => `<tr><td>${u.b} BHK</td><td>${u.sf ? `${u.sf.toLocaleString('en-IN')} sq ft` : '-'}</td><td>${u.r ? `${u.r.s.toFixed(1)} ft <small>${QUALITY[u.r.q]}</small>` : '<small>not checked</small>'}</td></tr>`).join('');
  const near = Object.entries(NEARBY).map(([k, v]) => (s.nr[k] != null ? `<li><span>${v.label}</span><b>${dist(s.nr[k])}</b></li>` : '')).join('');
  const parts = r.parts.map((p) => `<div class="part"><span>${WEIGHT_LABELS[p.key]}</span><i><u style="width:${Math.round(p.score * 100)}%"></u></i><small>${esc(p.note)}</small></div>`).join('');
  const fit = r.fails.length ? `<p class="warn">Does not fit: ${esc(r.fails.join(', '))}</p>` : '';
  const valueNote = s.psf && loc ? `<li><span>Price per sq ft</span><b>₹${s.psf.toLocaleString('en-IN')} <small>${s.psf < loc ? Math.round((1 - s.psf / loc) * 100) + '% below' : Math.round((s.psf / loc - 1) * 100) + '% above'} area median</small></b></li>` : '';
  $('card').innerHTML = `
    <button class="x" aria-label="Close" id="card-x">×</button>
    <div class="card-head"><div class="ring" style="--s:${r.score}"><b>${r.score}</b><small>fit</small></div>
      <div><h2>${esc(s.n)}</h2><p>${esc(s.d || '')}${s.d && s.l ? ' · ' : ''}${esc(s.l)}</p>
      <p class="muted">${s.k}${s.st === 'ready' ? ' · ready to move' : ' · under construction'}${s.po ? ` · ${esc(s.po)}` : ''}${s.u ? ` · ${s.u} homes` : ''}${s.v ? ' · <b class="ver">verified</b>' : ''}</p></div></div>
    ${fit}
    <h4>Why this score <small>${Math.round(r.coverage * 100)}% of the weight is backed by data</small></h4>${parts || '<p class="muted">Set a budget, bedroom size or workplace to see what drives the score.</p>'}
    <ul class="kv">${valueNote}${r.mins != null ? `<li><span>Drive to work</span><b>about ${r.mins} min <small>peak hour, estimate</small></b></li>` : ''}${s.ra ? `<li><span>Resident rating</span><b>${s.ra} / 5 <small>${s.rc} ratings</small></b></li>` : ''}${near}</ul>
    ${rows ? `<h4>Prices <small>~ means our estimate, not a live listing</small></h4><table><tr><th></th><th>Buy</th><th>Rent</th><th>Per sq ft</th></tr>${rows}</table>` : ''}
    ${units ? `<h4>Homes and bedrooms</h4><table><tr><th></th><th>Size</th><th>Smallest bedroom</th></tr>${units}</table>` : ''}
    ${s.am.length ? `<h4>Amenities</h4><div class="tags">${s.am.map((a) => `<span>${AMENITIES[a] || a}</span>`).join('')}</div>` : ''}
    <div class="card-actions"><button class="primary" id="card-short">${shortlist.includes(s.id) ? '★ In shortlist' : '☆ Add to shortlist'}</button>
      ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Listings</a>` : ''}${s.gm ? `<a href="${esc(s.gm)}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div>`;
  $('card-x').onclick = closeCard;
  $('card-short').onclick = () => { toggleShort(s.id); };
}

// ---------- shortlist ----------
function toggleShort(id) {
  const i = shortlist.indexOf(id);
  if (i >= 0) shortlist.splice(i, 1); else if (shortlist.length >= 6) return toast('Shortlist holds 6. Remove one first.'); else shortlist.push(id);
  store.set('hf-short', shortlist);
  update();
}
function toggleDrawer() { const d = $('drawer'); d.hidden = !d.hidden; if (!d.hidden) renderDrawer(); }

function renderDrawer() {
  const items = shortlist.map((id) => byId.get(id)).filter(Boolean);
  if (!items.length) { $('drawer').innerHTML = '<button class="x" id="dr-x" aria-label="Close">×</button><h2>Shortlist</h2><p class="muted">Open a society and press "Add to shortlist". You can compare up to 6 side by side.</p>'; $('dr-x').onclick = toggleDrawer; return; }
  const R = (s) => results.get(s.id);
  const rows = [
    ['Fit score', (s) => R(s).score, (v) => v, 1],
    [c.mode === 'buy' ? 'Buy price' : 'Rent', (s) => R(s).price?.value, (v, s) => `${R(s).price.est ? '~' : ''}${fmtINR(v)}`, -1],
    ['Per sq ft', (s) => s.psf, (v) => `₹${v.toLocaleString('en-IN')}`, -1],
    ['Smallest bedroom', (s) => R(s).room?.s, (v) => `${v.toFixed(1)} ft`, 1],
    ['Drive to work', (s) => R(s).mins, (v) => `${v} min`, -1],
    ['Rating', (s) => s.ra, (v) => v, 1],
    ['Metro or rail', (s) => s.nr.rail, (v) => dist(v), -1],
    ['Park', (s) => s.nr.park, (v) => dist(v), -1],
    ['Amenities', (s) => s.am.length, (v) => v, 1],
  ];
  const body = rows.map(([label, get, fmt, dir]) => {
    const vals = items.map(get);
    const known = vals.filter((v) => v != null);
    const best = known.length > 1 ? (dir > 0 ? Math.max(...known) : Math.min(...known)) : null;
    return `<tr><th>${label}</th>${items.map((s, i) => `<td class="${vals[i] != null && vals[i] === best ? 'best' : ''}">${vals[i] != null ? fmt(vals[i], s) : '-'}</td>`).join('')}</tr>`;
  }).join('');
  $('drawer').innerHTML = `<button class="x" id="dr-x" aria-label="Close">×</button><h2>Shortlist <small>${items.length} of 6</small></h2>
    <div class="scroll"><table class="cmp"><tr><th></th>${items.map((s) => `<th><button class="link" data-open="${s.id}">${esc(s.n)}</button><small>${esc(s.l)}</small><button class="rm" data-rm="${s.id}" aria-label="Remove ${esc(s.n)}">remove</button></th>`).join('')}</tr>${body}</table></div>
    <p class="muted">Green marks the best of the group. Estimated prices are marked ~.</p>`;
  $('dr-x').onclick = toggleDrawer;
  $('drawer').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openCard(b.dataset.open, true); });
  $('drawer').querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => toggleShort(b.dataset.rm); });
}

// ---------- share, export, toast ----------
async function share() {
  saveHash();
  const ok = await safe(async () => { await navigator.clipboard.writeText(location.href); return true; }, false);
  toast(ok ? 'Link copied. It holds your filters and shortlist.' : 'Copy the address bar. It holds your filters and shortlist.');
}
function exportCsv() {
  const head = ['name', 'developer', 'locality', 'fit_score', c.mode, 'price_is_estimate', 'bhk', 'smallest_bedroom_ft', 'commute_min', 'rating', 'price_per_sqft', 'lat', 'lng', 'url'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = shown.map((s) => { const r = results.get(s.id); return [s.n, s.d, s.l, r.score, r.price?.value, r.price?.est ? 'yes' : '', r.price?.bhk, r.room?.s, r.mins, s.ra, s.psf, s.y, s.x, s.url].map(q).join(','); });
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'homefit-results.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
let tt;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3200); }

boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="fatal">Could not load the data. ${esc(e.message)}</div>`); });
