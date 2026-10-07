'use strict';
// browser-publish-retired.test.js — Chief ruling 2026-10-07 (Drive 1tf7HZWpvY0MBL8Edv_KvXtEBq6R7OcrT_dI4svkvd5g):
// browser dealer-site publishing is retired; the server publisher (lib/publish-to-dealer.js) is the only
// publisher and now also runs after create_inventory and update_inventory (temporary bridge until pull feeds).
// Run: node --test netlify/functions/__tests__/browser-publish-retired.test.js
// No network, no database: the REAL admin-write handler runs against an in-memory PostgREST fake, and the
// REAL client toggleFeatured is evaluated from index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';
process.env.PUBLISH_TOKEN_DAV = 'tok-dav';
process.env.PUBLISH_TOKEN_WTS = 'tok-wts';
process.env.PUBLISH_TOKEN_FDT = 'tok-fdt';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');
const clientFiles = ['index.html', 'intake.html', ...fs.readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const quietly = async (fn) => { const q = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = q; } };

const DEALER_FN = {
  'Davenport Motors': 'https://davenportmotors.net/.netlify/functions/inventory',
  "Fat Daddy's Truck Sales": 'https://fatdaddystrucksales.netlify.app/.netlify/functions/inventory',
  'Wilson Trailer Sales & Service': 'https://wilson-trailer-sales.netlify.app/.netlify/functions/inventory',
};
const DEALER_HOSTS = ['davenportmotors.net', 'fatdaddystrucksales', 'wilson-trailer-sales', 'wilsontrailersalesinc'];

// ---------------- client: browser publisher is gone ----------------
const RETIRED = ['pushDealerInventoryToBackend', 'buildDealerPayload', 'publishDealerSites', 'afterInventoryMutation',
  'loadPublishConfig', 'savePublishConfig', 'renderPublishDealerList', 'updatePublishLabel', 'dealerHasPublishTarget',
  'PUBLISH_DEALERS', 'PUBLISH_CONFIG_KEY', 'pullDealerInventoryFromBackend', 'syncDavenportFromBackend', 'runPublishChecklist',
  'publish-token', 'publish-btn', 'publish-target', 'publish-status', 'publish-last-time', 'publish-dealer-list', 'publish-dealer-radios'];

test('C1: no client file references any retired browser-publish identifier or control', () => {
  for (const f of clientFiles) {
    const src = read(f);
    for (const id of RETIRED) assert.ok(!src.includes(id), `${f} still references ${id}`);
  }
});

test('C2: no client file can POST to a dealer-site inventory function', () => {
  for (const f of clientFiles) {
    const src = read(f);
    assert.ok(!/\.netlify\/functions\/inventory/.test(src), `${f} references a dealer inventory function path`);
    const fetchTargets = [...src.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1]);
    for (const t of fetchTargets) for (const h of DEALER_HOSTS) assert.ok(!t.includes(h), `${f} fetches ${t}`);
  }
});

test('C3: Settings keeps the server publish history and drops the token/target/publish controls', () => {
  const i = html.indexOf('id="stab-publish"');
  const j = html.indexOf('<!-- TAB: FEED CONFIGS -->');
  assert.ok(i > 0 && j > i);
  const panel = html.slice(i, j);
  assert.ok(panel.includes('id="publish-log-list"'), 'publish history list retained');
  assert.ok(!/<input|<button/.test(panel), 'no input or button left in the publish panel');
  assert.ok(html.includes("localStorage.removeItem('torquehub_publish_config_v1')"), 'stored browser publish token is purged');
});

test('C4: every inline <script> in index.html still parses', () => {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 3);
  blocks.forEach((code, n) => assert.doesNotThrow(() => new vm.Script(code), `inline script #${n} fails to parse`));
});

