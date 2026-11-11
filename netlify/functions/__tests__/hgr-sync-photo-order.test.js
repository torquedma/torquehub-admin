'use strict';
// hgr-sync-photo-order.test.js - HST -324. Runs the real hgr-sync handler offline: https.get
// (feed XML), https.request (Supabase) and fetch (DX trigger) are replaced with in-memory
// fakes, so nothing leaves the process. Checks that an existing row's PATCH keeps the stored
// curated photo order (drops removed, appends added), that the existing-row read asks for
// photos, and that new rows (INSERT), locks, DX-field ownership and lifecycle fields are
// untouched. Run: node --test netlify/functions/__tests__/hgr-sync-photo-order.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');
const path = require('path');

const U = n => 'https://cdnmedia.endeavorsuite.com/images/x/inventory/1/DSCN' + n + '.JPG';
const P = n => ({ url: U(n), name: 'DSCN' + n + '.JPG' });
const names = a => a.map(p => p.name.slice(4, 8)).join(',');
const item = (stock, imgs, extra) => '<item><stocknumber>' + stock + '</stocknumber><price>2895</price><usage>New</usage>' +
  '<year>2027</year><manufacturer>Covered Wagon Trailers</manufacturer><model_name>6.5x14 Utility Trailer</model_name>' +
  '<model_type>Utility Trailer</model_type><description>Test</description>' + (extra || '') +
  imgs.map(n => '<imageurl>' + U(n) + '</imageurl>').join('') + '</item>';

function run(existingRows, xml) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-key';
  const calls = [];
  const origGet = https.get, origReq = https.request, origFetch = global.fetch;
  https.get = (url, cb) => { const res = new EventEmitter(); setImmediate(() => { cb(res); res.emit('data', xml); res.emit('end'); }); return new EventEmitter(); };
  https.request = (opts, cb) => {
    const req = new EventEmitter(); let body = '';
    req.write = d => { body += d; }; req.end = () => {
      calls.push({ method: opts.method, path: opts.path, body: body ? JSON.parse(body) : null });
      const res = new EventEmitter();
      setImmediate(() => { cb(res); res.statusCode = 200; res.emit('data', opts.method === 'GET' ? JSON.stringify(existingRows) : '[]'); res.emit('end'); });
    };
    return req;
  };
  global.fetch = async () => ({ status: 202 });
  const modPath = path.join(__dirname, '..', 'hgr-sync.js');
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  return mod.handler({}).then(r => { https.get = origGet; https.request = origReq; global.fetch = origFetch; return { r, calls }; });
}

const CURATED = [4173, 4175, 4174, 4176, 4180, 4181, 4178, 4179, 4177];
const FEED = [4177, 4173, 4175, 4174, 4176, 4178, 4180, 4181, 4179];
const ROW = (stock, photos, extra) => Object.assign({ stock, subcategory_locked: false, model_locked: false, vin_locked: false, sold: false,
  dx_locked: true, status: 'published', completion_state: 'complete', completion_attempts: 1, photos }, extra || {});

test('HP-1: the existing-row read selects photos', async () => {
  const { calls } = await run([], item('VF1', FEED));
  const get = calls.find(c => c.method === 'GET');
  assert.ok(/[&?]select=[^&]*\bphotos\b/.test(get.path), get.path);
});

test('HP-2: curated order kept on update; removed photo dropped; new photo appended; feed-order fallback without stored gallery', async () => {
  const rows = [ROW('HGR-VF115817', CURATED.map(P)), ROW('HGR-VF2', [5001, 5002].map(P)), ROW('HGR-VF3', null)];
  const xml = item('VF115817', FEED.filter(n => n !== 4179).concat([4190])) + item('VF2', [5002, 5001, 5003]) + item('VF3', [6002, 6001]) + item('VF9', [7002, 7001]);
  const { r, calls } = await run(rows, xml);
  assert.equal(r.statusCode, 200);
  const patch = s => calls.find(c => c.method === 'PATCH' && c.path.includes('stock=eq.' + encodeURIComponent(s)));
  assert.equal(names(patch('HGR-VF115817').body.photos), '4173,4175,4174,4176,4180,4181,4178,4177,4190');
  assert.equal(names(patch('HGR-VF2').body.photos), '5001,5002,5003');
  assert.equal(names(patch('HGR-VF3').body.photos), '6002,6001', 'no stored gallery: feed order');
  const post = calls.find(c => c.method === 'POST');
  assert.equal(names(post.body[0].photos), '7002,7001', 'INSERT keeps feed order');
  assert.equal(post.body[0].status, 'draft');
});

test('HP-3: unchanged feed set keeps the curated order; DX fields and lifecycle fields stay stripped', async () => {
  const rows = [ROW('HGR-VF115817', CURATED.map(P))];
  const { calls } = await run(rows, item('VF115817', FEED));
  const body = calls.find(c => c.method === 'PATCH').body;
  for (const k of ['description', 'description_source', 'torque_hub_dx', 'sold', 'sold_type', 'sold_date', 'status']) assert.ok(!(k in body), k + ' must not be written');
  assert.equal(names(body.photos), CURATED.join(','));
  assert.equal(body.photos.length, FEED.length);
});
