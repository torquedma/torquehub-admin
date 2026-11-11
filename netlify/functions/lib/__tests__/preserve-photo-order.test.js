'use strict';
// preserve-photo-order.test.js - HST -324 (from Fresh Tech -400 helper cases). Offline, synthetic.
// Run: node --test netlify/functions/lib/__tests__/preserve-photo-order.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { preserveCuratedPhotoOrder } = require('../preserve-photo-order');

const U = n => 'https://cdnmedia.endeavorsuite.com/images/x/inventory/14709802/DSCN' + n + '.JPG';
const P = (n, extra) => Object.assign({ url: U(n), name: 'DSCN' + n + '.JPG' }, extra || {});
const order = a => a.map(p => p.name.slice(4, 8)).join(',');
const FEED = [4177, 4173, 4175, 4174, 4176, 4178, 4180, 4181, 4179];
const CURATED = [4173, 4175, 4174, 4176, 4180, 4181, 4178, 4179, 4177];

test('PO-1: VF115817 - unchanged feed set keeps the curated order', () => {
  assert.equal(order(preserveCuratedPhotoOrder(CURATED.map(n => P(n)), FEED.map(n => P(n)))), CURATED.join(','));
});
test('PO-2: dealer drops 4179 and adds 4190 - removed photo gone, new photo appended', () => {
  const feed = FEED.filter(n => n !== 4179).concat([4190]).map(n => P(n));
  assert.equal(order(preserveCuratedPhotoOrder(CURATED.map(n => P(n)), feed)), '4173,4175,4174,4176,4180,4181,4178,4177,4190');
});
test('PO-3: no overlap - feed order unchanged', () => {
  const feed = [5001, 5002].map(n => P(n));
  assert.equal(preserveCuratedPhotoOrder(CURATED.map(n => P(n)), feed), feed);
});
test('PO-4: empty or missing stored gallery, or empty feed - feed returned as is', () => {
  const feed = FEED.map(n => P(n));
  assert.equal(preserveCuratedPhotoOrder([], feed), feed);
  assert.equal(preserveCuratedPhotoOrder(null, feed), feed);
  assert.deepEqual(preserveCuratedPhotoOrder(CURATED.map(n => P(n)), []), []);
});
test('PO-5: duplicate or keyless feed entries - feed order unchanged', () => {
  const dup = FEED.map(n => P(n)).concat([P(4177)]);
  assert.equal(preserveCuratedPhotoOrder(CURATED.map(n => P(n)), dup), dup);
  const keyless = FEED.map(n => P(n)).concat([{ name: 'x.JPG' }]);
  assert.equal(preserveCuratedPhotoOrder(CURATED.map(n => P(n)), keyless), keyless);
});
test('PO-6: the feed objects (fresh metadata) are returned, never the stored ones', () => {
  const out = preserveCuratedPhotoOrder(CURATED.map(n => P(n, { stale: true })), FEED.map(n => P(n, { fresh: true })));
  assert.ok(out.every(p => p.fresh === true && p.stale === undefined));
  assert.equal(out.length, FEED.length);
});
test('PO-7: duplicates in the stored gallery do not duplicate photos; membership equals the feed', () => {
  const stored = [4173, 4173, 4175].map(n => P(n));
  const out = preserveCuratedPhotoOrder(stored, FEED.map(n => P(n)));
  assert.equal(out.length, FEED.length);
  assert.deepEqual(new Set(out.map(p => p.url)), new Set(FEED.map(n => U(n))));
  assert.equal(order(out).slice(0, 9), '4173,4175');
});