test('C5: _notePublishResult is declared before the create/update call sites that use it', () => {
  const decl = html.indexOf('function _notePublishResult(');
  const uses = [...html.matchAll(/_notePublishResult\(/g)].map((m) => m.index).filter((k) => k !== decl + 'function '.length);
  assert.ok(decl > 0 && uses.length >= 6, 'declaration and call sites present');
  for (const u of uses) assert.ok(u > decl, 'call site precedes declaration at offset ' + u);
  assert.ok(html.includes("_notePublishResult(result && result.publish, 'create_inventory')"));
  assert.ok(html.includes("_notePublishResult(b && b.publish, 'update_inventory')"));
});

// Extract a top-level function from the shipped page by brace matching.
function extractFn(name) {
  const start = html.indexOf('async function ' + name + '(') >= 0 ? html.indexOf('async function ' + name + '(') : html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  let k = html.indexOf('{', start), depth = 0;
  for (; k < html.length; k++) { if (html[k] === '{') depth++; else if (html[k] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, k + 1);
}

test('C6: client toggleFeatured makes exactly one request, to admin-write, and no browser push', async () => {
  const calls = [];
  const ctx = {
    calls, console: { log() {}, warn() {}, error() {} },
    INVENTORY: [{ stock: 'DAV-043001', dealer: 'Davenport Motors', featured: 0 }],
    getValidToken: async () => 't', refreshAllViews() {}, alert() {}, setTimeout,
    document: { getElementById: () => null },
    fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, publish: { status: 'success' } }), text: async () => '' }; },
  };
  vm.runInNewContext(extractFn('_notePublishResult') + '\n' + extractFn('toggleFeatured') + '\n;this.run = toggleFeatured;', ctx);
  await ctx.run('DAV-043001', 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1, 'one request per toggle');
  assert.equal(calls[0].url, '/.netlify/functions/admin-write');
  assert.deepEqual(calls[0].body, { operation: 'toggle_featured', data: { stock: 'DAV-043001', featured: 0 } });
});

// ---------------- server: in-memory PostgREST + dealer endpoints ----------------
function makeWorld(rows, { dealerStatus = 200, patchStatus = 204 } = {}) {
  const w = { inventory: clone(rows), publishLog: [], dealerPosts: [], order: [] };
  const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => (json == null ? '' : JSON.stringify(json)) });
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.includes('/auth/v1/user')) return res({ email: 'ryan@example.com' });
    const dealer = Object.keys(DEALER_FN).find((d) => DEALER_FN[d] === url);
    if (dealer) { w.dealerPosts.push({ dealer, auth: opts.headers.Authorization, units: JSON.parse(opts.body) }); w.order.push('dealer'); return res({ ok: true }, dealerStatus); }
    const m = url.match(/\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/);
    if (!m) return res({ error: 'unexpected url ' + url }, 500);
    const [, table, qs = ''] = m;
    if (table === 'publish_log' && method === 'POST') { w.publishLog.push(...JSON.parse(opts.body)); w.order.push('log'); return res(null, 201); }
    if (table !== 'inventory') return res({ error: 'unexpected table ' + table }, 500);
    const filters = [];
    for (const part of qs.split('&').filter(Boolean)) {
      const i = part.indexOf('='); const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === 'select' || k === 'limit') continue;
      const d = v.indexOf('.'); filters.push([k, v.slice(0, d), decodeURIComponent(v.slice(d + 1))]);
    }
    const hit = w.inventory.filter((r) => filters.every(([k, op, v]) => op === 'eq' && r[k] != null && String(r[k]) === v));
    if (method === 'GET') return res(clone(hit));
    if (method === 'PATCH') { if (patchStatus >= 400) return res({ error: 'db down' }, patchStatus); const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); w.order.push('db'); return res(null, 204); }
    if (method === 'DELETE') { w.inventory = w.inventory.filter((r) => !hit.includes(r)); w.order.push('db'); return res(null, 204); }
    if (method === 'POST') { const ins = JSON.parse(opts.body).map((r, n) => ({ id: 'new-' + n, ...r })); w.inventory.push(...ins); w.order.push('db'); return res(clone(ins), 201); }
    return res({ error: 'unexpected method' }, 500);
  };
  return w;
}
async function call(operation, data) {
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const r = await quietly(() => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation, data }) }));
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const DAV = 'Davenport Motors', WTS = 'Wilson Trailer Sales & Service', FDT = "Fat Daddy's Truck Sales";
const unit = (stock, dealer, status, extra = {}) => ({ id: 'id-' + stock, stock, dealer, status, sold: false, price: '$1', year: '2020', make: 'X', model: 'Y', photos: [], created_at: '2026-09-30T00:00:00Z', provenance: {}, ...extra });

