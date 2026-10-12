'use strict';
// condition-adjudication-admin.test.js — BIQ DATA FIRST amendment (Chief 2026-10-11).
// provenance.condition.adjudication is created and released ONLY by governed, Owner-authorized SQL. An ordinary
// Admin save can neither CREATE it nor silently DESTROY it:
//   - Save & Close on a marked row with the same (or blank) condition writes the other fields; the condition object,
//     marker included, is byte-stable.
//   - A different condition is refused (409 condition_adjudicated) and NOTHING is written.
//   - If the row's provenance cannot be read, a save carrying condition is refused (503) instead of written unguarded.
//   - Key presence decides (Chief final review 2026-10-11): an explicit adjudication: null is a MALFORMED marker and is
//     held like any other; a fact with no adjudication key is ordinary.
//   - The PATCH asserts exactly one affected row, and maps the database guard's refusal (PT409) to a clear 409.
//     The read→write interleavings themselves run against a real Postgres 17.6 + PostgREST 12.2.3 in the Site Tech
//     harness banked with the amendment record (harness/concurrency.test.js), not in this in-memory fake.
//   - The editor shows the Condition select read-only on a marked row and alerts on a refusal (client functions are
//     the REAL ones, evaluated from index.html).
// Runs the REAL admin-write handler against an in-memory PostgREST fake. No network, no database.
// Row shapes are production shapes (MPX-230981 golf cart, 2026-10-11 read). Markers carry SYNTHETIC TEST values.
// Run: node --test netlify/functions/__tests__/condition-adjudication-admin.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';
const clone = (x) => JSON.parse(JSON.stringify(x));
const quietly = async (fn) => {
  const q = [console.log, console.warn, console.error]; const warns = [];
  console.log = console.error = () => {}; console.warn = (...a) => warns.push(a.join(' '));
  try { return Object.assign(await fn(), { warns }); } finally { [console.log, console.warn, console.error] = q; }
};

function makeDb(tables, { failGet = false, patchError = null } = {}) {
  const db = { tables: clone(tables), writes: [] };
  const match = (row, filters) => filters.every(([k, op, v]) => op === 'eq' && row[k] != null && String(row[k]) === v);
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return res({ email: 'ryan@example.com' });
    const m = url.match(/\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/);
    if (!m) return res({ error: 'unexpected url ' + url }, 500);
    const [, table, qs = ''] = m; const filters = [];
    for (const part of qs.split('&').filter(Boolean)) {
      const i = part.indexOf('='); const k = part.slice(0, i), val = part.slice(i + 1);
      if (k === 'select') continue;
      const d = val.indexOf('.'); filters.push([k, val.slice(0, d), decodeURIComponent(val.slice(d + 1))]);
    }
    const rows = (db.tables[table] || []).filter((r) => match(r, filters));
    if (method === 'GET') return failGet ? res({ message: 'upstream unavailable' }, 500) : res(clone(rows));
    if (method === 'PATCH') {
      const body = JSON.parse(opts.body); db.writes.push({ method, table, body, prefer: (opts.headers && opts.headers.Prefer) || '' });
      if (patchError) return res(patchError.body, patchError.status);
      for (const r of rows) Object.assign(r, clone(body));
      // As PostgREST: Prefer return=representation answers with the affected rows, projected to ?select=.
      if (/return=representation/.test((opts.headers && opts.headers.Prefer) || '')) {
        const sel = (qs.split('&').find((x) => x.startsWith('select=')) || 'select=*').slice(7).split(',');
        return res(rows.map((r) => (sel[0] === '*' ? clone(r) : Object.fromEntries(sel.map((c) => [c, r[c] === undefined ? null : r[c]])))));
      }
      return res(null);
    }
    if (method === 'POST') {
      const body = JSON.parse(opts.body); db.writes.push({ method, table, body });
      for (const r of body) (db.tables[table] = db.tables[table] || []).push(Object.assign({ id: 'new-1' }, clone(r)));
      return res(body.map((r) => Object.assign({ id: 'new-1' }, r)));
    }
    return res({ error: 'unexpected method' }, 500);
  };
  return db;
}
async function callServer(operation, data) {
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const r = await quietly(() => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation, data }) }));
  return { status: r.statusCode, body: JSON.parse(r.body), warns: r.warns };
}

