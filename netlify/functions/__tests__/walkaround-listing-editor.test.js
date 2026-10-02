'use strict';
// walkaround-listing-editor.test.js — the listing edit modal edits the live Walkaround (Owner requirement
// 2026-10-01; Chief recut ruling 2026-10-01). Key Details + Overview = inventory.description (Save & Close);
// Torque Take / Buyer Checklist / footer = inventory.buyer_intelligence, written ONLY by save_walkaround —
// one column, guarded by the value the modal loaded. Save & Close stays BI-blind. No review-queue row.
// Run: node --test netlify/functions/__tests__/walkaround-listing-editor.test.js
// No network, no database: the REAL admin-read / admin-write handlers run against an in-memory PostgREST
// fake holding a REAL inventory row, and the REAL client functions are evaluated from index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';
const ROOT = path.join(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const between = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); assert.ok(i >= 0 && j > i, 'markers missing: ' + a); return html.slice(i, j); };
const clone = o => JSON.parse(JSON.stringify(o));
const plain = o => (o === undefined ? o : JSON.parse(JSON.stringify(o)));   // vm objects → this realm
const quietly = async (fn) => { const q = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = q; } };

// ---------- client functions (shipped code) ----------
const ui = {};
vm.runInNewContext(between('// WA-MODAL-START', '// WA-MODAL-END') +
  '\n;Object.assign(this.out, { waModalEditable, waModalFields, waModalBuild, waModalProblem, waModalDecision, waModalDirty, waModalFailureMessage, waModalJsonEqual });', { out: ui });
const contract = {};
vm.runInNewContext(between('// WA-CONTRACT-START', '// WA-CONTRACT-END') + '\n;Object.assign(this.out, { waModernPreview });', { out: contract });

