import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, DEFAULTS, commuteMinutes, fmtINR, encodeState, decodeState, priceFor } from './score.js';

const base = { id: 'a', n: 'A', l: 'Sector 1', x: 77.0, y: 28.4, k: 'apartment', st: 'ready', am: ['pool', 'gym'], ra: 4.5, rc: 20,
  nr: { rail: 400, park: 200 }, psf: 8000, un: [{ b: 3, sf: 1600, r: { s: 12, a: 150, q: 'read' } }],
  pr: { 3: { buy: [15000000, 0, 5], rent: [60000, 1, 0], psf: 8000 } } };
const ctx = { cityPsf: 10000, locPsf: {} };
const crit = (o = {}) => ({ ...DEFAULTS, ...o, w: { ...DEFAULTS.w, ...(o.w || {}) } });
const onlyValue = { budget: 0, room: 0, amenities: 0, near: 0, commute: 0, value: 3, quality: 0 };

test('over budget by more than 15% fails, within budget scores well', () => {
  assert.ok(evaluate(base, crit({ budget: 12000000 }), ctx).fails.includes('over budget'));
  const r = evaluate(base, crit({ budget: 20000000 }), ctx);
  assert.equal(r.fails.length, 0);
  assert.ok(r.score > 60);
});

test('unknown price never fails the budget', () => {
  assert.equal(evaluate({ ...base, pr: {} }, crit({ budget: 1000000 }), ctx).fails.length, 0);
});

test('a read bedroom under the minimum fails; an estimated one does not', () => {
  assert.ok(evaluate(base, crit({ minRoom: 13 }), ctx).fails.includes('small rooms'));
  const est = { ...base, un: [{ b: 3, sf: 1600, r: { s: 10, a: 100, q: 'est' } }] };
  assert.equal(evaluate(est, crit({ minRoom: 13 }), ctx).fails.length, 0);
});

test('a required amenity that is missing fails', () => {
  assert.ok(evaluate(base, crit({ amenities: ['squash'] }), ctx).fails.includes('no squash'));
  assert.equal(evaluate(base, crit({ amenities: ['pool'] }), ctx).fails.length, 0);
});

test('closer to work is faster, and a long commute fails', () => {
  const near = evaluate(base, crit({ work: [77.01, 28.41], maxCommute: 40 }), ctx);
  const far = evaluate(base, crit({ work: [77.3, 28.7], maxCommute: 40 }), ctx);
  assert.equal(near.fails.length, 0);
  assert.ok(far.fails.includes('long commute'));
  assert.ok(commuteMinutes(base, [77.01, 28.41]) < commuteMinutes(base, [77.1, 28.5]));
});

test('cheaper than the area median raises the value score', () => {
  const cheap = evaluate(base, crit({ w: onlyValue }), ctx);
  const dear = evaluate({ ...base, psf: 14000 }, crit({ w: onlyValue }), ctx);
  assert.ok(cheap.score > dear.score);
});

test('a society with data outranks one with gaps on the same priorities', () => {
  const c = crit({ budget: 20000000, minRoom: 11 });
  const known = evaluate(base, c, ctx);
  const gaps = evaluate({ ...base, pr: {}, un: [] }, c, ctx);
  assert.ok(known.score > gaps.score);
  assert.ok(gaps.coverage < known.coverage);
  assert.ok(gaps.parts.some((p) => p.missing));
});

test('priceFor picks the cheapest chosen BHK', () => {
  assert.equal(priceFor(base, 'buy', [3]).value, 15000000);
  assert.equal(priceFor(base, 'buy', [2]), null);
});

test('formatting and URL state round-trip', () => {
  assert.equal(fmtINR(25000000), '₹2.5 Cr');
  assert.equal(fmtINR(65000), '₹65k');
  const st = { bhk: [3], note: 'café' };
  assert.deepEqual(decodeState(encodeState(st)), st);
  assert.equal(decodeState('%%%'), null);
});
