'use strict';
// dealer-feed.test.js — public read-only dealer pull feed (Chief ruling 2026-10-07,
// design 14NqveYH0QuEmYu2FiPdnOvZgmIiPNJ_RJZjmG19z8xA, Decision 1).
// Run: node --test netlify/functions/__tests__/dealer-feed.test.js
// No network, no database: the REAL dealer-feed handler and the REAL buildDealerPayload run
// against an in-memory PostgREST fake that honors eq filters and records every request.
const test = require('node:test');
const assert = require('node:assert/strict');

const SVC = 'svc-secret-value-never-in-output';
process.env.SUPABASE_SERVICE_ROLE_KEY = SVC;

const { DEALERS, getDealerByCode } = require('../lib/dealer-feed-codes');
const { buildDealerPayload } = require('../lib/publish-payload');
const feed = require('../dealer-feed');

const WTS = 'Wilson Trailer Sales & Service';
const DAV = 'Davenport Motors';
const FDT = "Fat Daddy's Truck Sales";
const ATC = 'Auto Connection 210 LLC';

function row(over) {
  return {
    year: 2018, make: 'Peerless', model: null, trim: "45' Flat Floor", condition: 'Used', price: '$19,900',
    stock: 'X', created_at: '2026-09-01T00:00:00Z', fuel: null, vin: null, description: 'Key Details', mileage: null,
    photos: [{ url: 'https://example.test/a.jpg', name: 'a' }, { dataUrl: 'https://example.test/b.jpg' }, { name: 'no-url' }],
    engine: null, transmission: null, drivetrain: null, engine_description: null, transmission_description: null,
    category: 'Trailers', subcategory: 'Chip Trailer', featured: 0, video_url: null, sold: false, sold_type: null,
    status: 'published', dealer: WTS, ...over,
  };
}

const FIXTURE = [
  row({ stock: 'WTS-1', dealer: WTS }),
  row({ stock: 'WTS-SOLD', dealer: WTS, sold: true, sold_type: 'manual' }),
  row({ stock: 'WTS-DRAFT', dealer: WTS, status: 'draft' }),
  row({ stock: 'WTS-ARCH', dealer: WTS, status: 'archived' }),
  row({ stock: 'DAV-1', dealer: DAV, make: 'Ford', created_at: null }),
  row({ stock: 'DAV-DRAFT', dealer: DAV, status: 'draft' }),
  row({ stock: 'FDT-1', dealer: FDT, make: 'International', featured: 1 }),
  row({ stock: 'OTHER-1', dealer: 'Allied Truck & Trailer Sales' }),
  row({ stock: 'ATC-1', dealer: ATC, make: 'Ford', category: 'Trucks', subcategory: 'Box Truck' }),
  row({ stock: 'ATC-SOLD', dealer: ATC, make: 'Chevrolet', category: 'Trucks', sold: true, sold_type: 'manual' }),
  row({ stock: 'ATC-DRAFT', dealer: ATC, status: 'draft' }),
  row({ stock: 'ATC-ARCH', dealer: ATC, status: 'archived' }),
  row({ stock: 'ATC-NEARMISS', dealer: 'Auto Connection 210' }),
];

let requests = [];
let failNext = null;
function installFake(rows) {
  requests = [];
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    requests.push({ url, method, headers: opts.headers || {} });
    const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (failNext) { const f = failNext; failNext = null; return res({ message: f }, 500); }
    const m = url.match(/\/rest\/v1\/([a-z_]+)\?(.*)$/);
    if (!m || m[1] !== 'inventory' || method !== 'GET') return res({ error: 'unexpected ' + method + ' ' + url }, 500);
    const filters = [];
    for (const part of m[2].split('&')) {
      const i = part.indexOf('=');
      const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === 'select' || k === 'limit') continue;
      const d = v.indexOf('.');
      filters.push([k, v.slice(0, d), decodeURIComponent(v.slice(d + 1))]);
    }
    const out = rows.filter(r => filters.every(([k, op, val]) => op === 'eq' && r[k] != null && String(r[k]) === val));
    return res(JSON.parse(JSON.stringify(out)));
  };
}

const realNow = Date.now;
test.beforeEach(() => { installFake(FIXTURE); Date.now = () => Date.parse('2026-10-08T12:00:00Z'); });
test.afterEach(() => { Date.now = realNow; failNext = null; });

const get = (q) => feed.handler({ httpMethod: 'GET', queryStringParameters: q });