// ---------- live data (Supabase, read-only, 2026-10-01) ----------
// LIVE = buyer_intelligence byte-equal to the live rows (jsonb md5). ATC-436780 / JOE-093006 / JOE-093008 are
// direct-published with no queue row; JOE-011402 carries title + older decision_factors keys.
// ROW = the full ATC-436780 inventory row (photos omitted): blank trim, "$22,750" price, a provenance object.
const LIVE = {
  "ATC-436780": {
    "version": "1.4",
    "torque_take": [
      "The CDL requirement is the first fit question for this truck. If your operation has the driver coverage for a 33,000 lb GVWR truck, the remaining decision is condition—especially whether the liftgate works properly, the box is structurally sound, and the chassis runs and shifts cleanly."
    ],
    "buyer_question": "Does this CDL truck fit your operation, and do the liftgate, box and chassis check out mechanically?",
    "decision_factors": {
      "makes_it_a_yes": [
        "Confirm the CDL requirement fits your operation.",
        "Run the Maxon liftgate through its full raise, lower, and fold/stow cycle; watch for drift or slow travel, and check the cylinders, hoses and platform hinges for leaks, cracks or excessive play.",
        "Measure the box against the seller's listed 26 ft, and check the floor boards and translucent roof panels for soft spots, cracks or water staining.",
        "Start it cold and road-test it, confirming the transmission shifts cleanly, the air system builds pressure and the brakes apply evenly; before closing the deal, match VIN 3HAMMMMN1JL436780 on the truck to the title."
      ],
      "makes_it_a_yes_footer": "If the CDL requirement fits your operation and the liftgate, box and chassis all check out, you've covered the main decision points on this truck."
    },
    "uncertainty_type": "condition"
  },
  "JOE-011402": {
    "title": "Torque Take",
    "version": "1.4",
    "torque_take": [
      "The 544G has been a popular loader for decades because it's simple, capable, and still well-supported. On a machine this age, condition matters more than the hour meter.",
      "If the drivetrain feels strong and the hydraulics respond well, there can still be a lot of useful work left in one of these."
    ],
    "decision_factors": {
      "yes_label": "Buy signals",
      "walk_label": "Walk away if",
      "makes_it_a_yes": [
        "Tight center articulation joint",
        "Strong-shifting transmission",
        "Hydraulics that respond and hold",
        "Decent tires"
      ],
      "makes_it_a_walk": [
        "Slop in the center pivot, weak or slow hydraulics, drivetrain that hesitates, or a seller who won't let you look it over. Any one of those, walk or push hard on price."
      ],
      "makes_it_a_yes_footer": "If those check out, this can be a lot of loader for the money."
    }
  },
  "JOE-093006": {
    "version": "1.4",
    "torque_take": [
      "Because the listing is New, the first question is whether the machine's meter and basic functions are consistent with that condition. The rebate changes the purchase price; it does not replace checking that the controls, drive and deflector work as labeled."
    ],
    "buyer_question": "Are the meter reading and basic operation consistent with this Z3002's New condition listing?",
    "decision_factors": {
      "makes_it_a_yes": [
        "Read the hour meter and confirm the reading is consistent with the seller's New condition listing.",
        "Start it and move the deflector joystick through OPEN left, right, down and CLOSE ALL, confirming the deflector reaches each position.",
        "Drive it forward, reverse and through turns with both levers, and confirm the parking brake holds."
      ]
    },
    "uncertainty_type": "condition"
  },
  "JOE-093008": {
    "version": "1.4",
    "torque_take": [
      "The sale price is clear; the condition check still has to stand on its own. For a machine listed New, the important verification is that the hour reading is consistent with that listing and that the tine controls raise, lower and build pressure as labeled."
    ],
    "buyer_question": "Do the tine controls operate as labeled, and is the meter reading consistent with the New condition listing?",
    "decision_factors": {
      "makes_it_a_yes": [
        "Start it, lower the tines with the tine position switch, adjust the tine pressure control and watch the gauge respond across its range, then raise the tines and confirm they lift fully clear.",
        "Read the hour meter and confirm the reading is consistent with the seller's New condition listing."
      ]
    },
    "uncertainty_type": "condition"
  }
};
const ROW = {"id": "b16bab82-431f-47ae-b5bb-d36877d12c24", "vin": "3HAMMMMN1JL436780", "days": "", "fuel": "Diesel", "make": "International", "sold": false, "trim": "", "year": "2018", "hours": null, "model": "DuraStar 4300", "notes": "", "price": "$22,750", "stock": "ATC-436780", "dealer": "Auto Connection 210 LLC", "engine": "6.7L Cummins B6.7 Diesel", "status": "published", "mileage": "215726", "sold_at": null, "sold_to": null, "category": "Trucks", "featured": 0, "condition": "Used", "dx_locked": false, "sold_date": null, "sold_type": null, "video_url": "", "body_class": null, "created_at": "2026-10-01T14:22:03.625905+00:00", "drivetrain": "4x2", "gvwr_class": null, "horsepower": null, "provenance": {"condition": {"as_of": "2026-10-01", "notes": ["Set by ryan.davis@torquedma.com."], "trust": "attributed", "value": "Used", "source": "human_admin"}}, "sale_price": null, "sold_price": null, "source_url": null, "updated_at": "2026-10-01T15:59:04.802182+00:00", "vin_locked": false, "description": "Key Details\n- Year: 2018\n- Make: International\n- Model: DuraStar 4300\n- Engine: 6.7L Cummins B6.7 Diesel\n- Drivetrain: 4x2\n- Brakes: Air\n- GVWR: 33,000 lb\n- CDL: Required\n- GAWR: 12,000 lb front / 21,000 lb rear\n- Mileage: 215,726\n- Box Length: 26 ft (listed by the seller)\n- Box: Roll-up rear door, wood floor, logistics track on both walls\n- Liftgate: Maxon\n- Camera: Dash-mounted monitor\n- VIN: 3HAMMMMN1JL436780\n- Condition: Used\n- Stock #: ATC-436780\n\nOverview\n2018 International DuraStar 4300 4x2 with the 6.7L Cummins diesel, air brakes and a 33,000 lb GVWR, showing 215,726 miles. At 33,000 lb GVWR, this truck requires a CDL. It carries a box the seller lists at 26 ft, with a roll-up rear door, wood floor, logistics track on both walls and a Maxon liftgate; a camera monitor is mounted on the dash. The liftgate platform surface is worn and the front cap of the box is stained.", "first_photo": "https://bxsikkmqasydosmblzov.supabase.co/storage/v1/object/public/vehicle-photos/auto-connection-210-llc/ATC-436780/mupmhs5v-3gugrv.jpg", "photo_count": 18, "prod_status": null, "public_sold": false, "source_type": null, "subcategory": "Box Truck", "location_zip": null, "model_locked": false, "search_pills": null, "transmission": "", "contact_phone": null, "location_city": null, "photos_backup": null, "torque_hub_dx": null, "location_state": null, "sold_marked_at": null, "vin_decoded_at": null, "raw_description": null, "completion_state": null, "contact_location": null, "completion_reason": null, "source_listing_id": null, "buyer_intelligence": {"version": "1.4", "torque_take": ["The CDL requirement is the first fit question for this truck. If your operation has the driver coverage for a 33,000 lb GVWR truck, the remaining decision is condition—especially whether the liftgate works properly, the box is structurally sound, and the chassis runs and shifts cleanly."], "buyer_question": "Does this CDL truck fit your operation, and do the liftgate, box and chassis check out mechanically?", "decision_factors": {"makes_it_a_yes": ["Confirm the CDL requirement fits your operation.", "Run the Maxon liftgate through its full raise, lower, and fold/stow cycle; watch for drift or slow travel, and check the cylinders, hoses and platform hinges for leaks, cracks or excessive play.", "Measure the box against the seller's listed 26 ft, and check the floor boards and translucent roof panels for soft spots, cracks or water staining.", "Start it cold and road-test it, confirming the transmission shifts cleanly, the air system builds pressure and the brakes apply evenly; before closing the deal, match VIN 3HAMMMMN1JL436780 on the truck to the title."], "makes_it_a_yes_footer": "If the CDL requirement fits your operation and the liftgate, box and chassis all check out, you've covered the main decision points on this truck."}, "uncertainty_type": "condition"}, "description_source": null, "engine_description": "", "subcategory_locked": true, "completion_attempts": 0, "tracking_identity_id": null, "completion_attempted_at": null, "description_generated_at": null, "transmission_description": ""};
const NULL_ID = '7e59ccb9-710a-45ff-b165-89f47b5b563d';   // ATC-6780 (draft): buyer_intelligence = NULL

