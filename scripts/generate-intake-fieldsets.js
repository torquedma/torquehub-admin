#!/usr/bin/env node
'use strict';

// Generator for the AI Intake v2 fieldsets. Mirrors generate-usage-display.js
// precisely: reads a JSON source, emits CJS + browser IIFE mirrors. Admin-only —
// both consumers (intake.html and analyze-photos.js) live here.
// Run: node scripts/generate-intake-fieldsets.js
// Verify: node scripts/verify-intake-fieldsets.js

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const SRC_JSON = path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.source.json');

const SOURCE = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));

const HEADER = '// GENERATED FROM intake-fieldsets.source.json — DO NOT EDIT. Run node scripts/generate-intake-fieldsets.js\n';

// Emit the entire source object as a JS literal via JSON.stringify. Byte-identical
// between CJS and browser variants — the verifier byte-compares this DATA block.
const DATA_JSON = JSON.stringify(SOURCE, null, 2);

// ── (a) CommonJS module for Netlify functions (analyze-photos.js) ────────────
function buildCJS() {
  return `${HEADER}'use strict';

// Dispatch imports usageClass from the already-generated usage-display CJS
// mirror. Do NOT hand-maintain a second construction-equipment list; usageClass
// composes the answer from ALLOW_HOURS / ALLOW_MILEAGE / SUPPRESS_BOTH.
const { usageClass } = require('./usage-display.generated.js');

const DATA = ${DATA_JSON};

const fieldsets = DATA.fieldsets;
const shared_human_review = DATA.shared_human_review;
const subcategory_overrides = DATA.subcategory_overrides || {};
const category_subcategories = DATA.category_subcategories || {};

// Dispatch on (category, subcategory). Category matches are case-insensitive
// against the taxonomy's canonical category names (Trucks / Trailers / Farm /
// Construction). Construction is split by usageClass into the hours-based-
// equipment fieldset vs the road-truck fieldset (crane trucks, boom trucks).
function getFieldset(category, subcategory) {
  const cat = String(category || '').toLowerCase().trim();
  const sub = String(subcategory || '').trim();

  // Per-subcategory override — kept for rare exceptions without inventing a new fieldset.
  if (subcategory_overrides[sub] && fieldsets[subcategory_overrides[sub]]) {
    return fieldsets[subcategory_overrides[sub]];
  }

  if (cat === 'trucks')   return fieldsets.truck;
  if (cat === 'trailers') return fieldsets.trailer;
  if (cat === 'farm')     return fieldsets.farm;
  if (cat === 'construction') {
    const cls = usageClass({ subcategory: sub });
    if (cls === 'hours-based') return fieldsets.construction_equipment;
    if (cls === 'odometer')    return fieldsets.truck;
    return fieldsets.generic_minimal;
  }
  return fieldsets.generic_minimal;
}

// Intake's authored category → subcategory grouping (NOT derived from taxonomy,
// NOT from usage-display). Drives the intake dropdown pair. Return copies so
// callers can't mutate the underlying arrays.
function getCategories() {
  return Object.keys(category_subcategories);
}
function getSubcategories(category) {
  const list = category_subcategories[category];
  return Array.isArray(list) ? list.slice() : [];
}

module.exports = { getFieldset, getCategories, getSubcategories, fieldsets, shared_human_review, category_subcategories };
`;
}

// ── (b) Browser IIFE for intake.html ─────────────────────────────────────────
// Namespaced as window.IntakeFieldsets. MUST be loaded AFTER
// js/usage-display.browser.js (dispatch depends on window.UsageDisplay.usageClass
// for the Construction split).
function buildBrowser() {
  return `${HEADER}// Load AFTER js/usage-display.browser.js — depends on window.UsageDisplay.usageClass
// for the Construction category split.
// Exposes window.IntakeFieldsets (namespaced — no bare globals).

(function (root) {
  var DATA = ${DATA_JSON};

  var fieldsets = DATA.fieldsets;
  var shared_human_review = DATA.shared_human_review;
  var subcategory_overrides = DATA.subcategory_overrides || {};
  var category_subcategories = DATA.category_subcategories || {};

  function getFieldset(category, subcategory) {
    var cat = String(category || '').toLowerCase().trim();
    var sub = String(subcategory || '').trim();

    if (subcategory_overrides[sub] && fieldsets[subcategory_overrides[sub]]) {
      return fieldsets[subcategory_overrides[sub]];
    }

    if (cat === 'trucks')   return fieldsets.truck;
    if (cat === 'trailers') return fieldsets.trailer;
    if (cat === 'farm')     return fieldsets.farm;
    if (cat === 'construction') {
      var usageClass = (root.UsageDisplay && root.UsageDisplay.usageClass) || null;
      if (!usageClass) {
        console.error('[intake-fieldsets] window.UsageDisplay.usageClass missing — load js/usage-display.browser.js BEFORE js/intake-fieldsets.browser.js');
        return fieldsets.generic_minimal;
      }
      var cls = usageClass({ subcategory: sub });
      if (cls === 'hours-based') return fieldsets.construction_equipment;
      if (cls === 'odometer')    return fieldsets.truck;
      return fieldsets.generic_minimal;
    }
    return fieldsets.generic_minimal;
  }

  // Intake's authored category → subcategory grouping. See CJS mirror for rationale.
  function getCategories() {
    return Object.keys(category_subcategories);
  }
  function getSubcategories(category) {
    var list = category_subcategories[category];
    return (list && list.slice) ? list.slice() : [];
  }

  root.IntakeFieldsets = {
    getFieldset: getFieldset,
    getCategories: getCategories,
    getSubcategories: getSubcategories,
    fieldsets: fieldsets,
    shared_human_review: shared_human_review,
    category_subcategories: category_subcategories
  };
}(typeof window !== 'undefined' ? window : this));
`;
}

const cjsContent     = buildCJS();
const browserContent = buildBrowser();

const TARGETS = [
  {
    path: path.join(ROOT, 'netlify/functions/lib/intake-fieldsets.generated.js'),
    content: cjsContent,
    label: 'admin CJS',
  },
  {
    path: path.join(ROOT, 'js/intake-fieldsets.browser.js'),
    content: browserContent,
    label: 'admin browser',
  },
];

for (const t of TARGETS) {
  fs.mkdirSync(path.dirname(t.path), { recursive: true });
  fs.writeFileSync(t.path, t.content, 'utf8');
  console.log(`Wrote [${t.label}]: ${t.path}`);
}

console.log('\nDone.');