test('S1: create_inventory for a dealer-site dealer → DB insert, then ONE server publish + ONE publish_log row; drafts never sent', async () => {
  const w = makeWorld([unit('DAV-1', DAV, 'published')]);
  const r = await call('create_inventory', { stock: 'DAV-2', dealer: DAV, status: 'draft', year: '2021', make: 'A', model: 'B' });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.id, 'new-0');
  assert.equal(r.body.publish.status, 'success');
  assert.equal(w.dealerPosts.length, 1); assert.equal(w.publishLog.length, 1);
  assert.deepEqual(w.order, ['db', 'dealer', 'log'], 'publish runs after the committed insert');
  assert.deepEqual(w.dealerPosts[0].units.map((u) => u.stock), ['DAV-1'], 'the new draft is not on the dealer payload');
  assert.equal(w.dealerPosts[0].auth, 'Bearer tok-dav');
});

test('S2: update_inventory draft → published puts the unit on the dealer site through the server path', async () => {
  const w = makeWorld([unit('WTS-1', WTS, 'published'), unit('WTS-2', WTS, 'draft')]);
  const r = await call('update_inventory', { filterStock: 'WTS-2', dealer: WTS, status: 'published', price: '$9,000' });
  assert.equal(r.status, 200); assert.equal(r.body.publish.status, 'success');
  assert.equal(w.dealerPosts.length, 1); assert.equal(w.publishLog.length, 1);
  assert.deepEqual(w.dealerPosts[0].units.map((u) => u.stock).sort(), ['WTS-1', 'WTS-2']);
  assert.equal(w.dealerPosts[0].units.find((u) => u.stock === 'WTS-2').price, '$9,000');
});

test('S3: update_inventory published → draft removes the unit from the dealer site through the server path', async () => {
  const w = makeWorld([unit('FDT-1', FDT, 'published'), unit('FDT-2', FDT, 'published')]);
  const r = await call('update_inventory', { filterStock: 'FDT-2', dealer: FDT, status: 'draft' });
  assert.equal(r.status, 200); assert.equal(r.body.publish.status, 'success');
  assert.deepEqual(w.dealerPosts[0].units.map((u) => u.stock), ['FDT-1']);
  assert.equal(w.publishLog.length, 1);
});

test('S4: a dealer without a dealer site → no external publish and no publish_log row', async () => {
  const w = makeWorld([unit('DBT-1', 'DeBary Truck Sales', 'published')]);
  const u = await call('update_inventory', { filterStock: 'DBT-1', dealer: 'DeBary Truck Sales', price: '$2' });
  const c = await call('create_inventory', { stock: 'DBT-2', dealer: 'DeBary Truck Sales', status: 'draft' });
  assert.equal(u.status, 200); assert.equal(c.status, 200);
  assert.equal(u.body.publish.status, 'skipped'); assert.equal(c.body.publish.status, 'skipped');
  assert.equal(w.dealerPosts.length, 0); assert.equal(w.publishLog.length, 0);
});

test('S5: a dealer-site failure is reported and logged but never rolls back the committed write', async () => {
  const w = makeWorld([unit('DAV-1', DAV, 'published', { price: '$1' })], { dealerStatus: 500 });
  const r = await call('update_inventory', { filterStock: 'DAV-1', dealer: DAV, price: '$5' });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.equal(r.body.publish.status, 'failed');
  assert.equal(w.inventory[0].price, '$5', 'the update stands');
  assert.equal(w.publishLog.length, 1); assert.equal(w.publishLog[0].status, 'failed');
});

