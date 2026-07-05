'use strict';
const { stampFacts, buildClaim, compatibleValues } = require('./provenance');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log('\n--- compatibleValues (deterministic, not fuzzy) ---');
check('Detroit ⊂ Detroit DD13 -> compatible', compatibleValues('Detroit', 'Detroit DD13') === true);
check('Detroit DD13 ⊃ Detroit -> compatible', compatibleValues('Detroit DD13', 'Detroit') === true);
check('exact match -> compatible', compatibleValues('Cat C10', 'cat c10') === true);
check('Cat vs Detroit -> NOT compatible', compatibleValues('Cat', 'Detroit DD13') === false);
check('blank vs value -> NOT compatible', compatibleValues('', 'Detroit') === false);

console.log('\n--- Case 1: no existing provenance -> incoming becomes primary ---');
{
  const r = stampFacts(null, { engine: 'Detroit', mileage: '101292' },
    { source: 'truckpaper_apify', trust: 'attributed' });
  check('engine primary set', r.engine.value === 'Detroit' && r.engine.trust === 'attributed' && r.engine.source === 'truckpaper_apify');
  check('mileage primary set', r.mileage.value === '101292' && r.mileage.trust === 'attributed');
  check('as_of stamped', /^\d{4}-\d{2}-\d{2}$/.test(r.engine.as_of));
}

console.log('\n--- Case 2a: higher trust, COMPATIBLE value -> clean win, NO claim ---');
{
  const existing = { engine: { value: 'Detroit', source: 'truckpaper_apify', trust: 'attributed', as_of: '2026-07-01' } };
  const r = stampFacts(existing, { engine: 'Detroit DD13' }, { source: 'vin_decode', trust: 'verified' });
  check('engine now verified primary', r.engine.trust === 'verified' && r.engine.value === 'Detroit DD13');
  check('no claim created (mere refinement)', r.engine.claims === undefined);
  check('input not mutated', existing.engine.value === 'Detroit' && existing.engine.trust === 'attributed');
}

console.log('\n--- Case 2b: higher trust, DIFFERENT value -> primary flips, old preserved as claim ---');
{
  const existing = { engine: { value: 'Cat', source: 'truckpaper_apify', trust: 'attributed', as_of: '2026-07-01' } };
  const r = stampFacts(existing, { engine: 'Detroit DD13' }, { source: 'vin_decode', trust: 'verified' });
  check('engine verified primary = Detroit DD13', r.engine.trust === 'verified' && r.engine.value === 'Detroit DD13');
  check('feed value preserved as claim', Array.isArray(r.engine.claims) && r.engine.claims.length === 1);
  check('claim carries old value + source', r.engine.claims[0].value === 'Cat' && r.engine.claims[0].source === 'truckpaper_apify');
  check('claim relation contextualizes', r.engine.claims[0].relation === 'contextualizes');
  check('disagreement NOT silently erased', r.engine.claims[0].trust === 'attributed');
}

console.log('\n--- Case 3a: lower/equal trust, fill-empty, compatible -> keep existing, no-op ---');
{
  const existing = { engine: { value: 'Detroit DD13', source: 'vin_decode', trust: 'verified', as_of: '2026-07-01' } };
  const r = stampFacts(existing, { engine: 'Detroit' }, { source: 'truckpaper_apify', trust: 'attributed', mode: 'fill-empty' });
  check('verified primary NOT downgraded', r.engine.trust === 'verified' && r.engine.value === 'Detroit DD13');
  check('no spurious claim (compatible)', r.engine.claims === undefined);
}

console.log('\n--- Case 3b: lower trust, fill-empty, DIFFERENT value -> keep verified, record claim ---');
{
  const existing = { engine: { value: 'Detroit DD13', source: 'vin_decode', trust: 'verified', as_of: '2026-07-01' } };
  const r = stampFacts(existing, { engine: 'Cat' }, { source: 'truckpaper_apify', trust: 'attributed', mode: 'fill-empty' });
  check('verified primary held', r.engine.trust === 'verified' && r.engine.value === 'Detroit DD13');
  check('conflicting feed value recorded as claim', Array.isArray(r.engine.claims) && r.engine.claims[0].value === 'Cat');
}

