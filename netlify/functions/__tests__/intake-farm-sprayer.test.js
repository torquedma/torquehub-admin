'use strict';
// intake-farm-sprayer.test.js — Owner 2026-09-30: Sprayer is a canonical Farm leaf; ADMIN intake offers it under Farm.
// Run: node --test netlify/functions/__tests__/intake-farm-sprayer.test.js
// Loads the REAL generated ADMIN mirrors. No network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');

const intake = require('../lib/intake-fieldsets.generated.js');
const { canonicalize } = require('../lib/taxonomy.generated.js');
const usage = require('../lib/usage-display.generated.js');

test('I1: intake offers Sprayer under Farm, and in no other category', () => {
  assert.ok(intake.getSubcategories('Farm').includes('Sprayer'));
  for (const cat of intake.getCategories().filter(c => c !== 'Farm')) {
    assert.ok(!intake.getSubcategories(cat).includes('Sprayer'), cat);
  }
});

test('I2: Farm + Sprayer dispatches to the farm fieldset', () => {
  assert.equal(intake.getFieldset('Farm', 'Sprayer'), intake.fieldsets.farm);
});

test('I3: ADMIN taxonomy and usage-display mirrors know Sprayer (canonical; mileage and hours suppressed)', () => {
  assert.equal(canonicalize('Sprayer'), 'Sprayer');
  const u = { subcategory: 'Sprayer', mileage: '12,000', hours: '850' };
  assert.equal(usage.isKnownSuppressMileage(u), true);
  assert.equal(usage.isKnownSuppressHours(u), true);
});