const fields = bi => plain(ui.waModalFields(clone(bi)));
function edit(bi, mutate) { const base = fields(bi); const cur = clone(base); if (mutate) mutate(cur); return plain(ui.waModalBuild(clone(bi), base, cur)); }
const loaded = (bi, key = 'K') => ({ state: 'LOADED', key, live: clone(bi), base: fields(bi) });
const decide = (m, key, cur) => plain(ui.waModalDecision(m, key, cur));

// ---------- in-memory PostgREST (stateful): eq filters incl. jsonb equality, select, return=representation ----------
function makeDb(rows) {
  const db = { rows: clone(rows), calls: [], writes: [] };
  const val = (row, k, v) => {
    if (row[k] !== null && typeof row[k] === 'object') { let p; try { p = JSON.parse(v); } catch (e) { return false; } return plain(ui.waModalJsonEqual(row[k], p)); }
    return row[k] != null && String(row[k]) === v;
  };
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => clone(json), text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return res({ email: 'ryan@example.com' });
    db.calls.push({ method, url, body: opts.body, prefer: (opts.headers && opts.headers.Prefer) || '' });
    const m = url.match(/\/rest\/v1\/([a-z_]+)\?(.*)$/);
    if (!m || m[1] !== 'inventory') return res([]);
    let select = null; const filters = [];
    for (const part of m[2].split('&')) {
      const i = part.indexOf('='); const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === 'select') { select = v.split(','); continue; }
      const d = v.indexOf('.'); filters.push([k, v.slice(0, d), decodeURIComponent(v.slice(d + 1))]);
    }
    const hit = db.rows.filter(r => filters.every(([k, op, v]) => op === 'eq' && val(r, k, v)));
    const proj = r => (select ? Object.fromEntries(select.map(c => [c, r[c]])) : r);
    if (method === 'GET') return res(hit.map(proj));
    if (method === 'PATCH') {
      const body = JSON.parse(opts.body); db.writes.push({ url, body, matched: hit.length });
      for (const r of hit) Object.assign(r, clone(body));
      return res(/return=representation/.test(opts.headers.Prefer || '') ? hit.map(proj) : null);
    }
    return res({ error: 'unexpected' }, 500);
  };
  return db;
}
async function server(file, operation, data) {
  delete require.cache[require.resolve(file)];
  const { handler } = require(file);
  const r = await quietly(() => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation, data }) }));
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const READ = '../admin-read.js', WRITE = '../admin-write.js';
const saveWA = (bi, expected, id = ROW.id) => server(WRITE, 'save_walkaround', { id, buyer_intelligence: bi, buyer_intelligence_expected: expected });
const withBI = bi => Object.assign(clone(ROW), { buyer_intelligence: clone(bi) });
const nonBI = r => { const c = clone(r); delete c.buyer_intelligence; return c; };

