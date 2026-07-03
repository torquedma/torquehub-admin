#!/usr/bin/env node
'use strict';

// Verifier for the AI Intake v2 fieldsets. Mirrors verify-usage-display.js.
// (a) Structural sanity of the source (all five fieldsets present; every field
//     has required props; ai_proposable:false rows carry an ai_review_flag).
// (b) Header + presence of each generated mirror.
// (c) Byte-parity of the DATA block between CJS and browser mirrors.
// (d) getFieldset dispatch coverage — hits every branch.
// Run: node scripts/verify-intake-fieldsets.js

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const SRC_JSON = path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.source.json');

let failures = 0;

// ── (a) Source structural sanity ──────────────────────────────────────────────
const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
const REQUIRED_FIELDSETS = ['truck', 'construction_equipment', 'farm', 'trailer', 'generic_minimal'];
const REQUIRED_FIELD_KEYS = ['key', 'label', 'question', 'type', 'requiredness', 'ai_proposable', 'storable'];

for (const name of REQUIRED_FIELDSETS) {
  if (!src.fieldsets || !src.fieldsets[name]) {
    console.error(`FAIL: source is missing fieldset "${name}"`);
    failures++;
  }
}
if (failures === 0) console.log(`OK: all ${REQUIRED_FIELDSETS.length} required fieldsets present`);

let fieldFailures = 0;
for (const [fsName, fsBody] of Object.entries(src.fieldsets || {})) {
  const allRows = [...(fsBody.fields || []), ...(fsBody.human_only || [])];
  for (const field of allRows) {
    for (const key of REQUIRED_FIELD_KEYS) {
      if (!(key in field)) {
        console.error(`FAIL: ${fsName}.${field.key || '(no key)'} missing required prop "${key}"`);
        fieldFailures++;
      }
    }
    if (field.ai_proposable === false && !field.ai_review_flag) {
      console.error(`FAIL: ${fsName}.${field.key} has ai_proposable:false but no ai_review_flag`);
      fieldFailures++;
    }
  }
}
if (fieldFailures === 0) console.log('OK: every field carries required props; every ai_proposable:false row carries ai_review_flag');
failures += fieldFailures;