// ---------- fixtures ----------
const IMPEX = 'Impex Heavy Metal';
const MARKER = { v: 1, value: 'New', authority: 'owner', authorized_by: 'TEST-ONLY', authorized_on: '1970-01-01',
  basis: 'owner_confirmation', evidence: [{ kind: 'test', ref: 'TEST-ONLY' }], ruling: 'TEST-ONLY',
  recorded_by: 'governed_sql', recorded_at: '1970-01-01T00:00:00Z' };
const GOLF_NOW = { as_of: '2026-10-01', notes: ['Owner confirmed this golf cart is a new unit.'], trust: 'attributed', value: 'New',
  claims: [{ note: 'Source sandhills_direct reported Used.', trust: 'attributed', value: 'Used', source: 'sandhills_direct', relation: 'contextualizes' }],
  source: 'human_admin' };
const GOLF_MARKED = Object.assign(clone(GOLF_NOW), { adjudication: clone(MARKER) });
const golf = (cond) => ({ stock: 'MPX-230981', dealer: IMPEX, condition: 'New', price: '12000', engine: '', vin: 'LQ202501718',
  provenance: { condition: clone(cond), vin: { as_of: '2026-10-01', trust: 'attributed', value: 'LQ202501718', source: 'sandhills_direct' } } });
// The keys saveListingEdits sends on every Save & Close (index.html SAVE-EXISTING-WRITES), with this row's values.
const saveAndClose = (over) => Object.assign({ filterStock: 'MPX-230981', dealer: IMPEX, year: '2025', make: 'SDLANCH', model: 'SDLGC100',
  trim: '', price: '12000', stock: 'MPX-230981', days: '0', condition: 'New', fuel: '', mileage: '', engine: '', transmission: '',
  drivetrain: '', engine_description: '', transmission_description: '', video_url: '', vin: 'LQ202501718', category: 'Other',
  featured: 0, subcategory: 'Golf Cart', description: 'x', notes: '', status: 'published', prod_status: null, model_locked: true,
  dx_locked: false, subcategory_locked: true, raw_description: null }, over || {});
const patchOf = (db) => db.writes.filter((w) => w.method === 'PATCH' && w.table === 'inventory');

// ---------- ordinary rows: unchanged behavior, and no way to create a marker ----------
test('A1: ordinary (unmarked) golf-cart row — Save & Close stamps condition human_admin exactly as today; no marker appears', async () => {
  const db = makeDb({ inventory: [golf(GOLF_NOW)] });
  const r = await callServer('update_inventory', saveAndClose({ price: '11500' }));
  assert.equal(r.status, 200);
  const [w] = patchOf(db);
  assert.equal(w.body.condition, 'New');
  assert.equal(w.body.provenance.condition.source, 'human_admin');
  assert.ok(!('adjudication' in w.body.provenance.condition), 'an ordinary save never creates a marker');
});

test('A2: a client cannot inject a marker — provenance is not forwarded on update or create', async () => {
  const db = makeDb({ inventory: [golf(GOLF_NOW)] });
  const forged = { condition: Object.assign(clone(GOLF_NOW), { adjudication: clone(MARKER) }) };
  let r = await callServer('update_inventory', saveAndClose({ provenance: forged, adjudication: MARKER }));
  assert.equal(r.status, 200);
  assert.ok(!('adjudication' in patchOf(db)[0].body.provenance.condition));
  r = await callServer('create_inventory', { stock: 'MPX-NEW1', dealer: IMPEX, condition: 'New', provenance: forged });
  assert.equal(r.status, 200);
  const post = db.writes.find((w) => w.method === 'POST');
  assert.ok(!('adjudication' in post.body[0].provenance.condition), 'create stamps from null; client provenance dropped');
});