test('S6: the four existing publisher call sites are unchanged — one publish each', async () => {
  for (const [op, data] of [
    ['toggle_featured', { stock: 'DAV-1', featured: 0 }],
    ['mark_sold', { stock: 'DAV-1', dealer: DAV }],
    ['unmark_sold', { stock: 'DAV-1', dealer: DAV }],
    ['remove_inventory', { stock: 'DAV-1', dealer: DAV }],
  ]) {
    const w = makeWorld([unit('DAV-1', DAV, 'published')]);
    const r = await call(op, data);
    assert.equal(r.status, 200, op); assert.equal(r.body.publish.status, 'success', op);
    assert.equal(w.dealerPosts.length, 1, op); assert.equal(w.publishLog.length, 1, op);
  }
});

// ---------------- photo-race amendment (Chief 2026-10-07) ----------------
const OLD_PHOTOS = [{ url: 'https://cdn.example/old.jpg', name: 'old' }];
const NEW_PHOTOS = [{ url: 'https://cdn.example/new1.jpg', name: 'n1' }, { url: 'https://cdn.example/new2.jpg', name: 'n2' }];
const urls = (u) => u.photos.map((p) => p.url);

test('S7: patch_inventory_photos for a dealer-site dealer → DB write, then ONE server publish carrying the new gallery, logged', async () => {
  const w = makeWorld([unit('DAV-1', DAV, 'published', { photos: OLD_PHOTOS })]);
  const r = await call('patch_inventory_photos', { stock: 'DAV-1', dealer: DAV, photos: NEW_PHOTOS });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.publish.status, 'success');
  assert.deepEqual(w.order, ['db', 'dealer', 'log'], 'publish runs after the committed photo write');
  assert.equal(w.dealerPosts.length, 1); assert.equal(w.publishLog.length, 1); assert.equal(w.publishLog[0].status, 'success');
  assert.deepEqual(urls(w.dealerPosts[0].units[0]), NEW_PHOTOS.map((p) => p.url));
});

test('S8: a failed photo PATCH publishes nothing (DB error and refused empty list)', async () => {
  const w1 = makeWorld([unit('DAV-1', DAV, 'published', { photos: OLD_PHOTOS })], { patchStatus: 500 });
  const r1 = await call('patch_inventory_photos', { stock: 'DAV-1', dealer: DAV, photos: NEW_PHOTOS });
  assert.equal(r1.status, 500); assert.equal(r1.body.publish, undefined);
  assert.equal(w1.dealerPosts.length, 0); assert.equal(w1.publishLog.length, 0);
  const w2 = makeWorld([unit('DAV-1', DAV, 'published', { photos: OLD_PHOTOS })]);
  const r2 = await call('patch_inventory_photos', { stock: 'DAV-1', dealer: DAV, photos: [] });
  assert.equal(r2.status, 409);
  assert.equal(w2.dealerPosts.length, 0); assert.equal(w2.publishLog.length, 0);
  assert.deepEqual(urls(w2.inventory[0]), OLD_PHOTOS.map((p) => p.url), 'gallery untouched');
});

test('S9: photo PATCH for a dealer without a dealer site → skipped, no dealer POST, no publish_log row', async () => {
  const w = makeWorld([unit('DBT-1', 'DeBary Truck Sales', 'published', { photos: OLD_PHOTOS })]);
  const r = await call('patch_inventory_photos', { stock: 'DBT-1', dealer: 'DeBary Truck Sales', photos: NEW_PHOTOS });
  assert.equal(r.status, 200); assert.equal(r.body.publish.status, 'skipped');
  assert.equal(w.dealerPosts.length, 0); assert.equal(w.publishLog.length, 0);
  assert.deepEqual(urls(w.inventory[0]), NEW_PHOTOS.map((p) => p.url), 'the photo write itself still lands');
});

