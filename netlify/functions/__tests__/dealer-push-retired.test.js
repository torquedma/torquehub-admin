'use strict';
// dealer-push-retired.test.js — dealer-site push publishing is fully retired.
// Browser publishing was retired 2026-10-07 (Chief, Drive 1tf7HZWpvY0MBL8Edv_KvXtEBq6R7OcrT_dI4svkvd5g); the temporary
// server publisher was retired 2026-10-09 (Chief, design 1e0KG2VgmdGjl3ryoSzNfbHGkKHxaaWjCHWWuUZFFRsc) after all three
// dealer sites proved pull-independent. Every ADMIN mutation performs its Supabase write, makes NO request to any
// dealer domain, writes NO publish_log row and returns NO publish field. The save-sequencing and identity-anchor
// protections (A1–A5, S8, S10, S11) survive with database-state assertions.
// Run: node --test netlify/functions/__tests__/dealer-push-retired.test.js
// No network, no database: the REAL admin-write handler runs against an in-memory PostgREST fake, and the
// REAL client toggleFeatured is evaluated from index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';

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

test('C3: Settings has no Publish tab, panel, history renderer or publish copy; the stored browser token purge stays', () => {
  for (const gone of ['stab-publish', "switchSettingsTab('publish'", 'renderPublishLog', 'publish-log-list', 'Dealer Site Publish History', 'publish_log']) {
    assert.ok(!html.includes(gone), 'index.html still contains ' + gone);
  }
  assert.ok(html.includes("localStorage.removeItem('torquehub_publish_config_v1')"), 'stored browser publish token is still purged (until the token-removal gate)');
});

test('C4: every inline <script> in index.html still parses', () => {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 3);
  blocks.forEach((code, n) => assert.doesNotThrow(() => new vm.Script(code), `inline script #${n} fails to parse`));
});

test('C5: the client no longer has a publish-result surface and reads no publish field', () => {
  assert.ok(!html.includes('_notePublishResult'), '_notePublishResult must be gone (declaration and all call sites)');
  assert.ok(!html.includes('Server publish failed'), 'no server-publish failure copy');
  assert.ok(!/\b\w+(\s*&&\s*\w+)?\.publish\b(?!\w)/.test(html), 'no client code reads a .publish field');
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
    fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }; },
  };
  vm.runInNewContext(extractFn('toggleFeatured') + '\n;this.run = toggleFeatured;', ctx);
  await ctx.run('DAV-043001', 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1, 'one request per toggle');
  assert.equal(calls[0].url, '/.netlify/functions/admin-write');
  assert.deepEqual(calls[0].body, { operation: 'toggle_featured', data: { stock: 'DAV-043001', featured: 0 } });
});

// ---------------- server: in-memory PostgREST + dealer endpoints ----------------
function makeWorld(rows, { dealerStatus = 200, patchStatus = 204 } = {}) {
  const w = { inventory: clone(rows), publishLog: [], dealerPosts: [], order: [], urls: [], patchStatus };   // patchStatus is mutable mid-test
  const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => (json == null ? '' : JSON.stringify(json)) });
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    w.urls.push(url);
    if (url.includes('/auth/v1/user')) return res({ email: 'ryan@example.com' });
    if (DEALER_HOSTS.some((h) => url.includes(h))) { w.dealerPosts.push({ url, method }); w.order.push('dealer'); return res({ ok: true }, dealerStatus); }
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
    if (method === 'PATCH') { if (w.patchStatus >= 400) return res({ error: 'db down' }, w.patchStatus); const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); w.order.push('db'); return res(null, 204); }
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

// The retirement invariant every ADMIN mutation must hold (Chief 2026-10-09).
function assertNoPush(w, r, label) {
  assert.equal(r.status, 200, label + ': status');
  assert.equal(r.body.ok, true, label + ': ok');
  assert.ok(!('publish' in r.body), label + ': response carries no publish field');
  assert.equal(w.dealerPosts.length, 0, label + ': no request to any dealer domain');
  assert.ok(!w.urls.some((u) => DEALER_HOSTS.some((h) => u.includes(h))), label + ': no dealer host fetched');
  assert.equal(w.publishLog.length, 0, label + ': no publish_log row');
  assert.ok(!w.urls.some((u) => u.includes('/rest/v1/publish_log')), label + ': publish_log never touched');
}

