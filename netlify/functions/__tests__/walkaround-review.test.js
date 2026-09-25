'use strict';
// walkaround-review.test.js — ADMIN Walkaround Review modernization (Chief GO 2026-09-25).
// Run: node --test netlify/functions/__tests__/walkaround-review.test.js
// No network, no database: fetch is stubbed; the UI contract is evaluated from index.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';

// ---------- UI contract (WA-CONTRACT block from index.html) ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const block = html.slice(html.indexOf('// WA-CONTRACT-START'), html.indexOf('// WA-CONTRACT-END'));
const ui = {};
vm.runInNewContext(block + '\n;Object.assign(this.out, { WA_CURRENT_ENGINES, WA_LEGACY_ENGINES, waPublishPayload, waActionability, waQueueOrder, waModernPreview, waStatusBanner, waKeyDetails, waSupersededBy, waHeroImage, waDefaultOutcome, waVisibleRows });', { out: ui });

const DESC = 'Key Details\n- Year: 2016\n- Make: Hino\n- Stock #: DBT-7800 P\n\nOverview\nCab and chassis with an Allison automatic.';
const BI = (o = {}) => Object.assign({
  version: '1.4', uncertainty_type: 'config', buyer_question: 'INTERNAL QUESTION MUST NOT RENDER',
  torque_take: ['First paragraph must render.', 'Second paragraph must render.'],
  decision_factors: { makes_it_a_yes: ['Check one.', 'Check two.', 'Check three.', 'Check four.'], makes_it_a_yes_footer: 'Footer line.' },
}, o);
const row = (o = {}) => Object.assign({
  id: 'q1', stock: 'DBT-7800 P', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', status: 'generated',
  generated_bi: BI({ torque_take: ['GENERATED TEXT'] }), edited_bi: BI(),
  source_facts: { stock: 'DBT-7800 P', status: 'published', sold: false, has_live_bi: false, description: DESC }, hold: null,
}, o);
const facts = (o) => Object.assign({ stock: 'X', status: 'published', sold: false, has_live_bi: false, description: DESC }, o);

test('engine contract: the three current engines and two legacy engines', () => {
  assert.deepEqual([...ui.WA_CURRENT_ENGINES], ['walkaround-v1.4.2-fable-5-1-ep', 'walkaround-v1.4.3-fable-5-1-ep', 'walkaround-v1.5-opus-5-5-geb']);
  assert.deepEqual([...ui.WA_LEGACY_ENGINES], ['walkaround-v1.2-text', 'walkaround-v1.3-text']);
});

test('five-unit cohort shape: clean current row is actionable; edited_bi is what publishes', () => {
  const r = row();
  assert.equal(ui.waActionability(r).ok, true);
  assert.equal(ui.waPublishPayload(r), r.edited_bi);
  assert.deepEqual(ui.waPublishPayload(row({ edited_bi: null })).torque_take, ['GENERATED TEXT']);
  assert.match(ui.waStatusBanner(r), /Publishes: <strong[^>]*>edited_bi/);
  assert.doesNotMatch(ui.waStatusBanner(r), /Not publishable/);
});

test('blocked rows: live BI, sold, unpublished, held, abstain, missing inventory — each named', () => {
  const cases = [
    [row({ source_facts: facts({ has_live_bi: true }) }), 'live_bi'],
    [row({ source_facts: facts({ sold: true }) }), 'sold'],
    [row({ source_facts: facts({ status: 'draft' }) }), 'not_published'],
    [row({ hold: { reason: 'Chief-held proof unit (Draft-to-Live Phase 1)', held_by: 'Chief Foreman' } }), 'held'],
    [row({ edited_bi: null, generated_bi: { abstain: true } }), 'abstain'],
    [row({ source_facts: null }), 'no_inventory'],
  ];
  for (const [r, kind] of cases) {
    const a = ui.waActionability(r);
    assert.equal(a.ok, false, kind);
    assert.equal(a.kind, kind);
    assert.match(ui.waStatusBanner(r), /Not publishable/);
  }
  assert.match(ui.waActionability(cases[3][0]).reason, /HELD — Chief-held proof unit/);
});