// ---------- marked rows ----------
test('B1: MARKED row — Save & Close (condition unchanged, price edited) writes the price; condition is not in the PATCH; marker byte-stable', async () => {
  const db = makeDb({ inventory: [golf(GOLF_MARKED)] });
  const r = await callServer('update_inventory', saveAndClose({ price: '11500', engine: 'Electric' }));
  assert.equal(r.status, 200);
  const [w] = patchOf(db);
  assert.equal(w.body.price, '11500');
  assert.ok(!('condition' in w.body), 'condition never rides the PATCH on a marked row');
  assert.deepEqual(w.body.provenance.condition, GOLF_MARKED, 'provenance.condition (marker included) unchanged');
  assert.equal(w.body.provenance.engine.source, 'human_admin', 'other edited facts are still stamped');
  assert.deepEqual(db.tables.inventory[0].provenance.condition, GOLF_MARKED);
});

test('B2: MARKED row — blank condition (e.g. a stale form) is dropped, not written; marker byte-stable', async () => {
  const db = makeDb({ inventory: [golf(GOLF_MARKED)] });
  const r = await callServer('update_inventory', saveAndClose({ condition: '' }));
  assert.equal(r.status, 200);
  assert.ok(!('condition' in patchOf(db)[0].body));
  assert.equal(db.tables.inventory[0].condition, 'New');
  assert.deepEqual(db.tables.inventory[0].provenance.condition, GOLF_MARKED);
});

