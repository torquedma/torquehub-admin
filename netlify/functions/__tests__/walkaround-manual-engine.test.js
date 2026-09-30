'use strict';
// walkaround-manual-engine.test.js — manual walkaround engine compatibility (Chief ruling: Option A).
// Run: node --test netlify/functions/__tests__/walkaround-manual-engine.test.js
// No network, no database: fetch is stubbed; the shipped client code is evaluated from index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';

const MANUAL = 'walkaround-v1.4-manual-adjudicated';
const GEB = 'walkaround-v1.5-opus-5-5-geb';
const V142 = 'walkaround-v1.4.2-fable-5-1-ep';

// ---------- shipped client: WA-CONTRACT block + the real loadWalkaroundReview ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const block = html.slice(html.indexOf('// WA-CONTRACT-START'), html.indexOf('// WA-CONTRACT-END'));
const loadStart = html.indexOf('async function loadWalkaroundReview()');
const loadFn = html.slice(loadStart, html.indexOf('\n}\n', loadStart) + 2);
const ui = {};
vm.runInNewContext(
  'let WALKAROUND_QUEUE_DATA = [];\n' + block + '\n' + loadFn +
  '\n;Object.assign(this.out, { WA_ENGINE_ORDER, waActionability, waSupersededBy, waVisibleRows, loadWalkaroundReview, queue: () => WALKAROUND_QUEUE_DATA });',
  {
    out: ui,
    document: { getElementById: () => null },
    getValidToken: async () => 't',
    renderWalkaroundQueue: () => {},
    alert: () => {},
    _waEscapeHtml: String,
    fetch: async (url, opts) => {
      const status = JSON.parse(opts.body).data.status;
      return { ok: true, status: 200, json: async () => ({ rows: ui.serverRows.filter(r => r.status === status) }) };
    },
  },
);

const DESC = 'Key Details\n- Year: 2016\n\nOverview\nCab and chassis.';
const BI = (o = {}) => Object.assign({
  version: '1.4', uncertainty_type: 'config', buyer_question: 'Q',
  torque_take: ['First paragraph.', 'Second paragraph.'],
  decision_factors: { makes_it_a_yes: ['Check one.', 'Check two.', 'Check three.', 'Check four.'], makes_it_a_yes_footer: 'Footer.' },
}, o);
const facts = (o = {}) => Object.assign({ stock: 'MAN-1', status: 'published', sold: false, has_live_bi: false, description: DESC }, o);
const row = (o = {}) => Object.assign({
  id: 'm1', stock: 'MAN-1', engine_version: MANUAL, status: 'approved',
  generated_bi: BI(), edited_bi: null, source_facts: facts(), hold: null,
}, o);

test('manual engine is last (newest) in the shipped WA_ENGINE_ORDER, directly after geb', () => {
  const order = [...ui.WA_ENGINE_ORDER];
  assert.equal(order[order.length - 1], MANUAL);
  assert.equal(order[order.length - 2], GEB);
});

test('T1: an approved manual row survives loadWalkaroundReview\'s engine filter', async () => {
  const manual = row();
  const unknown = row({ id: 'u1', engine_version: 'walkaround-v9-unknown' });
  ui.serverRows = [manual, unknown];
  await ui.loadWalkaroundReview();
  assert.deepEqual(ui.queue().map(r => r.id), ['m1']);
});

test('T2: manual row is actionable on a published, unsold, no-live-BI, unheld unit', () => {
  const manual = row();
  const a = ui.waActionability(manual, [manual]);
  assert.equal(a.ok, true);
  assert.equal(a.kind, 'ok');
});

test('T3: manual supersedes an older v1.4.2 generated row for the same stock', () => {
  const manual = row();
  const older = row({ id: 'o1', engine_version: V142, status: 'generated' });
  const all = [older, manual];
  assert.equal(ui.waSupersededBy(older, all), MANUAL);
  const a = ui.waActionability(older, all);
  assert.equal(a.ok, false);
  assert.equal(a.kind, 'superseded');
  assert.equal(ui.waSupersededBy(manual, all), null);
  assert.equal(ui.waActionability(manual, all).ok, true);
});

test('T4: manual supersedes an older geb row for the same stock', () => {
  const manual = row();
  const older = row({ id: 'o2', engine_version: GEB, status: 'generated' });
  const all = [older, manual];
  assert.equal(ui.waSupersededBy(older, all), MANUAL);
  assert.equal(ui.waActionability(older, all).kind, 'superseded');
  assert.equal(ui.waSupersededBy(manual, all), null);
  assert.equal(ui.waActionability(manual, all).ok, true);
});

test('T6: old v1.4.2 abstained row + manual approved row → exactly one actionable row, the manual one', () => {
  const abstained = row({ id: 'abs', engine_version: V142, status: 'generated', generated_bi: { abstain: true } });
  const manual = row();
  const all = [abstained, manual];
  assert.deepEqual(ui.waVisibleRows(all, false).map(r => r.id), ['m1']);
  assert.equal(all.filter(r => ui.waActionability(r, all).ok).length, 1);
});

// ---------- server: publish_walkaround engine acceptance (real admin-write handler) ----------
async function publish(queueRow, siblings) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, body: opts.body });
    const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return ok({ email: 'ryan@example.com' });
    if (url.includes('/walkaround_review_queue') && method === 'GET') return ok(url.includes('stock=eq.') ? siblings : [queueRow]);
    if (url.includes('/inventory') && method === 'GET') return ok([{ stock: queueRow.stock, status: 'published', sold: false, buyer_intelligence: null }]);
    if (url.includes('/bi_publication_hold')) return ok([]);
    if (url.includes('/inventory') && method === 'PATCH') return ok([{ stock: queueRow.stock }]);
    if (url.includes('/walkaround_review_queue') && method === 'PATCH') return ok(null);
    return ok([]);
  };
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation: 'publish_walkaround', data: { id: queueRow.id } }) });
  console.log = l; console.warn = w; console.error = e;
  return { res, body: JSON.parse(res.body), writes: calls.filter(c => c.method !== 'GET') };
}

test('T5: server publish accepts the manual label (over an older geb sibling) and still rejects walkaround-v9-unknown', async () => {
  const manual = { id: 'm1', stock: 'MAN-1', status: 'approved', review_outcome: 'published_unchanged', engine_version: MANUAL, generated_bi: BI(), edited_bi: null };
  const ok = await publish(manual, [
    { id: 'g1', engine_version: GEB, status: 'generated' },
    { id: 'm1', engine_version: MANUAL, status: 'approved' },
  ]);
  assert.equal(ok.res.statusCode, 200, JSON.stringify(ok.body));
  assert.ok(ok.writes.some(w => w.url.includes('/inventory')), 'inventory PATCH happened');

  const olderGeb = await publish({ ...manual, id: 'g1', engine_version: GEB }, [
    { id: 'g1', engine_version: GEB, status: 'approved' },
    { id: 'm1', engine_version: MANUAL, status: 'approved' },
  ]);
  assert.equal(olderGeb.res.statusCode, 409);
  assert.equal(olderGeb.body.error, 'unit_generation_superseded');
  assert.equal(olderGeb.body.newer_engine, MANUAL);
  assert.equal(olderGeb.writes.length, 0);

  const unknown = await publish({ ...manual, engine_version: 'walkaround-v9-unknown' }, []);
  assert.equal(unknown.res.statusCode, 409);
  assert.equal(unknown.body.error, 'unsupported_engine');
  assert.equal(unknown.writes.length, 0);
});