test('stale legacy row cannot overwrite newer live BI', () => {
  const legacy = row({ engine_version: 'walkaround-v1.2-text', source_facts: facts({ has_live_bi: true }) });
  assert.equal(ui.waActionability(legacy).ok, false);
  assert.equal(ui.waActionability(legacy).kind, 'live_bi');
});

test('modern preview = Key Details → Torque Take (all paragraphs) → Buyer Checklist; no Meet split, no buyer_question', () => {
  const htmlOut = ui.waModernPreview(BI(), facts({}));
  const iKD = htmlOut.indexOf('Key Details'), iTT = htmlOut.indexOf('Torque Take'), iBC = htmlOut.indexOf('Buyer Checklist');
  assert.ok(iKD >= 0 && iTT > iKD && iBC > iTT, 'card order');
  assert.match(htmlOut, /First paragraph must render\./);
  assert.match(htmlOut, /Second paragraph must render\./);
  assert.match(htmlOut, /What a good one should show:/);
  for (const c of ['Check one.', 'Check two.', 'Check three.', 'Check four.', 'Footer line.', 'Year: 2016', 'Stock #: DBT-7800 P', 'Cab and chassis with an Allison automatic.']) assert.ok(htmlOut.includes(c), c);
  assert.doesNotMatch(htmlOut, /Meet the/);
  assert.doesNotMatch(htmlOut, /INTERNAL QUESTION/);
  assert.match(ui.waModernPreview(BI({ title: 'Custom Heading' }), facts({})), /Custom Heading/);
  assert.doesNotMatch(ui.waModernPreview(BI({ torque_take: ['<script>x</script>'] }), facts({})), /<script>/);
});

test('queue order: actionable first, then current non-actionable, then legacy', () => {
  const a = row({ id: 'a', stock: 'B' });
  const c = row({ id: 'c', stock: 'A', source_facts: facts({ has_live_bi: true }) });
  const l = row({ id: 'l', stock: 'A', engine_version: 'walkaround-v1.3-text', source_facts: facts({ has_live_bi: true }) });
  assert.deepEqual([l, c, a].sort(ui.waQueueOrder).map(r => r.id), ['a', 'c', 'l']);
});

// ---------- server: publish_walkaround gate ----------
function stubFetch(state) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, body: opts.body });
    const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return ok({ email: 'ryan@example.com' });
    if (url.includes('/walkaround_review_queue') && method === 'GET') {
      if (url.includes('stock=eq.')) return state.sibFail ? ok({ error: 'x' }, 500) : ok(state.siblings || [{ id: state.queueRow.id, engine_version: state.queueRow.engine_version, status: state.queueRow.status }]);
      return ok([state.queueRow]);
    }
    if (url.includes('/inventory') && method === 'GET') return ok([state.unit]);
    if (url.includes('/bi_publication_hold')) return state.holdFail ? ok({ error: 'x' }, 500) : ok(state.holds || []);
    if (url.includes('/inventory') && method === 'PATCH') return ok(state.patchReturns !== undefined ? state.patchReturns : [{ stock: state.unit.stock }]);
    if (url.includes('/walkaround_review_queue') && method === 'PATCH') return ok(null);
    return ok([]);
  };
  return calls;
}
async function publish(state) {
  const calls = stubFetch(state);
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation: 'publish_walkaround', data: { id: 'q1' } }) });
  console.log = l; console.warn = w; console.error = e;
  return { res, body: JSON.parse(res.body), calls, writes: calls.filter(c => c.method !== 'GET') };
}
const QROW = { id: 'q1', stock: 'DBT-7800 P', status: 'approved', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', generated_bi: BI({ torque_take: ['G'] }), edited_bi: BI() };
const UNIT = { stock: 'DBT-7800 P', status: 'published', sold: false, buyer_intelligence: null };

test('server: clean unit publishes edited_bi; the inventory write re-asserts the gate in its filter', async () => {
  const r = await publish({ queueRow: QROW, unit: UNIT });
  assert.equal(r.res.statusCode, 200, JSON.stringify(r.body));
  const inv = r.writes.find(w => w.url.includes('/inventory'));
  assert.ok(inv, 'inventory PATCH happened');
  assert.match(inv.url, /status=eq\.published&sold=eq\.false&buyer_intelligence=is\.null/);
  assert.deepEqual(JSON.parse(inv.body), { buyer_intelligence: QROW.edited_bi });
});

for (const [name, unit, holds, err] of [
  ['live BI', { ...UNIT, buyer_intelligence: { version: '1.4' } }, [], 'unit_has_live_bi'],
  ['sold', { ...UNIT, sold: true }, [], 'unit_sold'],
  ['not published', { ...UNIT, status: 'draft' }, [], 'unit_not_published'],
  ['held', UNIT, [{ stock: 'DBT-7800 P', reason: 'Chief-held proof unit (Draft-to-Live Phase 1)' }], 'unit_held'],
]) {
  test(`server: ${name} → 409 ${err}, no writes`, async () => {
    const r = await publish({ queueRow: QROW, unit, holds });
    assert.equal(r.res.statusCode, 409);
    assert.equal(r.body.error, err);
    assert.equal(r.writes.length, 0, JSON.stringify(r.writes));
  });
}

test('server: hold read failure fails closed (500), no writes', async () => {
  const r = await publish({ queueRow: QROW, unit: UNIT, holdFail: true });
  assert.equal(r.res.statusCode, 500);
  assert.equal(r.writes.length, 0);
});

test('server: unit changes state between read and write → 409 unit_state_changed, queue row untouched', async () => {
  const r = await publish({ queueRow: QROW, unit: UNIT, patchReturns: [] });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.body.error, 'unit_state_changed');
  assert.equal(r.writes.filter(w => w.url.includes('/walkaround_review_queue')).length, 0);
});