test('F1: closed code map — exactly ATC/DAV/FDT/WTS resolve, to the configured inventory.dealer values', () => {
  assert.equal(getDealerByCode('ATC'), ATC);
  assert.equal(getDealerByCode('WTS'), WTS);
  assert.equal(getDealerByCode('DAV'), DAV);
  assert.equal(getDealerByCode('FDT'), FDT);
  for (const bad of ['', 'wts', 'atc', 'ATT', 'AT', 'ATC1', 'WTS ', '__proto__', 'constructor', 'toString', null, undefined, 7]) {
    assert.equal(getDealerByCode(bad), null, `code ${String(bad)} must not resolve`);
  }
  assert.deepEqual(Object.values(DEALERS).map(c => c.code).sort(), ['ATC', 'DAV', 'FDT', 'WTS']);
});

test('F2: the dealer-code map carries only the closed feed codes — no push target or token fields remain', () => {
  assert.deepEqual(DEALERS, { [ATC]: { code: 'ATC' }, [DAV]: { code: 'DAV' }, [FDT]: { code: 'FDT' }, [WTS]: { code: 'WTS' } });
});

test('F3: unknown or missing dealer code -> 404, no-store, and no database call', async () => {
  for (const q of [{ dealer: 'ATT' }, { dealer: '' }, {}, null, { dealer: '__proto__' }, { dealer: 'Wilson Trailer Sales & Service' },
    { dealer: 'Auto Connection 210 LLC' }, { dealer: 'ATC1' }, { dealer: 'AT' }]) {
    requests = [];
    const r = await get(q);
    assert.equal(r.statusCode, 404);
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(r.body), { error: 'unknown_dealer' });
    assert.equal(requests.length, 0);
  }
});

test('F4: non-GET -> 405 no-store; OPTIONS -> 204', async () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await feed.handler({ httpMethod: m, queryStringParameters: { dealer: 'WTS' }, body: '[]' });
    assert.equal(r.statusCode, 405);
    assert.equal(r.headers['Cache-Control'], 'no-store');
  }
  const o = await feed.handler({ httpMethod: 'OPTIONS' });
  assert.equal(o.statusCode, 204);
  assert.equal(requests.length, 0);
});

test('F5: feed equivalence — body equals buildDealerPayload() for every configured dealer', async () => {
  for (const [code, name] of [['ATC', ATC], ['WTS', WTS], ['DAV', DAV], ['FDT', FDT]]) {
    const r = await get({ dealer: code });
    assert.equal(r.statusCode, 200);
    const expected = await buildDealerPayload(name, SVC);
    assert.deepEqual(JSON.parse(r.body), expected, `${code} feed differs from buildDealerPayload`);
    assert.equal(r.headers['X-Feed-Dealer'], code);
    assert.equal(r.headers['X-Feed-Count'], String(expected.length));
  }
});

test('F6: drafts and archived rows never appear; sold published rows appear with sold=true; other dealers excluded', async () => {
  const wts = JSON.parse((await get({ dealer: 'WTS' })).body);
  assert.deepEqual(wts.map(u => u.stock).sort(), ['WTS-1', 'WTS-SOLD']);
  assert.equal(wts.find(u => u.stock === 'WTS-SOLD').sold, true);
  const dav = JSON.parse((await get({ dealer: 'DAV' })).body);
  assert.deepEqual(dav.map(u => u.stock), ['DAV-1']);
  const fdt = JSON.parse((await get({ dealer: 'FDT' })).body);
  assert.deepEqual(fdt.map(u => u.stock), ['FDT-1']);
  const sel = requests.filter(q => q.url.includes('/rest/v1/inventory'));
  assert.ok(sel.every(q => q.url.includes('&status=eq.published')), 'every SELECT must carry status=eq.published');
});

test('F7: exactly the 27-key contract on every unit; lowercase code accepted', async () => {
  const KEYS = ['year', 'make', 'model', 'trim', 'condition', 'price', 'stock', 'days', 'fuel', 'vin', 'description', 'color',
    'mileage', 'hours', 'photos', 'engine', 'transmission', 'drivetrain', 'engine_description', 'transmission_description',
    'category', 'subcategory', 'siteTag', 'featured', 'video_url', 'sold', 'sold_type'].sort();
  const units = JSON.parse((await get({ dealer: 'wts' })).body);
  assert.ok(units.length > 0);
  for (const u of units) assert.deepEqual(Object.keys(u).sort(), KEYS);
  assert.equal(units[0].photos.length, 2, 'photos without a url are dropped exactly as the push builder does');
});

test('F8: success headers — JSON, CORS, 60 s CDN cache', async () => {
  const r = await get({ dealer: 'WTS' });
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.ok(!Number.isNaN(Date.parse(r.headers['X-Feed-Generated-At'])));
});

test('F9: database failure -> 502 no-store, generic body, no detail leaked', async () => {
  failNext = 'relation "inventory" exploded: secret detail';
  const quiet = console.error; console.error = () => {};
  try {
    const r = await get({ dealer: 'WTS' });
    assert.equal(r.statusCode, 502);
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(r.body), { error: 'feed_unavailable' });
    assert.ok(!r.body.includes('secret detail'));
  } finally { console.error = quiet; }
});

