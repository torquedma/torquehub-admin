'use strict';
// walkaround-outcome.test.js — publish fails closed without a recorded review_outcome;
// pre-approved cards persist the selected outcome first (Chief 2026-09-30).
// Run: node --test netlify/functions/__tests__/walkaround-outcome.test.js
// No network, no database: the REAL client functions from index.html run in a vm and call the
// REAL admin-write handler, whose Supabase REST calls hit an in-memory table fake that records writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';

// ---------- in-memory PostgREST fake ----------
function makeDb(tables) {
  const db = { tables: JSON.parse(JSON.stringify(tables)), writes: [] };
  const match = (row, filters) => filters.every(([k, op, v]) =>
    op === 'is' ? (v === 'null' ? row[k] == null : String(row[k]) === v)
      : op === 'eq' ? row[k] != null && String(row[k]) === v
        : op === 'neq' ? String(row[k]) !== v : false);
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return res({ email: 'ryan@example.com' });
    const m = url.match(/\/rest\/v1\/([a-z_]+)\?(.*)$/);
    if (!m) return res({ error: 'unexpected url ' + url }, 500);
    const [, table, qs] = m;
    const filters = [];
    for (const part of qs.split('&')) {
      const i = part.indexOf('=');
      const k = part.slice(0, i), val = part.slice(i + 1);
      if (k === 'select') continue;
      const d = val.indexOf('.');
      filters.push([k, val.slice(0, d), decodeURIComponent(val.slice(d + 1))]);
    }
    const rows = (db.tables[table] || []).filter(r => match(r, filters));
    if (method === 'GET') return res(JSON.parse(JSON.stringify(rows)));
    if (method === 'PATCH') {
      if (db.failPatch && db.failPatch(table)) return res({ error: 'patch failed' }, 500);
      const body = JSON.parse(opts.body);
      db.writes.push({ table, url, body });
      for (const r of rows) Object.assign(r, body);
      return res((opts.headers && /return=representation/.test(opts.headers.Prefer || '')) ? JSON.parse(JSON.stringify(rows)) : null);
    }
    return res({ error: 'unexpected method' }, 500);
  };
  return db;
}

async function callServer(operation, data) {
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  try {
    const r = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation, data }) });
    return { ok: r.statusCode < 400, status: r.statusCode, body: JSON.parse(r.body) };
  } finally { console.log = l; console.warn = w; console.error = e; }
}

// ---------- shipped client code (vm) ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const block = html.slice(html.indexOf('// WA-CONTRACT-START'), html.indexOf('// WA-CONTRACT-END'));
function fnSrc(name) {
  let i = html.indexOf('\nasync function ' + name + '(');
  if (i < 0) i = html.indexOf('\nfunction ' + name + '(');
  assert.ok(i >= 0, 'function not found in index.html: ' + name);
  const firstLine = html.slice(i + 1, html.indexOf('\n', i + 1));
  if (/\}\s*$/.test(firstLine)) return firstLine + '\n';   // one-line function
  return html.slice(i + 1, html.indexOf('\n}\n', i) + 2);
}
const outcomesSrc = html.slice(html.indexOf('const WALKAROUND_REVIEW_OUTCOMES = ['), html.indexOf('];', html.indexOf('const WALKAROUND_REVIEW_OUTCOMES = [')) + 2);

function loadClient(queueRows) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, value: '', disabled: false, textContent: '', style: {} });
  const ctx = {
    out: {}, calls: [], reloads: 0,
    document: { getElementById: el },
    alert: () => {}, _waToast: () => {}, _waBumpSession: () => {},
  };
  ctx._waAuthFetch = async (op, data) => { ctx.calls.push({ op, data }); return callServer(op, data); };
  ctx.loadWalkaroundReview = async () => { ctx.reloads++; };
  vm.createContext(ctx);
  vm.runInContext(
    'let WALKAROUND_QUEUE_DATA = [];\n' + outcomesSrc + '\n' + block + '\n' +
    ['_waEscapeHtml', 'waGetShape', '_waRenderCard', '_waShowMsg', 'waApproveAndPublish', 'publishWalkaround'].map(fnSrc).join('\n') +
    '\n;this.out.setQueue = (rows) => { WALKAROUND_QUEUE_DATA = rows; };' +
    '\nObject.assign(this.out, { _waRenderCard, waApproveAndPublish });', ctx);
  ctx.out.setQueue(queueRows);
  // Render each card and put the selector's initial value where the page would.
  for (const r of queueRows) {
    const card = ctx.out._waRenderCard(r);
    const sel = card.match(/<option value="([^"]+)" selected>/);
    el('wa-outcome-' + r.id).value = sel ? sel[1] : '';
    ctx.renderedCard = card;
  }
  return { ctx, el };
}