test('N1: create_inventory → row inserted (draft and published), no push, no publish_log, no publish field', async () => {
  for (const status of ['draft', 'published']) {
    const w = makeWorld([unit('DAV-1', DAV, 'published')]);
    const r = await call('create_inventory', { stock: 'DAV-2', dealer: DAV, status, year: '2021', make: 'A', model: 'B' });
    assertNoPush(w, r, 'create ' + status);
    assert.equal(r.body.id, 'new-0');
    assert.equal(w.inventory.find((x) => x.stock === 'DAV-2').status, status, 'the insert landed');
  }
});

test('N2: update_inventory → draft→published and published→draft land in the DB, no push', async () => {
  const w1 = makeWorld([unit('WTS-1', WTS, 'published'), unit('WTS-2', WTS, 'draft')]);
  const r1 = await call('update_inventory', { filterStock: 'WTS-2', dealer: WTS, status: 'published', price: '$9,000' });
  assertNoPush(w1, r1, 'draft→published');
  const row = w1.inventory.find((x) => x.stock === 'WTS-2');
  assert.equal(row.status, 'published'); assert.equal(row.price, '$9,000');
  const w2 = makeWorld([unit('FDT-1', FDT, 'published'), unit('FDT-2', FDT, 'published')]);
  const r2 = await call('update_inventory', { filterStock: 'FDT-2', dealer: FDT, status: 'draft' });
  assertNoPush(w2, r2, 'published→draft');
  assert.equal(w2.inventory.find((x) => x.stock === 'FDT-2').status, 'draft');
});

test('N3: toggle_featured, mark_sold, unmark_sold and remove_inventory → DB mutation, no push', async () => {
  const cases = [
    ['toggle_featured', { stock: 'DAV-1', featured: 1 }, (w) => assert.equal(w.inventory[0].featured, 1)],
    ['mark_sold', { stock: 'DAV-1', dealer: DAV }, (w) => assert.equal(w.inventory[0].sold, true)],
    ['unmark_sold', { stock: 'DAV-1', dealer: DAV }, (w) => assert.equal(w.inventory[0].sold, false)],
    ['remove_inventory', { stock: 'DAV-1', dealer: DAV }, (w) => assert.equal(w.inventory.length, 0)],
  ];
  for (const [op, data, check] of cases) {
    const w = makeWorld([unit('DAV-1', DAV, 'published', op === 'unmark_sold' ? { sold: true } : {})]);
    const r = await call(op, data);
    assertNoPush(w, r, op);
    check(w);
  }
});

test('N4: a dealer without a dealer site behaves identically (no push, no publish_log)', async () => {
  const w = makeWorld([unit('DBT-1', 'DeBary Truck Sales', 'published')]);
  assertNoPush(w, await call('update_inventory', { filterStock: 'DBT-1', dealer: 'DeBary Truck Sales', price: '$2' }), 'DBT update');
  assertNoPush(w, await call('create_inventory', { stock: 'DBT-2', dealer: 'DeBary Truck Sales', status: 'draft' }), 'DBT create');
});

test('N5: the push publisher and its config are gone; the pull feed keeps only the closed dealer-code map', () => {
  assert.throws(() => require('../lib/publish-to-dealer'), /Cannot find module/);
  assert.throws(() => require('../lib/dealer-publish-config'), /Cannot find module/);
  const codes = require('../lib/dealer-feed-codes');
  assert.deepEqual(Object.keys(codes).sort(), ['DEALERS', 'getDealerByCode']);
  for (const cfg of Object.values(codes.DEALERS)) assert.deepEqual(Object.keys(cfg), ['code']);
});