// ===== READ: per-open targeted read, direct-published units, no queue (proof 8) =====
for (const stock of ['ATC-436780', 'JOE-093006', 'JOE-093008']) {
  test(`P8 ${stock}: get_inventory_walkaround returns the live payload; one inventory read; no queue`, async () => {
    const db = makeDb([withBI(LIVE[stock])]);
    const r = await server(READ, 'get_inventory_walkaround', { id: ROW.id });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { found: true, id: ROW.id, buyer_intelligence: LIVE[stock] });
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].url, /\/rest\/v1\/inventory\?id=eq\.[0-9a-f-]{36}&select=id,buyer_intelligence$/);
    assert.equal(ui.waModalEditable(r.body.buyer_intelligence), true);
  });
}
test('P8 read fails closed: non-UUID → 400; a row without the column → 502; no row → found:false', async () => {
  makeDb([]);
  assert.equal((await server(READ, 'get_inventory_walkaround', { id: 'ATC-436780' })).status, 400);
  global.fetch = async (u) => ({ ok: true, status: 200, json: async () => (u.includes('/auth/') ? { email: 'ryan@example.com' } : [{ id: ROW.id }]), text: async () => '' });
  assert.equal((await server(READ, 'get_inventory_walkaround', { id: ROW.id })).status, 502);
  makeDb([]);
  assert.deepEqual((await server(READ, 'get_inventory_walkaround', { id: ROW.id })).body, { found: false, id: ROW.id });
});
test('P8 the paged list read is unchanged: buyer_intelligence is not in INVENTORY_ADMIN_SELECT', () => {
  const src = fs.readFileSync(require.resolve(READ), 'utf8');
  const i = src.indexOf('const INVENTORY_ADMIN_SELECT');
  assert.ok(!src.slice(i, src.indexOf("].join(',');", i)).includes('buyer_intelligence'));
});