test('S10: a field + photo save converges on the new gallery and fields in either completion order; only the server posts', async () => {
  for (const order of [['update_inventory', 'patch_inventory_photos'], ['patch_inventory_photos', 'update_inventory']]) {
    const w = makeWorld([unit('WTS-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
    for (const op of order) {
      const r = op === 'update_inventory'
        ? await call(op, { filterStock: 'WTS-1', dealer: WTS, price: '$7,500' })
        : await call(op, { stock: 'WTS-1', dealer: WTS, photos: NEW_PHOTOS });
      assert.equal(r.status, 200, op);
    }
    assert.equal(w.dealerPosts.length, 2, order.join(' then '));
    assert.equal(w.publishLog.length, 2, order.join(' then '));
    assert.ok(w.dealerPosts.every((p) => p.auth === 'Bearer tok-wts'), 'every dealer POST is the server publisher');
    const final = w.dealerPosts[w.dealerPosts.length - 1].units.find((u) => u.stock === 'WTS-1');
    assert.deepEqual(urls(final), NEW_PHOTOS.map((p) => p.url), order.join(' then ') + ': final gallery');
    assert.equal(final.price, '$7,500', order.join(' then ') + ': final price');
  }
  // The client half — no browser dealer-site POST on any save — is C1 + C2 (no client code can reach a
  // dealer inventory endpoint) and the jsdom runtime gate.
});

// ---------------- client sequencing amendment (Chief 2026-10-07, final) ----------------
// The REAL existing-listing write block of saveListingEdits (between SAVE-EXISTING-WRITES markers) runs in a
// vm with the REAL getListingKey / photoListSignature / _notePublishResult; its fetch is routed to the REAL
// admin-write handler over the in-memory PostgREST fake (a zero-row PATCH succeeds, as PostgREST does).
function runExistingSave(w, u, oldKey, photoState, { slowUpdateMs = 0 } = {}) {
  const i = html.indexOf('// SAVE-EXISTING-WRITES-START'), j = html.indexOf('// SAVE-EXISTING-WRITES-END');
  assert.ok(i > 0 && j > i, 'SAVE-EXISTING-WRITES markers missing');
  const block = html.slice(i, j);
  const requests = [];
  const pending = new Set();
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, alert() {}, setTimeout,
    document: { getElementById: () => null },
    DUPE_STOCKS: new Set(), PHOTO_STATE: photoState.state, PHOTO_STORE: photoState.store, PHOTO_BASELINE: photoState.baseline,
    getValidToken: async () => 't', JSON,
    fetch: (url, opts) => {
      const body = JSON.parse(opts.body);
      requests.push({ url, operation: body.operation, data: body.data });
      const p = (async () => {
        assert.equal(url, '/.netlify/functions/admin-write', 'client may only call admin-write');
        if (body.operation === 'update_inventory' && slowUpdateMs) await new Promise((r) => setTimeout(r, slowUpdateMs));   // a slow update must not let photos win
        const { handler } = require('../admin-write.js');
        const r = await quietly(() => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: opts.body }));
        return { ok: r.statusCode < 400, status: r.statusCode, json: async () => JSON.parse(r.body), text: async () => r.body };
      })();
      pending.add(p); p.finally(() => pending.delete(p));
      return p;
    },
  };
  ctx.u = u; ctx.oldKey = oldKey; ctx._sendLoc = false;
  delete require.cache[require.resolve('../admin-write.js')];
  vm.runInNewContext(extractFn('getListingKey') + '\n' + extractFn('photoListSignature') + '\n' + extractFn('_notePublishResult') +
    '\n;this.run = async function () {\n' + block + '\n};', ctx);
  return (async () => {
    await ctx.run();
    for (let k = 0; k < 50; k++) { await new Promise((r) => setTimeout(r, 5)); if (pending.size === 0) { await new Promise((r) => setTimeout(r, 5)); if (pending.size === 0) break; } }
    return requests;
  })();
}
const editedUnit = (over) => ({ dealer: WTS, year: '2020', make: 'X', model: 'Y', price: '$8,800', status: 'published', ...over });
const photoStateFor = (key, store, baselineList) => ({ state: { [key]: 'LOADED' }, store: { [key]: store }, baseline: { [key]: require('vm').runInNewContext(extractFn('photoListSignature') + ';photoListSignature(list)', { list: baselineList }) } });