// ---------- fixtures ----------
const BI = (o = {}) => Object.assign({
  version: '1.4', uncertainty_type: 'config', buyer_question: 'Q',
  torque_take: ['First paragraph.', 'Second paragraph.'],
  decision_factors: { makes_it_a_yes: ['Check one.', 'Check two.', 'Check three.', 'Check four.'], makes_it_a_yes_footer: 'Footer.' },
}, o);
const REVIEWED_AT = '2026-09-29T18:00:00.000Z';
const MANUAL = 'walkaround-v1.4-manual-adjudicated';
const qrow = (o = {}) => Object.assign({
  id: 'm1', stock: 'MAN-1', engine_version: MANUAL, status: 'approved', review_outcome: null, reviewed_at: REVIEWED_AT,
  generated_bi: BI({ torque_take: ['GENERATED'] }), edited_bi: null,
}, o);
const tables = (row) => ({
  walkaround_review_queue: [row],
  inventory: [{ stock: row.stock, status: 'published', sold: false, buyer_intelligence: null }],
  bi_publication_hold: [],
});
// What admin-read ships to the page for the same row.
const clientRow = (row) => Object.assign({}, row, {
  source_facts: { stock: row.stock, status: 'published', sold: false, has_live_bi: false, description: '' }, hold: null,
});

test('T1: pre-approved manual row, generated_bi only, outcome NULL → published_unchanged recorded first, then publish; reviewed_at unchanged', async () => {
  const row = qrow();
  const db = makeDb(tables(row));
  const { ctx } = loadClient([clientRow(row)]);
  await ctx.out.waApproveAndPublish('m1');
  assert.deepEqual(ctx.calls.map(c => c.op), ['review_walkaround', 'publish_walkaround']);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls[0].data)), { id: 'm1', status: 'approved', review_outcome: 'published_unchanged' });
  const q = db.tables.walkaround_review_queue[0];
  assert.equal(q.review_outcome, 'published_unchanged');
  assert.equal(q.reviewed_at, REVIEWED_AT);
  assert.equal(q.status, 'published');
  assert.deepEqual(db.tables.inventory[0].buyer_intelligence, row.generated_bi);
  // the outcome write touched review_outcome only
  assert.deepEqual(db.writes[0], { table: 'walkaround_review_queue', url: db.writes[0].url, body: { review_outcome: 'published_unchanged' } });
  assert.match(db.writes[0].url, /status=eq\.approved&review_outcome=is\.null/);
  assert.equal(ctx.reloads, 1);
});

test('T1b: if recording the outcome fails, nothing is published', async () => {
  const row = qrow();
  const db = makeDb(tables(row));
  db.failPatch = (t) => t === 'walkaround_review_queue';
  const { ctx } = loadClient([clientRow(row)]);
  await ctx.out.waApproveAndPublish('m1');
  assert.deepEqual(ctx.calls.map(c => c.op), ['review_walkaround']);
  assert.equal(db.tables.inventory[0].buyer_intelligence, null);
  assert.equal(db.tables.walkaround_review_queue[0].review_outcome, null);
});

test('T2: pre-approved manual row with edited_bi, outcome NULL → minor_wording_edit recorded (reviewed_at unchanged); edited_bi publishes', async () => {
  const row = qrow({ edited_bi: BI({ torque_take: ['EDITED'] }) });
  const db = makeDb(tables(row));
  const { ctx } = loadClient([clientRow(row)]);
  await ctx.out.waApproveAndPublish('m1');
  assert.deepEqual(ctx.calls.map(c => c.op), ['review_walkaround', 'publish_walkaround']);
  assert.equal(ctx.calls[0].data.review_outcome, 'minor_wording_edit');
  const q = db.tables.walkaround_review_queue[0];
  assert.equal(q.review_outcome, 'minor_wording_edit');
  assert.equal(q.reviewed_at, REVIEWED_AT);
  assert.deepEqual(db.tables.inventory[0].buyer_intelligence, row.edited_bi);
});

test('T3: an existing review_outcome is what the selector shows, and publishing does not overwrite it', async () => {
  const row = qrow({ edited_bi: BI({ torque_take: ['EDITED'] }), review_outcome: 'buyer_insight_changed' });
  const db = makeDb(tables(row));
  const { ctx, el } = loadClient([clientRow(row)]);
  assert.match(ctx.renderedCard, /<option value="buyer_insight_changed" selected>/);
  assert.doesNotMatch(ctx.renderedCard, /<option value="minor_wording_edit" selected>/);
  assert.equal(el('wa-outcome-m1').value, 'buyer_insight_changed');
  await ctx.out.waApproveAndPublish('m1');
  assert.deepEqual(ctx.calls.map(c => c.op), ['publish_walkaround']);
  const q = db.tables.walkaround_review_queue[0];
  assert.equal(q.review_outcome, 'buyer_insight_changed');
  assert.equal(q.reviewed_at, REVIEWED_AT);
  assert.equal(q.status, 'published');
  assert.ok(db.writes.every(w => !('review_outcome' in w.body)), 'no write touches review_outcome');
});