// ===== SAVE WALKAROUND: one column, guarded (proofs 1–4, 6, 10) =====
test('P1 Save Walkaround PATCH: body is exactly { buyer_intelligence }; URL targets id + the loaded value only', async () => {
  const db = makeDb([clone(ROW)]);
  const r1 = edit(LIVE['ATC-436780'], f => { f.items[0] = 'Confirm the CDL requirement fits your drivers.'; });
  // A client that also sends listing fields cannot get them written: the handler builds the body itself.
  const r = await server(WRITE, 'save_walkaround', { id: ROW.id, buyer_intelligence: r1.bi, buyer_intelligence_expected: LIVE['ATC-436780'],
    trim: 'Box Truck', price: '22750', provenance: {}, vin_locked: true, description: 'x', photos: [], filterStock: ROW.stock, dealer: ROW.dealer });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.writes.length, 1);
  assert.deepEqual(Object.keys(db.writes[0].body), ['buyer_intelligence']);
  assert.deepEqual(db.writes[0].body.buyer_intelligence, r1.bi);
  assert.equal(db.writes[0].url, `https://bxsikkmqasydosmblzov.supabase.co/rest/v1/inventory?id=eq.${ROW.id}`
    + `&buyer_intelligence=eq.${encodeURIComponent(JSON.stringify(LIVE['ATC-436780']))}&select=id,buyer_intelligence`);
  assert.equal(db.calls.length, 1, 'no extra read (no provenance fetch)');
  assert.deepEqual(r.body, { ok: true, id: ROW.id, buyer_intelligence: r1.bi });
});
test('P2–P4 full real row: after Save Walkaround ONLY buyer_intelligence differs — trim, price, provenance, VIN lock, photos fields untouched', async () => {
  const db = makeDb([clone(ROW)]);
  const r1 = edit(LIVE['ATC-436780'], f => { f.paras[0] += ' Edited.'; f.items.push('Added check.'); f.footer = 'Edited footer.'; });
  assert.equal((await saveWA(r1.bi, LIVE['ATC-436780'])).status, 200);
  const after = db.rows[0];
  assert.deepEqual(nonBI(after), nonBI(ROW));
  assert.equal(after.trim, '');                    // P2: blank trim stays blank (no subcategory echo)
  assert.equal(after.price, '$22,750');            // P3: price text untouched
  assert.deepEqual(after.provenance, ROW.provenance); // P4: provenance not re-stamped
  assert.equal(after.photo_count, ROW.photo_count);
  assert.deepEqual(after.buyer_intelligence, r1.bi);
});
test('P10 conflict: a stale loaded value matches no row → 409, zero writes, row unchanged', async () => {
  const newer = edit(LIVE['ATC-436780'], f => { f.footer = 'Published elsewhere meanwhile.'; }).bi;
  const db = makeDb([withBI(newer)]);
  const mine = edit(LIVE['ATC-436780'], f => { f.items.push('My edit.'); }).bi;
  const r = await saveWA(mine, LIVE['ATC-436780']);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'walkaround_changed');
  assert.equal(db.rows[0].buyer_intelligence.decision_factors.makes_it_a_yes_footer, 'Published elsewhere meanwhile.');
  assert.equal(db.writes.length, 1, 'one guarded PATCH was attempted');
  assert.equal(db.writes[0].matched, 0, 'the guard matched zero rows: nothing written');
  assert.deepEqual(db.rows[0], withBI(newer));
  assert.match(plain(ui.waModalFailureMessage(409, JSON.stringify(r.body))), /^Walkaround not saved\. Nothing was written\.\nIt changed after you opened/);
});
test('P6 NULL Walkaround cannot be created or cleared', async () => {
  const db = makeDb([Object.assign(withBI(LIVE['JOE-093006']), { id: NULL_ID, buyer_intelligence: null })]);
  const r = await server(READ, 'get_inventory_walkaround', { id: NULL_ID });
  assert.deepEqual(r.body, { found: true, id: NULL_ID, buyer_intelligence: null });
  assert.equal(ui.waModalEditable(null), false);
  // Creation attempt with expected=null: refused before any database call.
  db.calls.length = 0;
  let s = await saveWA(LIVE['JOE-093006'], null, NULL_ID);
  assert.deepEqual([s.status, s.body.error], [400, 'walkaround_create_not_supported']);
  assert.equal(db.calls.length, 0);
  // Creation attempt disguised with a non-null expected: the guard never matches a NULL row.
  s = await saveWA(LIVE['JOE-093006'], LIVE['JOE-093006'], NULL_ID);
  assert.equal(s.status, 409);
  assert.equal(db.writes[db.writes.length - 1].matched, 0);
  assert.equal(db.rows[0].buyer_intelligence, null);
  // Clearing: refused before any database call.
  const db2 = makeDb([clone(ROW)]);
  s = await saveWA(null, LIVE['ATC-436780']);
  assert.deepEqual([s.status, s.body.error], [400, 'walkaround_clear_not_supported']);
  assert.equal(db2.calls.length, 0);
  assert.deepEqual(db2.rows[0], ROW);
});
for (const [name, start, mutate, n] of [
  ['zero checks', 'ATC-436780', c => { c.items = []; }, 0],
  ['one check', 'JOE-093008', c => { c.items = c.items.slice(0, 1); }, 1],
  ['two checks, edited text', 'JOE-093008', c => { c.items[1] = 'Read the hour meter and note the reading.'; }, 2],
  ['six checks', 'ATC-436780', c => { c.items.push('Check five.', 'Check six.'); }, 6],
]) {
  test(`No checklist quota — ${name}: built, accepted, written`, async () => {
    const r = edit(LIVE[start], mutate);
    assert.equal(r.changed, true);
    assert.equal(r.bi.decision_factors.makes_it_a_yes.length, n);
    const db = makeDb([withBI(LIVE[start])]);
    const s = await saveWA(r.bi, LIVE[start]);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.deepEqual(db.rows[0].buyer_intelligence, r.bi);
  });
}
for (const [name, tt, re] of [
  ['no paragraphs', [], /1 to 3 paragraphs/],
  ['four paragraphs', ['a.', 'b.', 'c.', 'd.'], /1 to 3 paragraphs/],
  ['blank paragraph', ['Real.', '  '], /torque_take\[1\] is not a real paragraph/],
  ['placeholder paragraph', ['(unused placeholder)'], /torque_take\[0\] is not a real paragraph/],
]) {
  test(`Invalid Torque Take (${name}) → 400 before any database call`, async () => {
    const db = makeDb([clone(ROW)]);
    const bi = clone(LIVE['ATC-436780']); bi.torque_take = tt;
    const s = await saveWA(bi, LIVE['ATC-436780']);
    assert.deepEqual([s.status, s.body.error], [400, 'walkaround_invalid']);
    assert.ok(s.body.details.some(d => re.test(d)), JSON.stringify(s.body.details));
    assert.equal(db.calls.length, 0);
  });
}
test('Footer without checks is rejected by the server before any database call', async () => {
  const db = makeDb([clone(ROW)]);
  const bi = clone(LIVE['ATC-436780']); bi.decision_factors.makes_it_a_yes = [];
  const s = await saveWA(bi, LIVE['ATC-436780']);
  assert.equal(s.status, 400);
  assert.ok(s.body.details.some(d => /requires at least one checklist item/.test(d)));
  assert.equal(db.calls.length, 0);
});
test('save_walkaround rejects a non-UUID id before any database call', async () => {
  const db = makeDb([clone(ROW)]);
  assert.equal((await saveWA(LIVE['ATC-436780'], LIVE['ATC-436780'], 'ATC-436780')).status, 400);
  assert.equal(db.calls.length, 0);
});

