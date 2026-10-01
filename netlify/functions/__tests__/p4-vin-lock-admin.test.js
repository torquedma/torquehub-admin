'use strict';
// p4-vin-lock-admin.test.js — P4 Stage 1 (Chief 2026-10-01).
//   hgr-sync: honors vin_locked and never PATCHes a blank feed VIN over a stored VIN.
//   admin-write: vin_locked is written only by set_vin_lock; an ordinary update_inventory save cannot touch it.
// Runs the REAL handlers. HGR: Node's https module is patched in-process. admin-write: in-memory PostgREST fake.
// Run: node --test netlify/functions/__tests__/p4-vin-lock-admin.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';
const clone = (x) => JSON.parse(JSON.stringify(x));
const quietly = async (fn) => {
  const q = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { [console.log, console.warn, console.error] = q; }
};

// ---------------- hgr-sync ----------------
const HGR_PATH = require.resolve('../hgr-sync.js');
function feedXml(units) {
  return '<rss>' + units.map((u) => '<item><stocknumber>' + u.stock + '</stocknumber><year>2024</year>'
    + '<manufacturer>Big Tex</manufacturer><model_name>14GN-25 Gooseneck Dump</model_name><model_type>Dump Trailer</model_type>'
    + '<price>15995</price><usage>New</usage><description>Dump trailer.</description>'
    + '<vin>' + (u.vin || '') + '</vin></item>').join('') + '</rss>';
}
async function runHgr({ units, rows }) {
  const writes = [];
  const origGet = https.get, origReq = https.request, origFetch = global.fetch;
  https.get = (url, cb) => {
    const res = new EventEmitter();
    setImmediate(() => { cb(res); res.emit('data', feedXml(units)); res.emit('end'); });
    return new EventEmitter();
  };
  https.request = (opts, cb) => {
    const req = new EventEmitter(); let body = '';
    req.write = (d) => { body += d; };
    req.end = () => setImmediate(() => {
      let out = '[]';
      if (opts.method === 'GET') out = JSON.stringify(rows);
      else writes.push({ method: opts.method, path: opts.path, body: JSON.parse(body) });
      const res = new EventEmitter(); res.statusCode = 200; cb(res); res.emit('data', out); res.emit('end');
    });
    return req;
  };
  global.fetch = async () => ({ ok: true, status: 202, text: async () => '' });
  delete require.cache[HGR_PATH];
  try {
    const r = await quietly(() => require(HGR_PATH).handler({}));
    assert.equal(r.statusCode, 200, r.body);
  } finally { https.get = origGet; https.request = origReq; global.fetch = origFetch; }
  return { patches: writes.filter((w) => w.method === 'PATCH'), posts: writes.filter((w) => w.method === 'POST') };
}
const hgrRow = (over) => Object.assign({ stock: 'HGR-T1', sold: false, subcategory_locked: false, model_locked: false,
  vin_locked: false, dx_locked: false, status: 'published', completion_state: 'complete', completion_attempts: 0 }, over);
const onlyPatch = (r) => { assert.equal(r.patches.length, 1, 'expected one PATCH'); return r.patches[0].body; };

test('T12: HGR blank feed VIN cannot erase a stored VIN (no vin key in the PATCH)', async () => {
  const b = onlyPatch(await runHgr({ units: [{ stock: 'T1', vin: '' }], rows: [hgrRow()] }));
  assert.ok(!('vin' in b), 'PATCH must not carry vin when the feed VIN is blank');
});

test('T13: HGR locked VIN cannot be overwritten by the feed', async () => {
  const b = onlyPatch(await runHgr({ units: [{ stock: 'T1', vin: '4ZEDK2025R1234567' }], rows: [hgrRow({ vin_locked: true })] }));
  assert.ok(!('vin' in b), 'PATCH must not carry vin on a vin_locked row');
});

test('T13b: HGR unlocked row with a feed VIN still writes it (behavior preserved)', async () => {
  const b = onlyPatch(await runHgr({ units: [{ stock: 'T1', vin: '4ZEDK2025R1234567' }], rows: [hgrRow()] }));
  assert.equal(b.vin, '4ZEDK2025R1234567');
});