// ---------- server: admin-read read model ----------
test('read model: has_live_bi boolean (BI stripped), hold attached, hold failure fails closed', async () => {
  const run = async (holdFail) => {
    global.fetch = async (url) => {
      const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => '' });
      if (url.includes('/auth/v1/user')) return ok({ email: 'ryan@example.com' });
      if (url.includes('/walkaround_review_queue')) return ok([{ id: 'q1', stock: 'ATT-592063' }, { id: 'q2', stock: 'DBT-7802' }]);
      if (url.includes('/inventory')) return ok([{ stock: 'ATT-592063', status: 'published', sold: false, buyer_intelligence: null }, { stock: 'DBT-7802', status: 'published', sold: false, buyer_intelligence: { a: 1 } }]);
      if (url.includes('/bi_publication_hold')) return holdFail ? ok(null, 500) : ok([{ stock: 'ATT-592063', reason: 'Chief-held proof unit (Draft-to-Live Phase 1)', held_by: 'Chief Foreman' }]);
      return ok([]);
    };
    delete require.cache[require.resolve('../admin-read.js')];
    const { handler } = require('../admin-read.js');
    const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation: 'get_walkaround_queue', data: {} }) });
    return { res, body: JSON.parse(res.body) };
  };
  const r = await run(false);
  assert.equal(r.res.statusCode, 200);
  const [held, live] = r.body.rows;
  assert.equal(held.hold.reason, 'Chief-held proof unit (Draft-to-Live Phase 1)');
  assert.equal(held.source_facts.has_live_bi, false);
  assert.equal(live.hold, null);
  assert.equal(live.source_facts.has_live_bi, true);
  assert.ok(!('buyer_intelligence' in live.source_facts), 'BI payload not shipped to the browser');
  assert.equal(ui.waActionability({ ...held, edited_bi: BI() }).kind, 'held');
  assert.equal(ui.waActionability({ ...live, edited_bi: BI() }).kind, 'live_bi');
  const f = await run(true);
  assert.equal(f.res.statusCode, 502);
});