// ===== SAVE & CLOSE stays BI-blind (proof 5) =====
test('P5 update_inventory (Save & Close) never writes buyer_intelligence, even if a client sends it', async () => {
  const db = makeDb([clone(ROW)]);
  const s = await server(WRITE, 'update_inventory', { filterStock: ROW.stock, dealer: ROW.dealer, make: ROW.make,
    buyer_intelligence: edit(LIVE['ATC-436780'], f => { f.items = []; }).bi, buyer_intelligence_expected: LIVE['ATC-436780'] });
  assert.equal(s.status, 200);
  const patch = db.writes.find(w => 'make' in w.body);
  assert.ok(patch);
  assert.ok(!('buyer_intelligence' in patch.body) && !('buyer_intelligence_expected' in patch.body));
  assert.ok(!patch.url.includes('buyer_intelligence'));
  assert.deepEqual(db.rows[0].buyer_intelligence, LIVE['ATC-436780']);
});
test('P5 source: buyer_intelligence is not in INVENTORY_UPDATE_FIELDS and the Save & Close body never names it', () => {
  const w = fs.readFileSync(require.resolve(WRITE), 'utf8');
  const i = w.indexOf('const INVENTORY_UPDATE_FIELDS');
  assert.ok(!w.slice(i, w.indexOf('];', i)).includes('buyer_intelligence'));
  const j = html.indexOf('async function saveListingEdits()');
  assert.ok(!html.slice(j, html.indexOf('\nfunction filterNoPhotos', j)).includes('buyer_intelligence'));
  const k = html.indexOf('async function waModalSaveWalkaround()');
  const body = html.slice(k, html.indexOf('\n}\n', k));
  assert.ok(body.includes("JSON.stringify({ operation: 'save_walkaround', data: { id: u.id, buyer_intelligence: d.bi, buyer_intelligence_expected: d.expected } })"));
  assert.equal((body.match(/operation:/g) || []).length, 1);
});