test('F10: missing service key -> 500 no-store and no database call', async () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const quiet = console.error; console.error = () => {};
  try {
    requests = [];
    const r = await get({ dealer: 'WTS' });
    assert.equal(r.statusCode, 500);
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(requests.length, 0);
  } finally { process.env.SUPABASE_SERVICE_ROLE_KEY = saved; console.error = quiet; }
});

test('F11: the feed never writes and never exposes the service key', async () => {
  for (const code of ['ATC', 'WTS', 'DAV', 'FDT', 'NOPE']) {
    const r = await get({ dealer: code });
    assert.ok(!r.body.includes(SVC));
    assert.ok(!JSON.stringify(r.headers).includes(SVC));
  }
  assert.ok(requests.every(q => q.method === 'GET'), 'only GET requests may leave the feed');
  assert.ok(requests.every(q => q.url.startsWith('https://bxsikkmqasydosmblzov.supabase.co/rest/v1/inventory?')));
});

test('F12: hours passes through raw (unparsed, 0 kept) right after mileage; mileage unchanged', async () => {
  installFake([
    row({ stock: 'H-1', dealer: DAV, mileage: '130476',  hours: '2387' }),
    row({ stock: 'H-2', dealer: DAV, mileage: '154,382', hours: '1,285' }),
    row({ stock: 'H-3', dealer: DAV, mileage: null,      hours: 0 }),
    row({ stock: 'H-4', dealer: DAV, mileage: '2387',    hours: null }),
  ]);
  const units = await buildDealerPayload(DAV, SVC);
  const by = Object.fromEntries(units.map(u => [u.stock, u]));
  assert.deepEqual(units.map(u => u.stock), ['H-1', 'H-2', 'H-3', 'H-4']);
  assert.ok(requests[0].url.includes(',mileage,hours,'), 'SELECT must request hours right after mileage');
  assert.equal(by['H-1'].hours, '2387');
  assert.equal(by['H-2'].hours, '1,285');
  assert.equal(by['H-3'].hours, 0);
  assert.equal(by['H-4'].hours, null);
  assert.equal(by['H-1'].mileage, '130476');
  assert.equal(by['H-2'].mileage, '154,382');
  assert.equal(by['H-3'].mileage, null);
  assert.equal(by['H-4'].mileage, '2387');
  for (const u of units) {
    const k = Object.keys(u);
    assert.equal(k[k.indexOf('mileage') + 1], 'hours');
  }
});

test('F13: ATC — only Auto Connection 210 LLC published rows (sold included, drafts/archived/near-miss dealer excluded), 27-key contract, exact dealer filter', async () => {
  requests = [];
  const r = await get({ dealer: 'ATC' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['X-Feed-Dealer'], 'ATC');
  const units = JSON.parse(r.body);
  assert.deepEqual(units.map(u => u.stock).sort(), ['ATC-1', 'ATC-SOLD']);
  assert.equal(units.find(u => u.stock === 'ATC-SOLD').sold, true);
  assert.equal(units.find(u => u.stock === 'ATC-1').sold, false);
  const KEYS = ['year', 'make', 'model', 'trim', 'condition', 'price', 'stock', 'days', 'fuel', 'vin', 'description', 'color',
    'mileage', 'hours', 'photos', 'engine', 'transmission', 'drivetrain', 'engine_description', 'transmission_description',
    'category', 'subcategory', 'siteTag', 'featured', 'video_url', 'sold', 'sold_type'].sort();
  for (const u of units) assert.deepEqual(Object.keys(u).sort(), KEYS);
  const sel = requests.filter(q => q.url.includes('/rest/v1/inventory'));
  assert.equal(sel.length, 1);
  assert.ok(sel[0].url.includes('dealer=eq.' + encodeURIComponent(ATC)), 'SELECT must filter on the exact inventory.dealer value');
  assert.ok(sel[0].url.includes('&status=eq.published'), 'SELECT must carry status=eq.published');
  const lower = await get({ dealer: 'atc' });
  assert.equal(lower.body, r.body, 'lowercase code resolves to the same feed');
});

test('F14: adding ATC leaves the WTS/DAV/FDT feed bodies byte-identical (with vs without ATC rows present)', async () => {
  const withAtc = {};
  for (const code of ['WTS', 'DAV', 'FDT']) withAtc[code] = (await get({ dealer: code })).body;
  installFake(FIXTURE.filter(r => r.dealer !== ATC && r.dealer !== 'Auto Connection 210'));
  for (const code of ['WTS', 'DAV', 'FDT']) {
    assert.equal((await get({ dealer: code })).body, withAtc[code], code + ' feed changed when ATC rows were present');
  }
});