test('T13c: HGR INSERT path unchanged (new stock lands with the feed value or null)', async () => {
  const r = await runHgr({ units: [{ stock: 'T9', vin: '' }], rows: [hgrRow()] });
  const ins = r.posts.flatMap((p) => p.body).find((x) => x.stock === 'HGR-T9');
  assert.ok(ins, 'expected an INSERT for the new stock');
  assert.equal(ins.vin, null);
});

// ---------------- admin-write ----------------
function makeDb(tables) {
  const db = { tables: clone(tables), writes: [] };
  const match = (row, filters) => filters.every(([k, op, v]) => op === 'eq' && row[k] != null && String(row[k]) === v);
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return res({ email: 'ryan@example.com' });
    const m = url.match(/\/rest\/v1\/([a-z_]+)\?(.*)$/);
    if (!m) return res({ error: 'unexpected url ' + url }, 500);
    const [, table, qs] = m; const filters = [];
    for (const part of qs.split('&')) {
      const i = part.indexOf('='); const k = part.slice(0, i), val = part.slice(i + 1);
      if (k === 'select') continue;
      const d = val.indexOf('.'); filters.push([k, val.slice(0, d), decodeURIComponent(val.slice(d + 1))]);
    }
    const rows = (db.tables[table] || []).filter((r) => match(r, filters));
    if (method === 'GET') return res(clone(rows));
    if (method === 'PATCH') {
      const body = JSON.parse(opts.body); db.writes.push({ table, url, body });
      for (const r of rows) Object.assign(r, body);
      return res(/return=representation/.test((opts.headers && opts.headers.Prefer) || '') ? clone(rows) : null);
    }
    return res({ error: 'unexpected method' }, 500);
  };
  return db;
}
async function callServer(operation, data) {
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const r = await quietly(() => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation, data }) }));
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const DEALER = 'DeBary Truck Sales';
const locked = () => ({ stock: 'DBT-7923', dealer: DEALER, vin: null, vin_locked: true, provenance: {} });

test('T14: ordinary Admin listing save cannot clear vin_locked, even when a stale client sends vin_locked:false', async () => {
  const db = makeDb({ inventory: [locked()] });
  const r = await callServer('update_inventory', { filterStock: 'DBT-7923', dealer: DEALER, vin: '', make: 'Isuzu', vin_locked: false });
  assert.equal(r.status, 200);
  const patch = db.writes.find((w) => w.table === 'inventory' && 'make' in w.body);
  assert.ok(patch, 'the ordinary save was written');
  assert.ok(!('vin_locked' in patch.body), 'vin_locked must never ride update_inventory');
  assert.equal(db.tables.inventory[0].vin_locked, true);
});

test('T14b: set_vin_lock locks and deliberately unlocks exactly one row', async () => {
  const db = makeDb({ inventory: [Object.assign(locked(), { vin_locked: false })] });
  let r = await callServer('set_vin_lock', { stock: 'DBT-7923', dealer: DEALER, vin_locked: true });
  assert.deepEqual([r.status, r.body.vin_locked], [200, true]);
  assert.equal(db.tables.inventory[0].vin_locked, true);
  r = await callServer('set_vin_lock', { stock: 'DBT-7923', dealer: DEALER, vin_locked: false });
  assert.deepEqual([r.status, r.body.vin_locked], [200, false]);
  assert.deepEqual(db.writes.map((w) => w.body), [{ vin_locked: true }, { vin_locked: false }], 'writes only vin_locked');
});

test('T14c: set_vin_lock rejects a non-boolean and reports a non-matching row instead of succeeding silently', async () => {
  const db = makeDb({ inventory: [locked()] });
  let r = await callServer('set_vin_lock', { stock: 'DBT-7923', dealer: DEALER, vin_locked: 'false' });
  assert.equal(r.status, 400);
  r = await callServer('set_vin_lock', { stock: 'DBT-0000', dealer: DEALER, vin_locked: false });
  assert.equal(r.status, 409);
  assert.equal(db.tables.inventory[0].vin_locked, true);
});

test('T14d: a human VIN edit on a locked row is allowed (the lock binds automated writers only)', async () => {
  const db = makeDb({ inventory: [locked()] });
  const r = await callServer('update_inventory', { filterStock: 'DBT-7923', dealer: DEALER, vin: 'JALC4W165J7000123' });
  assert.equal(r.status, 200);
  assert.equal(db.tables.inventory[0].vin, 'JALC4W165J7000123');
  assert.equal(db.tables.inventory[0].vin_locked, true);
});