console.log('\n--- Case 3c: EQUAL trust + overwrite mode (admin re-edits human_admin field) ---');
{
  const existing = { model: { value: 'F735', source: 'human_admin', trust: 'attributed', as_of: '2026-07-01' } };
  const r = stampFacts(existing, { model: 'F735 Front Mower' },
    { source: 'human_admin', trust: 'attributed', actor: 'ryan@torquedma.com', mode: 'overwrite' });
  check('value overwritten', r.model.value === 'F735 Front Mower');
  check('actor recorded in notes', Array.isArray(r.model.notes) && r.model.notes[0].includes('ryan@torquedma.com'));
}

console.log('\n--- Blank values are never stamped (true absence, not a claim) ---');
{
  const r = stampFacts(null, { engine: 'Detroit', mileage: '', hours: null, trim: '   ' },
    { source: 'seller', trust: 'attributed' });
  check('engine stamped', !!r.engine);
  check('blank mileage omitted', r.mileage === undefined);
  check('null hours omitted', r.hours === undefined);
  check('whitespace trim omitted', r.trim === undefined);
}

console.log('\n--- Validation: invalid trust/source/mode rejected ---');
{
  let threw = false;
  try { stampFacts(null, { x: '1' }, { source: 'seller', trust: 'observed' }); } catch { threw = true; }
  check('rejects removed "observed" trust', threw);
  threw = false;
  try { stampFacts(null, { x: '1' }, { source: 'made_up', trust: 'attributed' }); } catch { threw = true; }
  check('rejects invalid source', threw);
  threw = false;
  try { stampFacts(null, { x: '1' }, { source: 'seller', trust: 'attributed', mode: 'nuke' }); } catch { threw = true; }
  check('rejects invalid mode', threw);
}

console.log('\n--- No client-forged trust: client cannot smuggle verified (server sets trust arg) ---');
{
  // The helper only ever uses opts.trust — which server code sets. A "value" that happens to be an
  // object with trust:'verified' is still just a string value; it cannot promote itself.
  const r = stampFacts(null, { engine: 'Detroit' }, { source: 'seller', trust: 'attributed' });
  check('seller-sourced engine stays attributed', r.engine.trust === 'attributed');
}

console.log('\n--- dx-background scenario: verified only on ACTUALLY-FILLED fields (Q3) ---');
{
  // Existing feed row: engine attributed, fuel attributed.
  const existing = {
    engine: { value: 'Detroit', source: 'truckpaper_apify', trust: 'attributed', as_of: '2026-07-01' },
    fuel:   { value: 'Diesel',  source: 'truckpaper_apify', trust: 'attributed', as_of: '2026-07-01' },
  };
  // decodeVin filled ONLY engine this run (fuel was already present, drivetrain not returned).
  const filled = { engine: 'Detroit DD13' };
  const r = stampFacts(existing, filled, { source: 'vin_decode', trust: 'verified', mode: 'fill-empty' });
  check('engine promoted to verified (filled this run)', r.engine.trust === 'verified');
  check('fuel stays attributed (NOT touched by decode)', r.fuel.trust === 'attributed');
  check('no drivetrain fabricated', r.drivetrain === undefined);
}

console.log('\n--- buildClaim: explicit dispute/stated-unknown/estimate (census shapes) ---');
{
  const dispute = buildClaim({ value: 'unreliable', source: 'seller', trust: 'attributed',
    relation: 'disputes', note: 'Seller states the odometer is not accurate.' });
  check('dispute claim valid', dispute.relation === 'disputes' && dispute.value === 'unreliable');
  const est = buildClaim({ value: '250000', source: 'seller', trust: 'attributed', relation: 'estimates_actual' });
  check('estimate claim valid', est.relation === 'estimates_actual');
  let threw = false;
  try { buildClaim({ value: 'x', source: 'seller', trust: 'attributed', relation: 'invents' }); } catch { threw = true; }
  check('rejects invalid relation', threw);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
