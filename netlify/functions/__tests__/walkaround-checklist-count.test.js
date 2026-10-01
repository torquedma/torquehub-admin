'use strict';
// walkaround-checklist-count.test.js — Owner rule 2026-10-01: the Buyer Checklist has no count quota.
// The evidence decides how many checks belong (0 is valid); the footer is optional and needs >= 1 item.
// Run: node --test netlify/functions/__tests__/walkaround-checklist-count.test.js
// No network, no database: fetch is stubbed and the REAL admin-write publish_walkaround handler runs.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';

const items = (n) => Array.from({ length: n }, (_, i) => `Check ${i + 1}.`);
const BI = (df) => ({ version: '1.4', uncertainty_type: 'condition', buyer_question: 'Q?', torque_take: ['Take paragraph.'], decision_factors: df });

function stubFetch(state) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, body: opts.body });
    const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/auth/v1/user')) return ok({ email: 'ryan@example.com' });
    if (url.includes('/walkaround_review_queue') && method === 'GET') {
      if (url.includes('stock=eq.')) return ok([{ id: state.queueRow.id, engine_version: state.queueRow.engine_version, status: state.queueRow.status }]);
      return ok([state.queueRow]);
    }
    if (url.includes('/inventory') && method === 'GET') return ok([state.unit]);
    if (url.includes('/bi_publication_hold')) return ok([]);
    if (url.includes('/inventory') && method === 'PATCH') return ok([{ stock: state.unit.stock }]);
    if (url.includes('/walkaround_review_queue') && method === 'PATCH') return ok(null);
    return ok([]);
  };
  return calls;
}
async function publish(payload) {
  const state = {
    queueRow: { id: 'q1', stock: 'SRS-TEST', status: 'approved', review_outcome: 'published_unchanged', engine_version: 'walkaround-v1.4-manual-adjudicated', generated_bi: payload, edited_bi: null },
    unit: { stock: 'SRS-TEST', status: 'published', sold: false, buyer_intelligence: null },
  };
  const calls = stubFetch(state);
  delete require.cache[require.resolve('../admin-write.js')];
  const { handler } = require('../admin-write.js');
  const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {};
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ operation: 'publish_walkaround', data: { id: 'q1' } }) });
  console.log = l; console.warn = w; console.error = e;
  const inv = calls.find(c => c.method === 'PATCH' && c.url.includes('/inventory'));
  return { status: res.statusCode, body: JSON.parse(res.body), inventoryWrite: inv ? JSON.parse(inv.body) : null };
}

for (const [name, df] of [
  ['C1 zero items, no footer', { makes_it_a_yes: [] }],
  ['C2 one item, no footer', { makes_it_a_yes: items(1) }],
  ['C3 three items + footer', { makes_it_a_yes: items(3), makes_it_a_yes_footer: 'Footer.' }],
  ['C4 seven items + footer', { makes_it_a_yes: items(7), makes_it_a_yes_footer: 'Footer.' }],
  ['C5 four items + footer (existing shape still publishes)', { makes_it_a_yes: items(4), makes_it_a_yes_footer: 'Footer.' }],
]) {
  test(`${name}: publishes, and the inventory write carries the payload unchanged`, async () => {
    const p = BI(df);
    const r = await publish(p);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.inventoryWrite, { buyer_intelligence: p });
  });
}

for (const [name, df, re] of [
  ['R1 footer with zero items', { makes_it_a_yes: [], makes_it_a_yes_footer: 'Footer.' }, /requires at least one checklist item/],
  ['R2 empty-string item', { makes_it_a_yes: ['Check 1.', '  '] }, /makes_it_a_yes\[1\] is empty/],
  ['R3 empty footer string', { makes_it_a_yes: items(2), makes_it_a_yes_footer: '   ' }, /when present, must be a non-empty string/],
  ['R4 makes_it_a_yes missing', {}, /makes_it_a_yes is not an array/],
]) {
  test(`${name}: rejected with 400 before any inventory write`, async () => {
    const r = await publish(BI(df));
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, 'payload failed shape validation');
    assert.ok(r.body.details.some(d => re.test(d)), JSON.stringify(r.body.details));
    assert.equal(r.inventoryWrite, null);
  });
}

test('R5 the "exactly 4 items" rule is gone from the validator', () => {
  const src = require('fs').readFileSync(require.resolve('../admin-write.js'), 'utf8');
  assert.doesNotMatch(src, /must hold exactly 4 items/);
});
