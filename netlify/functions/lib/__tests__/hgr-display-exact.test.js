'use strict';
// hgr-display-exact.test.js — regression fixtures for the Chief-governed HGR
// presentation exceptions in trailer-spec-normalizer.js (HGR_DISPLAY_EXACT).
// Run: node --test netlify/functions/lib/__tests__/hgr-display-exact.test.js
//
// Contract under test:
//   1. The two governed source forms produce their governed display forms.
//   2. normalizedLine (evidence) is byte-identical to the source-derived line.
//   3. Matching is EXACT: near-variants keep today's presentCase output.
//   4. Everything else is unchanged (presentCase still applies).

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTrailerSpecs } = require('../trailer-spec-normalizer');
const { presentCase } = require('../present-case');

// A realistic HGR-delimited body (same shape as live HGR listings).
function hgr(lines) {
  return 'TRAILERS FOR EVERYTHING AND EVERYTHING FOR TRAILERS\n\n' + lines.map(l => '-' + l).join('\n\n');
}
function kdFor(raw, normalizedLine) {
  const n = normalizeTrailerSpecs(raw, 'Trailers');
  assert.ok(n, 'normalizer returned a payload');
  assert.equal(n.format, 'hgr_delimited');
  return n.keyDetails.find(k => k.normalizedLine === normalizedLine);
}

const BODY = [
  'BLACK PAINTED STEEL CONSTRUCTION',
  '3500LB EZ LUBE LEAF SPRING AXLES WITH BRAKES ON ALL WHEELS WITH BREAKAWAY',
  '(4)5000LB DRINGS',
  'LED LIGHTING',
  '(7)WAY PLUG',
];

test('governed: (7)WAY PLUG → 7-Way Plug; normalizedLine untouched', () => {
  const k = kdFor(hgr(BODY), '(7)WAY PLUG');
  assert.ok(k, 'key detail present');
  assert.equal(k.normalizedLine, '(7)WAY PLUG');
  assert.equal(k.displayLine, '7-Way Plug');
});

test('governed: (4)5000LB DRINGS → (4) 5,000 LB D-Rings; normalizedLine untouched', () => {
  const k = kdFor(hgr(BODY), '(4)5000LB DRINGS');
  assert.ok(k, 'key detail present');
  assert.equal(k.normalizedLine, '(4)5000LB DRINGS');
  assert.equal(k.displayLine, '(4) 5,000 LB D-Rings');
});

test('exact match only: near-variants keep presentCase output unchanged', () => {
  const variants = [
    '(4)WAY PLUG',
    '(7)WAY PLUG WITH INSULATED WIRING RUN THROUGH GROMMETS WELDED TO THE FRAME(NO HOLES BURNED IN THE FRAME)',
    '(8)5000LB RECESSED DRINGS',
    '(4)5000LB RECESSED DRINGS',
    '(2)WIRE AND BRACE FOR FUTURE AIR CONDITIONING',
    '(3)ROWS OF DECK SCREWS',
  ];
  const raw = hgr(variants);
  for (const v of variants) {
    const k = kdFor(raw, v);
    assert.ok(k, `key detail present for ${v}`);
    assert.equal(k.normalizedLine, v);
    assert.equal(k.displayLine, presentCase(v), `variant must be unchanged: ${v}`);
  }
});

test('unaffected lines in the same body are exactly presentCase(normalizedLine)', () => {
  const n = normalizeTrailerSpecs(hgr(BODY), 'Trailers');
  for (const k of n.keyDetails) {
    if (k.normalizedLine === '(7)WAY PLUG' || k.normalizedLine === '(4)5000LB DRINGS') continue;
    assert.equal(k.displayLine, presentCase(k.normalizedLine), k.normalizedLine);
  }
});

test('non-Trailers category is still gated out (null), unchanged', () => {
  assert.equal(normalizeTrailerSpecs(hgr(BODY), 'Trucks'), null);
});