test('N6: no tracked source file references the retired push publisher, its tokens or its config', () => {
  const RETIRED_SERVER = ['publish-to-dealer', 'publishToDealerAndLog', 'lookupDealerByStock', 'PUBLISH_TOKEN', 'tokenEnvVar', 'functionUrl', 'dealer-publish-config', 'getDealerConfig'];
  const self = path.basename(__filename);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git', '.netlify'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.(js|cjs|mjs|html|json|toml)$/.test(e.name) && e.name !== self ? [p] : []);
  });
  for (const f of walk(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const id of RETIRED_SERVER) assert.ok(!src.includes(id), `${path.relative(ROOT, f)} still references ${id}`);
  }
});

// ---------------- photo-race amendment (Chief 2026-10-07) ----------------
const OLD_PHOTOS = [{ url: 'https://cdn.example/old.jpg', name: 'old' }];
const NEW_PHOTOS = [{ url: 'https://cdn.example/new1.jpg', name: 'n1' }, { url: 'https://cdn.example/new2.jpg', name: 'n2' }];
const urls = (u) => u.photos.map((p) => p.url);

test('S7: patch_inventory_photos → the new gallery lands in the DB, no push, no publish_log', async () => {
  const w = makeWorld([unit('DAV-1', DAV, 'published', { photos: OLD_PHOTOS })]);
  const r = await call('patch_inventory_photos', { stock: 'DAV-1', dealer: DAV, photos: NEW_PHOTOS });
  assertNoPush(w, r, 'photo patch');
  assert.deepEqual(urls(w.inventory[0]), NEW_PHOTOS.map((p) => p.url));
});

test('S8: a failed photo PATCH publishes nothing (DB error and refused empty list)', async () => {
  const w1 = makeWorld([unit('DAV-1', DAV, 'published', { photos: OLD_PHOTOS })], { patchStatus: 500 });
  const r1 = await call('patch_inventory_photos', { stock: 'DAV-1', dealer: DAV, photos: NEW_PHOTOS });
  assert.equal(r1.status, 500); assert.ok(!('publish' in r1.body));
  assert.equal(w1.dealerPosts.length, 0); assert.equal(w1.publishLog.length, 0);
  const w2 = makeWorld([unit('DAV-1', DAV, 'published', { photos: OLD_PHOTOS })]);
  const r2 = await call('patch_inventory_photos', { stock: 'DAV-1', dealer: DAV, photos: [] });
  assert.equal(r2.status, 409);
  assert.equal(w2.dealerPosts.length, 0); assert.equal(w2.publishLog.length, 0);
  assert.deepEqual(urls(w2.inventory[0]), OLD_PHOTOS.map((p) => p.url), 'gallery untouched');
});

test('S9: photo PATCH for a dealer without a dealer site → the photo write lands, no push, no publish_log', async () => {
  const w = makeWorld([unit('DBT-1', 'DeBary Truck Sales', 'published', { photos: OLD_PHOTOS })]);
  const r = await call('patch_inventory_photos', { stock: 'DBT-1', dealer: 'DeBary Truck Sales', photos: NEW_PHOTOS });
  assertNoPush(w, r, 'DBT photo patch');
  assert.deepEqual(urls(w.inventory[0]), NEW_PHOTOS.map((p) => p.url), 'the photo write itself still lands');
});