test('B3: MARKED row — a different condition is refused 409 and NOTHING is written', async () => {
  const db = makeDb({ inventory: [golf(GOLF_MARKED)] });
  const r = await callServer('update_inventory', saveAndClose({ condition: 'Used', price: '9999' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'condition_adjudicated');
  assert.equal(r.body.adjudicated_value, 'New');
  assert.match(r.body.message, /governed release/);
  assert.equal(patchOf(db).length, 0, 'no PATCH at all');
  assert.equal(db.tables.inventory[0].price, '12000');
});

test('B4: MALFORMED marker — still never stamped over (fail closed): same value dropped with a warning; different value 409', async () => {
  const bad = Object.assign(clone(GOLF_NOW), { adjudication: Object.assign(clone(MARKER), { authorized_on: '<OWNER_AUTH_DATE>' }) });
  let db = makeDb({ inventory: [golf(bad)] });
  let r = await callServer('update_inventory', saveAndClose({ price: '11000' }));
  assert.equal(r.status, 200);
  assert.ok(!('condition' in patchOf(db)[0].body));
  assert.deepEqual(db.tables.inventory[0].provenance.condition, bad);
  assert.ok(r.warns.some((w) => w.includes('[ADJUDICATION-MALFORMED]')));
  db = makeDb({ inventory: [golf(bad)] });
  r = await callServer('update_inventory', saveAndClose({ condition: 'Used' }));
  assert.equal(r.status, 409);
  assert.equal(patchOf(db).length, 0);
});

test('B5: INCONSISTENT marker (primary Used, marker New) — Save with New is dropped and warned; Save with Used is refused', async () => {
  const inc = Object.assign(clone(GOLF_MARKED), { value: 'Used' });
  let db = makeDb({ inventory: [golf(inc)] });
  let r = await callServer('update_inventory', saveAndClose({}));
  assert.equal(r.status, 200);
  assert.ok(!('condition' in patchOf(db)[0].body));
  assert.ok(r.warns.some((w) => w.includes('[ADJUDICATION-INCONSISTENT]')));
  db = makeDb({ inventory: [golf(inc)] });
  r = await callServer('update_inventory', saveAndClose({ condition: 'Used' }));
  assert.equal(r.status, 409);
});

test('B6: explicit adjudication: null is a PRESENT, MALFORMED marker — held like any marker: same value dropped and warned (null key byte-stable); different value 409, nothing written', async () => {
  const nul = Object.assign(clone(GOLF_NOW), { adjudication: null });
  let db = makeDb({ inventory: [golf(nul)] });
  let r = await callServer('update_inventory', saveAndClose({ price: '11000' }));
  assert.equal(r.status, 200);
  const [w] = patchOf(db);
  assert.ok(!('condition' in w.body));
  assert.deepEqual(w.body.provenance.condition, nul);
  assert.ok(Object.prototype.hasOwnProperty.call(db.tables.inventory[0].provenance.condition, 'adjudication'));
  assert.ok(r.warns.some((x) => x.includes('[ADJUDICATION-MALFORMED]') && x.includes('marker is null')));
  db = makeDb({ inventory: [golf(nul)] });
  r = await callServer('update_inventory', saveAndClose({ condition: 'Used' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.adjudication_state, 'malformed');
  assert.match(r.body.message, /governed reconcile/);
  assert.equal(patchOf(db).length, 0);
});

test('B7: no adjudication key (the same fact without the key) stays ordinary — Save & Close with a new condition stamps it (no key ≠ null key)', async () => {
  const db = makeDb({ inventory: [golf(GOLF_NOW)] });
  const r = await callServer('update_inventory', saveAndClose({ condition: 'Used' }));
  assert.equal(r.status, 200);
  assert.equal(patchOf(db)[0].body.condition, 'Used');
  assert.equal(db.tables.inventory[0].provenance.condition.value, 'Used');
});

test('B8: marked row whose COLUMN disagrees (column Used, marker New) — the editor resubmits the stored Used: not a change, dropped and warned; other edits save; nothing about condition moves', async () => {
  const db = makeDb({ inventory: [Object.assign(golf(GOLF_MARKED), { condition: 'Used' })] });
  const r = await callServer('update_inventory', saveAndClose({ condition: 'Used', price: '11800' }));
  assert.equal(r.status, 200);
  const [w] = patchOf(db);
  assert.ok(!('condition' in w.body));
  assert.equal(db.tables.inventory[0].condition, 'Used');
  assert.equal(db.tables.inventory[0].price, '11800');
  assert.deepEqual(db.tables.inventory[0].provenance.condition, GOLF_MARKED);
  assert.ok(r.warns.some((x) => x.includes('[ADJUDICATION-INCONSISTENT]') && x.includes('column "Used"')));
});

// ---------- exactly one row, and the database guard's refusal ----------
test('E1: the PATCH asks for the affected rows (Prefer return=representation, select=stock) and succeeds only on exactly one', async () => {
  const db = makeDb({ inventory: [golf(GOLF_MARKED)] });
  const r = await callServer('update_inventory', saveAndClose({ price: '11500' }));
  assert.equal(r.status, 200);
  assert.match(patchOf(db)[0].prefer, /return=representation/);
});

test('E2: zero affected rows (the row was renamed or removed after it was opened) → 409 update_matched_no_row, never a silent 200', async () => {
  const db = makeDb({ inventory: [golf(GOLF_NOW)] });
  const r = await callServer('update_inventory', saveAndClose({ filterStock: 'MPX-GONE', stock: 'MPX-GONE', price: '1' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'update_matched_no_row');
  assert.match(r.body.message, /Nothing was saved/);
  assert.equal(db.tables.inventory[0].price, '12000');
});

test('E3: the database guard refuses a stale write (PT409 → HTTP 409) → 409 condition_adjudication_changed, "Nothing was saved"', async () => {
  const db = makeDb({ inventory: [golf(GOLF_NOW)] }, { patchError: { status: 409, body: { code: 'PT409', details: null, hint: null, message: 'condition_adjudication_guard: MPX-230981 (Impex Heavy Metal) ...' } } });
  const r = await callServer('update_inventory', saveAndClose({ price: '11500' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'condition_adjudication_changed');
  assert.match(r.body.message, /changed while it was open.*Nothing was saved/);
  assert.equal(db.tables.inventory[0].price, '12000');
  assert.ok(r.warns.some((x) => x.includes('[ADJUDICATION-GUARD]')));
});

test('E4: any other 409 (e.g. a stock-rename unique violation, 23505) passes through unchanged', async () => {
  makeDb({ inventory: [golf(GOLF_NOW)] }, { patchError: { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "inventory_stock_dealer_unique"' } } });
  const r = await callServer('update_inventory', saveAndClose({ stock: 'MPX-680121' }));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /23505/);
  assert.equal(r.body.message, undefined);
});

// ---------- the base cannot be read ----------
test('C1: provenance unreadable + payload carries condition → 503, nothing written (no unguarded condition write)', async () => {
  const db = makeDb({ inventory: [golf(GOLF_MARKED)] }, { failGet: true });
  const r = await callServer('update_inventory', saveAndClose({ condition: 'Used' }));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'provenance_unavailable');
  assert.equal(patchOf(db).length, 0);
});

test('C2: provenance unreadable + payload WITHOUT condition → existing fail-safe preserved (values written, provenance untouched)', async () => {
  const db = makeDb({ inventory: [golf(GOLF_MARKED)] }, { failGet: true });
  const r = await callServer('update_inventory', { filterStock: 'MPX-230981', dealer: IMPEX, price: '11000', make: 'SDLANCH' });
  assert.equal(r.status, 200);
  const [w] = patchOf(db);
  assert.equal(w.body.price, '11000');
  assert.ok(!('provenance' in w.body));
  assert.deepEqual(db.tables.inventory[0].provenance.condition, GOLF_MARKED);
});

// ---------- the editor (REAL client functions from index.html) ----------
const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'index.html'), 'utf8');
const between = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); assert.ok(i >= 0 && j > i, 'markers missing: ' + a); return html.slice(i, j); };
function loadUi() {
  const els = { 'edit-condition': { disabled: false, title: '' } };
  const out = {};
  vm.runInNewContext(between('// COND-ADJ-UI-START', '// COND-ADJ-UI-END') +
    '\n;Object.assign(this.out, { conditionAdjudicated, renderConditionAdjudication, adminWriteRefusalMessage });',
    { out, document: { getElementById: (id) => els[id] || null } });
  return { ui: out, els };
}

test('D1: editor — Condition select is read-only on a marked row and editable again on an ordinary or new row', () => {
  const { ui, els } = loadUi();
  ui.renderConditionAdjudication({ provenance: { condition: GOLF_MARKED } });
  assert.equal(els['edit-condition'].disabled, true);
  assert.match(els['edit-condition'].title, /governed release/);
  ui.renderConditionAdjudication({ provenance: { condition: GOLF_NOW } });
  assert.equal(els['edit-condition'].disabled, false);
  ui.renderConditionAdjudication({ stock: 'NEW-1' });
  assert.equal(els['edit-condition'].disabled, false);
  ui.renderConditionAdjudication({ provenance: { condition: Object.assign(clone(GOLF_NOW), { adjudication: null }) } });
  assert.equal(els['edit-condition'].disabled, true, 'an explicit null marker is held too (key presence)');
  ui.renderConditionAdjudication({ provenance: { condition: 'New' } });
  assert.equal(els['edit-condition'].disabled, false);
});

test('D2: editor — a 409/503 refusal produces the server message; other statuses produce nothing new', () => {
  const { ui } = loadUi();
  assert.match(ui.adminWriteRefusalMessage(409, JSON.stringify({ error: 'condition_adjudicated', message: 'Condition on MPX-230981 is Owner-adjudicated as "New" and can only be changed by a governed release. Nothing was saved.' })), /Nothing was saved/);
  assert.match(ui.adminWriteRefusalMessage(409, JSON.stringify({ error: 'condition_adjudication_changed', message: 'MPX-230981 changed while it was open (its Owner-adjudicated condition was set, changed or released by a governed update). Nothing was saved. Reopen the listing and save again.' })), /Reopen the listing/);
  assert.equal(ui.adminWriteRefusalMessage(409, JSON.stringify({ error: '{"code":"23505"}' })), 'This listing was not saved.');
  assert.equal(ui.adminWriteRefusalMessage(503, 'not json'), 'This listing was not saved.');
  assert.equal(ui.adminWriteRefusalMessage(500, '{}'), '');
  assert.equal(ui.adminWriteRefusalMessage(401, '{}'), '');
});

test('D3: editor wiring — populateEditForm renders the guard and the save error path alerts the refusal', () => {
  const pop = html.slice(html.indexOf('function populateEditForm(u) {'), html.indexOf('function populateEditForm(u) {') + 1200);
  assert.match(pop, /edit-condition"\)\.value = u\.condition \|\| "Used";\n\s*renderConditionAdjudication\(u\);/);
  const save = between('// SAVE-EXISTING-WRITES-START', '// SAVE-EXISTING-WRITES-END');
  assert.match(save, /const _refusal = adminWriteRefusalMessage\(r\.status, t\);\n\s*if \(_refusal\) alert\(_refusal\);/);
});