// ── (b) Presence + header of generated mirrors ────────────────────────────────
const EXPECTED_HEADER = '// GENERATED FROM intake-fieldsets.source.json — DO NOT EDIT.';
const TARGETS = [
  { path: path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.generated.js'), label: 'admin CJS' },
  { path: path.join(ROOT, 'js/intake-fieldsets.browser.js'),                      label: 'admin browser' },
];
for (const t of TARGETS) {
  if (!fs.existsSync(t.path)) {
    console.error(`FAIL: missing ${t.label} at ${t.path}`);
    failures++;
    continue;
  }
  const first = fs.readFileSync(t.path, 'utf8').split('\n')[0];
  if (!first.startsWith(EXPECTED_HEADER)) {
    console.error(`FAIL: ${t.label} first line is not the GENERATED marker — hand-edited or stale?`);
    console.error(`      Got: ${first.slice(0, 120)}`);
    failures++;
  } else {
    console.log(`OK: ${t.label} present with generated header — ${t.path}`);
  }
}

// ── (c) Byte-parity of the DATA block between CJS and browser mirrors ────────
// Walk balanced braces so nested JSON objects don't confuse extraction.
function extractDataBlock(text) {
  const anchor = text.search(/(?:var|const)\s+DATA\s*=\s*\{/);
  if (anchor < 0) return null;
  const start = text.indexOf('{', anchor);
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}
const cjsText     = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.generated.js'), 'utf8');
const browserText = fs.readFileSync(path.join(ROOT, 'js/intake-fieldsets.browser.js'),                      'utf8');
const cjsData     = extractDataBlock(cjsText);
const browserData = extractDataBlock(browserText);
if (!cjsData || !browserData) {
  console.error('FAIL: could not extract DATA block from one or both mirrors');
  failures++;
} else if (cjsData !== browserData) {
  console.error('FAIL: CJS and browser DATA blocks differ — one was hand-edited or the generator drifted');
  failures++;
} else {
  console.log('OK: CJS and browser DATA blocks byte-identical');
}

// ── (d) getFieldset dispatch coverage against the CJS mirror ─────────────────
// Byte-parity above proves the browser mirror uses the same DATA + dispatch,
// so testing only the CJS path is sufficient.
const intake = require(path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.generated.js'));
function fsName(fs) {
  return Object.keys(intake.fieldsets).find(n => intake.fieldsets[n] === fs) || '(unknown)';
}
function assertFs(category, subcategory, expected, label) {
  const got = intake.getFieldset(category, subcategory);
  const gotName = fsName(got);
  if (gotName === expected) {
    console.log(`OK: getFieldset(${label}) = ${gotName}`);
  } else {
    console.error(`FAIL: getFieldset(${label}) = ${gotName}, expected ${expected}`);
    failures++;
  }
}
assertFs('Trucks',       'Sleeper Tractor',  'truck',                  'Trucks + Sleeper Tractor');
assertFs('Trailers',     'Enclosed Trailer', 'trailer',                'Trailers + Enclosed Trailer');
assertFs('Farm',         'Tractor',          'farm',                   'Farm + Tractor');
assertFs('Construction', 'Backhoe',          'construction_equipment', 'Construction + Backhoe');
assertFs('Construction', 'Crane Truck',      'truck',                  'Construction + Crane Truck');
assertFs('Zoo',          'Unicorn',          'generic_minimal',        'unknown category');
assertFs('',             '',                 'generic_minimal',        'empty category/subcategory');

// ── (e) category_subcategories map — structure, dedup, Farm/Side-by-Side ─────
const REQUIRED_CATEGORY_KEYS = ['Trucks', 'Trailers', 'Construction', 'Farm', 'Other'];
const catMap = src.category_subcategories || {};
for (const key of REQUIRED_CATEGORY_KEYS) {
  if (!Array.isArray(catMap[key])) {
    console.error(`FAIL: category_subcategories is missing key "${key}" (or value is not an array)`);
    failures++;
  }
}
const catKeys = Object.keys(catMap);
if (catKeys.length !== REQUIRED_CATEGORY_KEYS.length) {
  console.error(`FAIL: expected exactly ${REQUIRED_CATEGORY_KEYS.length} category keys, got ${catKeys.length}: ${JSON.stringify(catKeys)}`);
  failures++;
} else {
  console.log(`OK: category_subcategories has all ${REQUIRED_CATEGORY_KEYS.length} required category keys`);
}

// Flatten + dedup — every subcategory must appear exactly once across the map.
const flat = [];
for (const key of catKeys) {
  for (const sub of (catMap[key] || [])) flat.push({ sub, cat: key });
}
const seen = new Map();
let dupes = 0;
for (const { sub, cat } of flat) {
  if (seen.has(sub)) {
    console.error(`FAIL: duplicate subcategory "${sub}" — appears in both ${seen.get(sub)} and ${cat}`);
    failures++;
    dupes++;
  } else {
    seen.set(sub, cat);
  }
}
if (dupes === 0) {
  console.log(`OK: no duplicate subcategories across category_subcategories (total: ${flat.length}, unique: ${seen.size})`);
}

// Explicit Farm → Side by Side (post-usage-display reclassification lock)
const cjsExports = require(path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.generated.js'));
const farmSubs = cjsExports.getSubcategories('Farm');
if (farmSubs.includes('Side by Side')) {
  console.log("OK: getSubcategories('Farm') includes 'Side by Side'");
} else {
  console.error("FAIL: getSubcategories('Farm') does NOT include 'Side by Side'");
  failures++;
}

// getCategories parity
const catsFromApi = cjsExports.getCategories();
if (JSON.stringify(catsFromApi) === JSON.stringify(catKeys)) {
  console.log(`OK: getCategories() = ${JSON.stringify(catsFromApi)}`);
} else {
  console.error(`FAIL: getCategories() = ${JSON.stringify(catsFromApi)}, source map keys = ${JSON.stringify(catKeys)}`);
  failures++;
}

if (failures) {
  console.error(`\nverify-intake-fieldsets: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nverify-intake-fieldsets: OK');