test('S10: a field + photo save converges in the DB on the new gallery and fields in either completion order; nothing is pushed', async () => {
  for (const order of [['update_inventory', 'patch_inventory_photos'], ['patch_inventory_photos', 'update_inventory']]) {
    const w = makeWorld([unit('WTS-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
    for (const op of order) {
      const r = op === 'update_inventory'
        ? await call(op, { filterStock: 'WTS-1', dealer: WTS, price: '$7,500' })
        : await call(op, { stock: 'WTS-1', dealer: WTS, photos: NEW_PHOTOS });
      assert.equal(r.status, 200, op);
    }
    assert.equal(w.dealerPosts.length, 0, order.join(' then ') + ': no dealer request');
    assert.equal(w.publishLog.length, 0, order.join(' then ') + ': no publish_log row');
    const final = w.inventory.find((u) => u.stock === 'WTS-1');
    assert.deepEqual(urls(final), NEW_PHOTOS.map((p) => p.url), order.join(' then ') + ': final gallery');
    assert.equal(final.price, '$7,500', order.join(' then ') + ': final price');
  }
  // The dealer sites read this committed state through the ADMIN pull feed (proven 2026-10-08/09).
});

// ---------------- client sequencing amendment (Chief 2026-10-07, final) ----------------
// The REAL existing-listing write block of saveListingEdits (between SAVE-EXISTING-WRITES markers) runs in a
// vm with the REAL getListingKey / photoListSignature; its fetch is routed to the REAL
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
  vm.runInNewContext(extractFn('getListingKey') + '\n' + extractFn('photoListSignature') +
    '\n;this.run = async function () {\n' + block + '\n};', ctx);
  return (async () => {
    await ctx.run();
    for (let k = 0; k < 50; k++) { await new Promise((r) => setTimeout(r, 5)); if (pending.size === 0) { await new Promise((r) => setTimeout(r, 5)); if (pending.size === 0) break; } }
    return requests;
  })();
}
const editedUnit = (over) => ({ dealer: WTS, year: '2020', make: 'X', model: 'Y', price: '$8,800', status: 'published', ...over });
const photoStateFor = (key, store, baselineList) => ({ state: { [key]: 'LOADED' }, store: { [key]: store }, baseline: { [key]: require('vm').runInNewContext(extractFn('photoListSignature') + ';photoListSignature(list)', { list: baselineList }) } });

test('A1: existing listing — stock rename OLD-1 → NEW-1 + field + gallery: update commits first, photo PATCH targets NEW-1, the DB row has NEW-1 + new field + new gallery', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const u = editedUnit({ stock: 'NEW-1', _originalStock: 'OLD-1' });
  const reqs = await runExistingSave(w, u, 'OLD-1', photoStateFor('NEW-1', NEW_PHOTOS, OLD_PHOTOS), { slowUpdateMs: 40 });
  assert.deepEqual(reqs.map((r) => r.operation), ['update_inventory', 'patch_inventory_photos'], 'update first, then photos');
  assert.equal(reqs[0].data.filterStock, 'OLD-1'); assert.equal(reqs[0].data.stock, 'NEW-1');
  assert.equal(reqs[1].data.stock, 'NEW-1', 'photo PATCH targets the renamed stock');
  const row = w.inventory.find((r) => r.stock === 'NEW-1');
  assert.ok(row && !w.inventory.find((r) => r.stock === 'OLD-1'), 'row renamed');
  assert.deepEqual(urls(row), NEW_PHOTOS.map((p) => p.url), 'gallery written to the renamed row');
  assert.deepEqual(w.inventory.map((x) => x.stock), ['NEW-1']);
  assert.equal(row.price, '$8,800', 'field edit landed on the renamed row');
  assert.equal(w.dealerPosts.length, 0, 'no dealer request'); assert.equal(w.publishLog.length, 0, 'no publish_log row');
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

test('A3: existing listing — unchanged gallery → update only; the field lands; nothing is pushed', async () => {
  const w = makeWorld([unit('WTS-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const reqs = await runExistingSave(w, editedUnit({ stock: 'WTS-1' }), 'WTS-1', photoStateFor('WTS-1', OLD_PHOTOS, OLD_PHOTOS));
  assert.deepEqual(reqs.map((r) => r.operation), ['update_inventory']);
  assert.equal(w.inventory[0].price, '$8,800'); assert.deepEqual(urls(w.inventory[0]), OLD_PHOTOS.map((p) => p.url));
  assert.equal(w.dealerPosts.length, 0); assert.equal(w.publishLog.length, 0);
});

test('S11: why the client must sequence — a photo PATCH sent before a stock rename matches zero rows yet succeeds, and the renamed row keeps the old gallery', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const p = await call('patch_inventory_photos', { stock: 'NEW-1', dealer: WTS, photos: NEW_PHOTOS });
  assert.equal(p.status, 200, 'PostgREST-style zero-row PATCH reports success');
  const r = await call('update_inventory', { filterStock: 'OLD-1', dealer: WTS, stock: 'NEW-1', price: '$8,800' });
  assert.equal(r.status, 200);
  const final = w.inventory[0];
  assert.equal(final.stock, 'NEW-1');
  assert.deepEqual(urls(final), OLD_PHOTOS.map((x) => x.url), 'stale gallery when photos go first — A1 proves the client now prevents this order');
});

// ---------------- identity-anchor correction (Chief 2026-10-07) ----------------
test('A4: after a successful OLD-1 → NEW-1 save, a second Save in the same open modal targets NEW-1 and the edit lands; VIN lock targets NEW-1', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })]);
  const u = editedUnit({ stock: 'NEW-1', _originalStock: 'OLD-1' });
  await runExistingSave(w, u, 'OLD-1', photoStateFor('NEW-1', OLD_PHOTOS, OLD_PHOTOS));
  assert.equal(u._originalStock, 'NEW-1', 'anchor advanced to the committed stock');
  u.price = '$9,900';                                   // second edit, same open modal
  const reqs = await runExistingSave(w, u, 'NEW-1', photoStateFor('NEW-1', OLD_PHOTOS, OLD_PHOTOS));
  assert.deepEqual(reqs.map((r) => r.operation), ['update_inventory']);
  assert.equal(reqs[0].data.filterStock, 'NEW-1', 'second save targets the renamed row');
  const row = w.inventory.find((r) => r.stock === 'NEW-1');
  assert.equal(row.price, '$9,900', 'the second edit actually landed');
  assert.equal(w.dealerPosts.length, 0); assert.equal(w.publishLog.length, 0);
  // Same anchor drives the VIN lock: the REAL toggleVinLock now targets NEW-1.
  const vinCalls = [];
  const vctx = {
    INVENTORY: [u], currentListingKey: 'NEW-1', DUPE_STOCKS: new Set(), getValidToken: async () => 't',
    confirm: () => true, alert() {}, renderVinLock() {}, document: { getElementById: () => null },
    fetch: async (url, opts) => { vinCalls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true, vin_locked: true }) }; },
  };
  u.vin_locked = false;
  vm.runInNewContext(extractFn('getListingKey') + '\n' + extractFn('toggleVinLock') + '\n;this.run = toggleVinLock;', vctx);
  await vctx.run();
  assert.equal(vinCalls.length, 1); assert.equal(vinCalls[0].operation, 'set_vin_lock');
  assert.equal(vinCalls[0].data.stock, 'NEW-1', 'VIN lock targets the renamed row');
});

test('A5: a failed rename leaves the anchor on OLD-1, and the retry renames OLD-1', async () => {
  const w = makeWorld([unit('OLD-1', WTS, 'published', { photos: OLD_PHOTOS, price: '$1' })], { patchStatus: 500 });
  const u = editedUnit({ stock: 'NEW-1', _originalStock: 'OLD-1' });
  const first = await runExistingSave(w, u, 'OLD-1', photoStateFor('NEW-1', OLD_PHOTOS, OLD_PHOTOS));
  assert.deepEqual(first.map((r) => r.operation), ['update_inventory']);
  assert.equal(u._originalStock, 'OLD-1', 'anchor not advanced after a failed update');
  w.patchStatus = 204;                                  // database recovers; user saves again
  const retry = await runExistingSave(w, u, 'NEW-1', photoStateFor('NEW-1', OLD_PHOTOS, OLD_PHOTOS));
  assert.equal(retry[0].data.filterStock, 'OLD-1', 'retry targets the row that still exists');
  assert.ok(w.inventory.find((r) => r.stock === 'NEW-1') && !w.inventory.find((r) => r.stock === 'OLD-1'), 'rename lands on retry');
  assert.equal(u._originalStock, 'NEW-1');
});
