'use strict';
// p21-admin-add-lead.test.js — CRM v1.2 / P2.1 (Chief 1 -351/-352).
//   admin-write create_lead: authenticated, allowlisted, fail-closed, operational fields only.
//   admin-read get_leads: the operational list no longer selects credit_score.
//   index.html: Add Lead no longer posts to /rest/v1/leads with the anon key.
// Runs the REAL handlers against an in-memory fake of /auth/v1/user and PostgREST.
// Run: node --test netlify/functions/__tests__/p21-admin-add-lead.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.ADMIN_EMAILS = 'ryan@example.com';
const quietly = async (fn) => {
  const q = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { [console.log, console.warn, console.error] = q; }
};
const W = require('../admin-write.js');
const R = require('../admin-read.js');

function fakeFetch(calls, { user = 'ryan@example.com', insertStatus = 201 } = {}) {
  return async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/v1/user')) {
      const tok = (opts.headers.Authorization || '').slice(7);
      if (tok !== 'good') return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ email: user }) };
    }
    if (url.includes('/rest/v1/leads') && opts.method === 'POST') {
      if (insertStatus >= 300) return { ok: false, status: insertStatus, text: async () => 'db refused' };
      return { ok: true, status: 201, json: async () => [{ id: '00000000-0000-4000-8000-000000000001' }] };
    }
    if (url.includes('/rest/v1/leads?select=')) return { ok: true, status: 200, json: async () => [] };
    throw new Error('unexpected fetch ' + url);
  };
}
async function call(mod, body, { token = 'good', ...f } = {}) {
  const calls = []; const orig = global.fetch; global.fetch = fakeFetch(calls, f);
  try {
    const res = await quietly(() => mod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(body) }));
    return { res, body: JSON.parse(res.body), calls };
  } finally { global.fetch = orig; }
}
const insertOf = (calls) => calls.find(c => c.url.includes('/rest/v1/leads') && c.opts.method === 'POST');

test('create_lead: valid manual lead is inserted with forced status/source and service key', async () => {
  const { res, body, calls } = await call(W, { operation: 'create_lead', data: {
    customer_name: ' Test Buyer ', customer_phone: '919-555-0100', channel: 'phone', message: 'called about dump truck',
    status: 'closed', source: 'vdp', credit_score: '800', lender: 'X', route_code: 'L001', rep: 'z' } });
  assert.equal(res.statusCode, 200); assert.equal(body.ok, true); assert.ok(body.id);
  const ins = insertOf(calls); const row = JSON.parse(ins.opts.body);
  assert.deepEqual(Object.keys(row).sort(), ['customer_name', 'customer_phone', 'message', 'source', 'status'].sort());
  assert.equal(row.status, 'new'); assert.equal(row.source, 'admin_phone'); assert.equal(row.customer_name, 'Test Buyer');
  assert.equal(ins.opts.headers.Authorization, 'Bearer svc');
});
test('create_lead: no token -> 401, nothing written', async () => {
  const { res, calls } = await call(W, { operation: 'create_lead', data: { customer_name: 'A', customer_phone: '1' } }, { token: '' });
  assert.equal(res.statusCode, 401); assert.equal(insertOf(calls), undefined);
});
test('create_lead: invalid session -> 401, nothing written', async () => {
  const { res, calls } = await call(W, { operation: 'create_lead', data: { customer_name: 'A', customer_phone: '1' } }, { token: 'bad' });
  assert.equal(res.statusCode, 401); assert.equal(insertOf(calls), undefined);
});
test('create_lead: verified but non-allowlisted user -> 403, nothing written', async () => {
  const { res, calls } = await call(W, { operation: 'create_lead', data: { customer_name: 'A', customer_phone: '1' } }, { user: 'other@example.com' });
  assert.equal(res.statusCode, 403); assert.equal(insertOf(calls), undefined);
});
test('create_lead: ADMIN_EMAILS empty -> 403 (fail closed)', async () => {
  const keep = process.env.ADMIN_EMAILS; process.env.ADMIN_EMAILS = '';
  try {
    const { res, calls } = await call(W, { operation: 'create_lead', data: { customer_name: 'A', customer_phone: '1' } });
    assert.equal(res.statusCode, 403); assert.equal(insertOf(calls), undefined);
  } finally { process.env.ADMIN_EMAILS = keep; }
});
test('create_lead: name required; phone or email required; channel closed set', async () => {
  for (const data of [
    { customer_phone: '1' },
    { customer_name: 'A' },
    { customer_name: 'A', customer_phone: '  ', customer_email: '' },
    { customer_name: 'A', customer_phone: '1', channel: 'facebook' },
  ]) {
    const { res, calls } = await call(W, { operation: 'create_lead', data });
    assert.equal(res.statusCode, 400, JSON.stringify(data)); assert.equal(insertOf(calls), undefined);
  }
});
test('create_lead: email-only lead accepted; default channel manual', async () => {
  const { res, calls } = await call(W, { operation: 'create_lead', data: { customer_name: 'A', customer_email: 'a@example.com' } });
  assert.equal(res.statusCode, 200); assert.equal(JSON.parse(insertOf(calls).opts.body).source, 'admin_manual');
});
test('create_lead: database refusal surfaces as an error (no silent success)', async () => {
  const { res, body } = await call(W, { operation: 'create_lead', data: { customer_name: 'A', customer_phone: '1' } }, { insertStatus: 403 });
  assert.equal(res.statusCode, 403); assert.ok(body.error); assert.notEqual(body.ok, true);
});
test('get_leads: operational list does not select credit_score', async () => {
  const { res, calls } = await call(R, { operation: 'get_leads' });
  assert.equal(res.statusCode, 200);
  const sel = calls.find(c => c.url.includes('/rest/v1/leads?select=')).url;
  assert.ok(!/credit_score/.test(sel)); assert.ok(/customer_name/.test(sel));
});
test('index.html: Add Lead uses admin-write create_lead; no anon REST lead writes remain', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  assert.ok(!/rest\/v1\/leads/.test(html));
  const i = html.indexOf('async function saveLead'); const fn = html.slice(i, html.indexOf('function viewLead', i));
  assert.ok(/admin-write/.test(fn) && /create_lead/.test(fn) && /getValidToken/.test(fn));
  assert.ok(/!r\.ok/.test(fn), 'save must check the response');
  assert.ok(!/eyJ/.test(fn), 'no embedded key in saveLead');
});
