'use strict';

// present-case.js — presentation casing for ALL-CAPS dealer spec/feature lines.
//
// SCOPE (HGR DX 6A, Foreman GO 2026-09-18): this module changes LETTER CASE and
// nothing else. It exists so a source's typography (HGR's all-caps bullet
// lists) does not become Torque's presentation. It is applied at RENDER time to
// Stage 1b `displayLine`; `normalizedLine` is evidence and is never touched.
//
// INVARIANT (enforced at runtime, not assumed):
//   presentCase(line).toLowerCase() === line.toLowerCase()
// If any rule below — present or future — would change anything other than
// letter case, the guard returns the input unchanged. Fail closed.
//
// RULES (first match wins, per whitespace-separated token; whitespace preserved):
//   0. line is not all-caps (has a lowercase letter, or no letters) → unchanged
//   a. token has no letters → unchanged
//   b. token contains a digit → unchanged (ST205/75/R15, 3500LB, R17.5, 16P, VINs, (7)WAY)
//   c. alphabetic core in KEEP_UPPER → alphabetic core upper-cased (LED, GVWR, DOT, EZ, RV …)
//   d. lowercased token in STOP and not the first token → lowercase (with, on, the …)
//   e. alphabetic core of 1–2 letters, not a stopword → unchanged (X, W, D, unknown codes)
//   f. otherwise → Title Case; hyphenated parts each capitalized (HEAVY-DUTY → Heavy-Duty);
//      leading/trailing punctuation preserved ("(MORE" → "(More")
//
// KEEP_UPPER is derived from the receiver's existing KEEP_UPPER/MAKE_ACRONYMS
// sets (sync-truckpaper-background.js) plus common trailer spec units. It is a
// shared unit/acronym set, NOT an HGR list, and it is not required for
// correctness — only for readability. STOP is a fixed English small-word set.
// Neither set is to be grown per-dealer; if a token is mis-cased, the invariant
// still holds and the blemish is cosmetic.

const KEEP_UPPER = new Set([
  // receiver-derived (normalizeModel KEEP_UPPER / MAKE_ACRONYMS)
  'GMC', 'RAM', 'JCB', 'BMW', 'KTM', 'ASV', 'CAT', 'JLG', 'GM', 'PJ',
  'SD', 'NPR', 'NQR', 'NRR', 'FRR', 'FTR', 'FXR',
  'CXU', 'CHU', 'CXP', 'CHP', 'CXN',
  'DT', 'ISC', 'ISL', 'ISM', 'ISX',
  'HX', 'RD', 'RH', 'MR', 'MK',
  'PB', 'KW', 'FL', 'IH', 'IHC',
  'GVW', 'GVWR', 'DOT', 'EPA', 'EGR', 'DPF', 'DEF',
  'ACERT', 'MBE',
  'TT', 'BT', 'ST', 'MT', 'NT',
  'SLT', 'MV',
  // trailer spec units / acronyms observed in HGR & Wilson raws
  'GAWR', 'LED', 'RV', 'VIN', 'HD', 'EZ', 'PTO', 'HP', 'LT', 'LR',
  'ABS', 'AC', 'DC', 'USB', 'OEM', 'GPS', 'LB', 'LBS', 'PSI', 'RPM', 'CDL',
]);

const STOP = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
  'x', // dimension joiner: 7 X 14
]);

function isAllCaps(s) {
  return /[A-Za-z]/.test(s) && s === s.toUpperCase();
}

function caseToken(tok, isFirst) {
  if (!/[A-Za-z]/.test(tok)) return tok;                       // a
  if (/\d/.test(tok)) return tok;                              // b
  const m = tok.match(/^([^A-Za-z]*)([A-Za-z].*?)([^A-Za-z]*)$/);
  if (!m) return tok;
  const lead = m[1], body = m[2], tail = m[3];
  const alpha = body.replace(/[^A-Za-z]/g, '');
  if (KEEP_UPPER.has(alpha.toUpperCase())) return lead + body.toUpperCase() + tail;   // c
  const lower = body.toLowerCase();
  if (STOP.has(lower) && !isFirst) return lead + lower + tail;                         // d
  if (alpha.length <= 2) return tok;                                                   // e
  const tc = lower.split('-').map(p => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('-'); // f
  return lead + tc + tail;
}

function presentCase(line) {
  const s = String(line == null ? '' : line);
  if (!isAllCaps(s)) return s;                                 // 0
  let isFirst = true;
  const out = s.split(/(\s+)/).map(part => {
    if (part === '' || /^\s+$/.test(part)) return part;
    const r = caseToken(part, isFirst);
    isFirst = false;
    return r;
  }).join('');
  // INVARIANT GUARD — fail closed.
  return out.toLowerCase() === s.toLowerCase() ? out : s;
}

module.exports = { presentCase, isAllCaps, KEEP_UPPER, STOP };