test('T3b: changing the selector away from a recorded outcome does not publish or write anything', async () => {
  const row = qrow({ review_outcome: 'buyer_insight_changed' });
  const db = makeDb(tables(row));
  const { ctx, el } = loadClient([clientRow(row)]);
  el('wa-outcome-m1').value = 'published_unchanged';
  await ctx.out.waApproveAndPublish('m1');
  assert.deepEqual(ctx.calls, []);
  assert.equal(db.writes.length, 0);
  assert.match(el('wa-msg-m1').textContent, /already recorded as 'buyer_insight_changed'/);
});

test('T4: server publish_walkaround with review_outcome NULL → rejected, zero inventory and zero queue writes', async () => {
  const db = makeDb(tables(qrow()));
  const r = await callServer('publish_walkaround', { id: 'm1' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /review_outcome_missing/);
  assert.equal(db.writes.length, 0);
  assert.equal(db.tables.inventory[0].buyer_intelligence, null);
  assert.equal(db.tables.walkaround_review_queue[0].status, 'approved');
});

test('T5: server publish_walkaround with an out-of-taxonomy review_outcome → rejected, zero writes', async () => {
  for (const bad of ['looks_good', '', 'PUBLISHED_UNCHANGED']) {
    const db = makeDb(tables(qrow({ review_outcome: bad })));
    const r = await callServer('publish_walkaround', { id: 'm1' });
    assert.equal(r.status, 409, bad);
    assert.match(r.body.error, /review_outcome_(invalid|missing)/, bad);
    assert.equal(db.writes.length, 0, bad);
    assert.equal(db.tables.inventory[0].buyer_intelligence, null, bad);
  }
});

test('T6: server review_walkaround on an approved row with an outcome already set: different → 409 no change; same → ok, no write', async () => {
  const db = makeDb(tables(qrow({ review_outcome: 'buyer_insight_changed' })));
  const diff = await callServer('review_walkaround', { id: 'm1', status: 'approved', review_outcome: 'published_unchanged' });
  assert.equal(diff.status, 409);
  assert.match(diff.body.error, /already recorded as 'buyer_insight_changed'/);
  const same = await callServer('review_walkaround', { id: 'm1', status: 'approved', review_outcome: 'buyer_insight_changed' });
  assert.equal(same.status, 200);
  assert.equal(db.writes.length, 0);
  assert.deepEqual(db.tables.walkaround_review_queue[0], qrow({ review_outcome: 'buyer_insight_changed' }));
});

test('T6b: review_walkaround on a not-yet-approved row is unchanged — status, outcome and reviewed_at are written', async () => {
  const db = makeDb(tables(qrow({ status: 'generated' })));
  const r = await callServer('review_walkaround', { id: 'm1', status: 'approved', review_outcome: 'minor_wording_edit' });
  assert.equal(r.status, 200);
  assert.equal(db.writes.length, 1);
  assert.deepEqual(Object.keys(db.writes[0].body).sort(), ['review_outcome', 'reviewed_at', 'status']);
  const q = db.tables.walkaround_review_queue[0];
  assert.equal(q.status, 'approved');
  assert.equal(q.review_outcome, 'minor_wording_edit');
  assert.notEqual(q.reviewed_at, REVIEWED_AT);
});

test('T7: existing guards still hold with a recorded outcome (held unit, superseded row, live-BI overwrite)', async () => {
  const held = makeDb(Object.assign(tables(qrow({ review_outcome: 'published_unchanged' })), { bi_publication_hold: [{ stock: 'MAN-1', reason: 'Chief hold' }] }));
  assert.equal((await callServer('publish_walkaround', { id: 'm1' })).body.error, 'unit_held');
  assert.equal(held.writes.length, 0);

  const sup = makeDb(tables(qrow({ engine_version: 'walkaround-v1.5-opus-5-5-geb', review_outcome: 'published_unchanged' })));
  sup.tables.walkaround_review_queue.push({ id: 'm2', stock: 'MAN-1', engine_version: MANUAL, status: 'generated' });
  assert.equal((await callServer('publish_walkaround', { id: 'm1' })).body.error, 'unit_generation_superseded');
  assert.equal(sup.writes.length, 0);

  const live = makeDb(tables(qrow({ review_outcome: 'published_unchanged' })));
  live.tables.inventory[0].buyer_intelligence = BI({ torque_take: ['LIVE'] });
  assert.equal((await callServer('publish_walkaround', { id: 'm1' })).body.error, 'unit_has_live_bi');
  assert.equal(live.writes.length, 0);
});