// ===== CLIENT: form ↔ live object (proof 9 and the editor contract) =====
test('Torque Take paragraphs hydrate in order (live 2-paragraph JOE-011402; derived 3-paragraph)', () => {
  assert.deepEqual(fields(LIVE['JOE-011402']).paras, LIVE['JOE-011402'].torque_take);
  const three = clone(LIVE['JOE-011402']); three.torque_take.push('Third.');
  assert.deepEqual(fields(three).paras, three.torque_take);
});
test('Add, remove and reorder change exactly the buyer-facing list, in the shown order', () => {
  const [a, b, c, d] = LIVE['ATC-436780'].decision_factors.makes_it_a_yes;
  assert.deepEqual(edit(LIVE['ATC-436780'], f => { f.items.push('New.'); }).bi.decision_factors.makes_it_a_yes, [a, b, c, d, 'New.']);
  assert.deepEqual(edit(LIVE['ATC-436780'], f => { f.items.splice(1, 1); }).bi.decision_factors.makes_it_a_yes, [a, c, d]);
  assert.deepEqual(edit(LIVE['ATC-436780'], f => { [f.items[0], f.items[1]] = [f.items[1], f.items[0]]; }).bi.decision_factors.makes_it_a_yes, [b, a, c, d]);
});
test('Footer: loads; edits save; clearing removes it; adding one to a no-footer unit adds it', () => {
  assert.equal(fields(LIVE['ATC-436780']).footer, LIVE['ATC-436780'].decision_factors.makes_it_a_yes_footer);
  assert.equal(edit(LIVE['ATC-436780'], f => { f.footer = 'New.'; }).bi.decision_factors.makes_it_a_yes_footer, 'New.');
  assert.ok(!('makes_it_a_yes_footer' in edit(LIVE['ATC-436780'], f => { f.footer = '  '; }).bi.decision_factors));
  assert.equal(edit(LIVE['JOE-093006'], f => { f.footer = 'Added.'; }).bi.decision_factors.makes_it_a_yes_footer, 'Added.');
});
test('Footer: emptying the checklist drops it even if footer text remains', () => {
  const r = edit(LIVE['ATC-436780'], f => { f.items = ['  ', '']; });
  assert.deepEqual(r.bi.decision_factors.makes_it_a_yes, []);
  assert.ok(!('makes_it_a_yes_footer' in r.bi.decision_factors));
});
test('Footer: an untouched footer is kept exactly (never re-trimmed or dropped) when only checks change', () => {
  for (const footer of ['  Padded footer.  ', null]) {
    const live = clone(LIVE['ATC-436780']); live.decision_factors.makes_it_a_yes_footer = footer;
    assert.equal(edit(live).changed, false);
    assert.equal(edit(live, f => { f.items.push('Extra.'); }).bi.decision_factors.makes_it_a_yes_footer, footer);
  }
});
for (const stock of ['ATC-436780', 'JOE-093006', 'JOE-093008', 'JOE-011402']) {
  test(`P9 ${stock}: every key outside the three edited parts stays byte-identical`, () => {
    const live = LIVE[stock];
    const r = edit(live, f => { f.paras[0] += ' Edited.'; f.items.push('Added.'); f.footer = 'Edited footer.'; });
    const strip = o => { const c = clone(o); delete c.torque_take; delete c.decision_factors.makes_it_a_yes; delete c.decision_factors.makes_it_a_yes_footer; return c; };
    assert.equal(JSON.stringify(strip(r.bi)), JSON.stringify(strip(live)));
    for (const k of ['buyer_question', 'uncertainty_type', 'version', 'title']) {
      assert.equal(k in r.bi, k in live, k);
      if (k in live) assert.equal(r.bi[k], live[k], k);
    }
  });
}
test('P9 JOE-011402 keeps title and its older checklist keys (makes_it_a_walk, walk_label, yes_label)', () => {
  const r = edit(LIVE['JOE-011402'], f => { f.items[3] = 'Decent tires with even wear'; });
  for (const k of ['makes_it_a_walk', 'walk_label', 'yes_label']) assert.deepEqual(r.bi.decision_factors[k], LIVE['JOE-011402'].decision_factors[k]);
  assert.equal(r.bi.title, 'Torque Take');
});
test('Blank checks are dropped; edited text is trimmed', () => {
  const r = edit(LIVE['JOE-093006'], f => { f.items = ['  First.  ', '', '   ', 'Second.']; });
  assert.deepEqual(r.bi.decision_factors.makes_it_a_yes, ['First.', 'Second.']);
});
test('Client blocks a Torque Take with no text before anything is sent', () => {
  const d = decide(loaded(LIVE['ATC-436780']), 'K', { ...fields(LIVE['ATC-436780']), paras: ['   '] });
  assert.equal(d.send, false);
  assert.match(d.error, /needs at least one paragraph/);
});
test('Client sends nothing unless LOADED for THIS listing and changed; dirty tracks the same rule', () => {
  const live = LIVE['ATC-436780'];
  const changed = fields(live); changed.footer = 'Changed.';
  for (const state of ['NONE', 'LOADING', 'FAILED', 'UNSUPPORTED']) {
    assert.deepEqual(decide({ ...loaded(live), state }, 'K', changed), { send: false }, state);
    assert.equal(ui.waModalDirty({ ...loaded(live), state }, changed), false, state);
  }
  assert.deepEqual(decide(loaded(live, 'OTHER'), 'K', changed), { send: false });
  assert.deepEqual(decide(loaded(live), 'K', fields(live)), { send: false });
  assert.equal(ui.waModalDirty(loaded(live), fields(live)), false);
  assert.equal(ui.waModalDirty(loaded(live), changed), true);
  const d = decide(loaded(live), 'K', changed);
  assert.equal(d.send, true);
  assert.deepEqual(d.expected, live);
});
test('Edited Walkaround renders as buyers see it (ADMIN mirror of SITE buildBuyerIntelligenceCards)', () => {
  const r = edit(LIVE['ATC-436780'], f => { f.paras.push('A second paragraph.'); f.items = [f.items[1], 'New check.']; f.footer = 'Edited footer.'; });
  const out = contract.waModernPreview(r.bi, { description: '' });
  assert.ok(out.includes('A second paragraph.') && out.includes('Edited footer.'));
  assert.ok(out.indexOf('Run the Maxon liftgate') < out.indexOf('New check.'));
  assert.ok(!contract.waModernPreview(edit(LIVE['ATC-436780'], f => { f.items = []; }).bi, { description: '' }).includes('Buyer Checklist'));
});
for (const stock of Object.keys(LIVE)) {
  test(`Round trip ${stock}: live payload → form → no edit → identical object, nothing to save`, () => {
    const r = edit(LIVE[stock]);
    assert.equal(r.changed, false);
    assert.equal(JSON.stringify(r.bi), JSON.stringify(LIVE[stock]));
  });
}