test('A1: existing listing — stock rename OLD-1 → NEW-1 + field + gallery: update commits first, photo PATCH targets NEW-1, final dealer payload has NEW-1 + new field + new gallery', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const u = editedUnit({ stock: 'NEW-1', _originalStock: 'OLD-1' });
  const reqs = await runExistingSave(w, u, 'OLD-1', photoStateFor('NEW-1', NEW_PHOTOS, OLD_PHOTOS), { slowUpdateMs: 40 });
  assert.deepEqual(reqs.map((r) => r.operation), ['update_inventory', 'patch_inventory_photos'], 'update first, then photos');
  assert.equal(reqs[0].data.filterStock, 'OLD-1'); assert.equal(reqs[0].data.stock, 'NEW-1');
  assert.equal(reqs[1].data.stock, 'NEW-1', 'photo PATCH targets the renamed stock');
  const row = w.inventory.find((r) => r.stock === 'NEW-1');
  assert.ok(row && !w.inventory.find((r) => r.stock === 'OLD-1'), 'row renamed');
  assert.deepEqual(urls(row), NEW_PHOTOS.map((p) => p.url), 'gallery written to the renamed row');
  assert.equal(w.dealerPosts.length, 2); assert.equal(w.publishLog.length, 2);
  assert.ok(w.dealerPosts.every((p) => p.auth === 'Bearer tok-wts'), 'only the server publisher posts to the dealer site');
  const final = w.dealerPosts[w.dealerPosts.length - 1].units;
  assert.deepEqual(final.map((x) => x.stock), ['NEW-1']);
  assert.equal(final[0].price, '$8,800');
  assert.deepEqual(urls(final[0]), NEW_PHOTOS.map((p) => p.url));
});

test('A2: existing listing — failed update_inventory + intended photo change → zero photo PATCH requests', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })], { patchStatus: 500 });
  const u = editedUnit({ stock: 'NEW-1', _originalStock: 'OLD-1' });
  const ps = photoStateFor('NEW-1', NEW_PHOTOS, OLD_PHOTOS);
  const before = ps.baseline['NEW-1'];
  const reqs = await runExistingSave(w, u, 'OLD-1', ps);
  assert.deepEqual(reqs.map((r) => r.operation), ['update_inventory'], 'no patch_inventory_photos after a failed update');
  assert.equal(w.dealerPosts.length, 0); assert.equal(w.publishLog.length, 0);
  assert.deepEqual(urls(w.inventory[0]), OLD_PHOTOS.map((p) => p.url), 'gallery untouched');
  assert.equal(ps.baseline['NEW-1'], before, 'photo baseline not advanced');
});

test('A3: existing listing — unchanged gallery → update only, one server publish', async () => {
  const w = makeWorld([unit('WTS-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const reqs = await runExistingSave(w, editedUnit({ stock: 'WTS-1' }), 'WTS-1', photoStateFor('WTS-1', OLD_PHOTOS, OLD_PHOTOS));
  assert.deepEqual(reqs.map((r) => r.operation), ['update_inventory']);
  assert.equal(w.dealerPosts.length, 1); assert.equal(w.dealerPosts[0].units[0].price, '$8,800');
});

test('S11: why the client must sequence — a photo PATCH sent before a stock rename matches zero rows yet succeeds, and the final dealer payload keeps the old gallery', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const p = await call('patch_inventory_photos', { stock: 'NEW-1', dealer: WTS, photos: NEW_PHOTOS });
  assert.equal(p.status, 200, 'PostgREST-style zero-row PATCH reports success');
  const r = await call('update_inventory', { filterStock: 'OLD-1', dealer: WTS, stock: 'NEW-1', price: '$8,800' });
  assert.equal(r.status, 200);
  const final = w.dealerPosts[w.dealerPosts.length - 1].units[0];
  assert.equal(final.stock, 'NEW-1');
  assert.deepEqual(urls(final), OLD_PHOTOS.map((x) => x.url), 'stale gallery when photos go first — A1 proves the client now prevents this order');
});