test('superseded: only the newest supported generation per stock is actionable (DBT-7858, JOE-12647742 cases)', () => {
  const v142 = row({ id: 'old', stock: 'DBT-7858', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', edited_bi: null });
  const v143 = row({ id: 'new', stock: 'DBT-7858', engine_version: 'walkaround-v1.4.3-fable-5-1-ep' });
  const all = [v142, v143];
  assert.equal(ui.waActionability(v143, all).ok, true);
  const a = ui.waActionability(v142, all);
  assert.equal(a.ok, false); assert.equal(a.kind, 'superseded'); assert.match(a.reason, /v1\.4\.3/);
  const legacy = row({ id: 'v12', stock: 'JOE-12647742', engine_version: 'walkaround-v1.2-text', edited_bi: null });
  const abstained = row({ id: 'abs', stock: 'JOE-12647742', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', edited_bi: null, generated_bi: { abstain: true } });
  assert.equal(ui.waActionability(legacy, [legacy, abstained]).kind, 'superseded');
  assert.equal(ui.waActionability(abstained, [legacy, abstained]).kind, 'abstain');
});

test('server: superseded generation → 409 unit_generation_superseded, no writes (newer abstention counts)', async () => {
  const oldRow = { ...QROW, id: 'q-old', stock: 'DBT-7858', engine_version: 'walkaround-v1.4.2-fable-5-1-ep' };
  const r1 = await publish({ queueRow: oldRow, unit: { ...UNIT, stock: 'DBT-7858' }, siblings: [
    { id: 'q-old', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', status: 'approved' },
    { id: 'q-new', engine_version: 'walkaround-v1.4.3-fable-5-1-ep', status: 'generated' },
    { id: 'q-v141', engine_version: 'walkaround-v1.4.1-fable-5-1-ep', status: 'generated' } ] });
  assert.equal(r1.res.statusCode, 409);
  assert.equal(r1.body.error, 'unit_generation_superseded');
  assert.equal(r1.body.newer_engine, 'walkaround-v1.4.3-fable-5-1-ep');
  assert.equal(r1.writes.length, 0);
  const legacy = { ...QROW, id: 'q-v12', stock: 'JOE-12647742', engine_version: 'walkaround-v1.2-text' };
  const r2 = await publish({ queueRow: legacy, unit: { ...UNIT, stock: 'JOE-12647742' }, siblings: [
    { id: 'q-v12', engine_version: 'walkaround-v1.2-text', status: 'approved' },
    { id: 'q-abs', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', status: 'generated' } ] });
  assert.equal(r2.res.statusCode, 409);
  assert.equal(r2.body.error, 'unit_generation_superseded');
  assert.equal(r2.writes.length, 0);
});

test('server: newest generation publishes even with older siblings; unsupported engine and sibling-read failure fail closed', async () => {
  const newest = { ...QROW, id: 'q-new', stock: 'DBT-7858', engine_version: 'walkaround-v1.4.3-fable-5-1-ep' };
  const ok = await publish({ queueRow: newest, unit: { ...UNIT, stock: 'DBT-7858' }, siblings: [
    { id: 'q-old', engine_version: 'walkaround-v1.4.2-fable-5-1-ep', status: 'generated' },
    { id: 'q-new', engine_version: 'walkaround-v1.4.3-fable-5-1-ep', status: 'approved' } ] });
  assert.equal(ok.res.statusCode, 200, JSON.stringify(ok.body));
  const unsup = await publish({ queueRow: { ...QROW, engine_version: 'walkaround-v1.4.1-fable-5-1-ep' }, unit: UNIT });
  assert.equal(unsup.res.statusCode, 409);
  assert.equal(unsup.body.error, 'unsupported_engine');
  assert.equal(unsup.writes.length, 0);
  const fail = await publish({ queueRow: QROW, unit: UNIT, sibFail: true });
  assert.equal(fail.res.statusCode, 500);
  assert.equal(fail.writes.length, 0);
});

test('engine order parity: server WALKAROUND_ENGINE_ORDER equals page WA_ENGINE_ORDER', () => {
  const src = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'admin-write.js'), 'utf8');
  const m = src.match(/const WALKAROUND_ENGINE_ORDER = \[([\s\S]*?)\];/);
  const server = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const page = [...block.match(/const WA_ENGINE_ORDER = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(server, page);
  assert.deepEqual(page.slice(2), [...ui.WA_CURRENT_ENGINES]);
});

test('hero photo: card shows the VDP hero URL (escaped) or an explicit no-photo state', () => {
  const h = ui.waHeroImage({ hero_photo: 'https://x.supabase.co/storage/v1/object/public/vehicle-photos/a/b.jpg' });
  assert.match(h, /<img src="https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/vehicle-photos\/a\/b\.jpg"/);
  assert.match(ui.waHeroImage({ hero_photo: null }), /No listing photo available/);
  assert.match(ui.waHeroImage(null), /No listing photo available/);
  assert.doesNotMatch(ui.waHeroImage({ hero_photo: '"><script>x</script>' }), /<script>/);
});

test('read model: hero_photo = first photos[] entry with a url (VDP gallery rule); photos array not shipped', async () => {
  global.fetch = async (url) => {
    const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => '' });
    if (url.includes('/auth/v1/user')) return ok({ email: 'ryan@example.com' });
    if (url.includes('/walkaround_review_queue')) return ok([{ id: 'q1', stock: 'A' }, { id: 'q2', stock: 'B' }, { id: 'q3', stock: 'C' }]);
    if (url.includes('/inventory')) return ok([
      { stock: 'A', status: 'published', sold: false, buyer_intelligence: null, photos: [{ dataUrl: 'data:x' }, { url: 'https://h/1.jpg' }, { url: 'https://h/2.jpg' }] },
      { stock: 'B', status: 'published', sold: false, buyer_intelligence: null, photos: JSON.stringify([{ url: 'https://h/b.jpg' }]) },
      { stock: 'C', status: 'published', sold: false, buyer_intelligence: null, photos: [] },
    ]);
    if (url.includes('/bi_publication_hold')) return ok([]);
    return ok([]);
  };
  delete require.cache[require.resolve('../admin-read.js')];
  const { handler } = require('../admin-read.js');
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation: 'get_walkaround_queue', data: {} }) });
  const rows = JSON.parse(res.body).rows;
  assert.equal(rows[0].source_facts.hero_photo, 'https://h/1.jpg');
  assert.equal(rows[1].source_facts.hero_photo, 'https://h/b.jpg');
  assert.equal(rows[2].source_facts.hero_photo, null);
  for (const r of rows) assert.ok(!('photos' in r.source_facts), 'photos array not shipped');
});

test('review flow: outcome pre-filled (edited → minor_wording_edit, generated → published_unchanged, blocked → none)', () => {
  assert.equal(ui.waDefaultOutcome(row()), 'minor_wording_edit');
  assert.equal(ui.waDefaultOutcome(row({ edited_bi: null })), 'published_unchanged');
  assert.equal(ui.waDefaultOutcome(row({ source_facts: facts({ has_live_bi: true }) })), '');
  assert.equal(ui.waDefaultOutcome(row({ hold: { reason: 'x' } })), '');
});

test('review flow: list shows only actionable rows unless the toggle is on', () => {
  const ok1 = row({ id: 'a', stock: 'A' });
  const live = row({ id: 'b', stock: 'B', source_facts: facts({ has_live_bi: true }) });
  const held = row({ id: 'c', stock: 'C', hold: { reason: 'x' } });
  const old = row({ id: 'd', stock: 'A', engine_version: 'walkaround-v1.2-text', edited_bi: null });
  const all = [ok1, live, held, old];
  assert.deepEqual(ui.waVisibleRows(all, false).map(r => r.id), ['a']);
  assert.deepEqual(ui.waVisibleRows(all, true).map(r => r.id), ['a', 'b', 'c', 'd']);
});

test('review flow: page wiring — one Approve & Publish action, no standalone Approve/Publish buttons, reject confirms', () => {
  assert.match(html, /data-wa-action="approve_publish"/);
  assert.match(html, /Approve &amp; Publish/);
  assert.doesNotMatch(html, /id="wa-approve-' \+ idAttr/);
  assert.doesNotMatch(html, /id="wa-publish-' \+ idAttr/);
  assert.match(html, /confirm\('Reject this Walkaround\?/);
  assert.match(html, /data: \{ status: 'approved' \}/);
});
