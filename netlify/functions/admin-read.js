// admin-read.js — authenticated read gateway, mirrors admin-write.js auth gate exactly.
// Operations: get_leads, get_leads_count, get_contacts. Service-role SELECT, fail-closed.
// Place at: torque-hub-admin/netlify/functions/admin-read.js

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';

// Column list the admin Leads UI actually consumes (from recon):
// id, created_at, customer_name, customer_phone, customer_email, dealer_name,
// lender, source, status, message, stock, source_url, credit_score, rep, referrer
// + unit_title (UI renders l.vehicle -> we map unit_title to vehicle client-side)
const LEADS_SELECT = [
  'id','created_at','customer_name','customer_phone','customer_email',
  'dealer_name','lender','source','status','message','stock',
  'unit_title','source_url','credit_score','rep','referrer'
].join(',');

const CONTACTS_SELECT = [
  'id','created_at','name','phone','email','notes'
].join(',');

const OPERATIONS = {
  // get_leads: returns up to `limit` leads, newest first.
  async get_leads({ data, svcKey }) {
    const limit = Math.min(parseInt(data.limit, 10) || 500, 1000);
    const url = `${SUPABASE_URL}/rest/v1/leads?select=${LEADS_SELECT}&order=created_at.desc&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'apikey': svcKey,
        'Authorization': 'Bearer ' + svcKey,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      return { status: 502, body: { error: 'Leads read failed', detail: res.status } };
    }
    const rows = await res.json();
    return { status: 200, body: { leads: rows } };
  },

  // get_contacts: returns up to `limit` contacts, newest first.
  async get_contacts({ data, svcKey }) {
    const limit = Math.min(parseInt(data.limit, 10) || 500, 1000);
    const url = `${SUPABASE_URL}/rest/v1/contacts?select=${CONTACTS_SELECT}&order=created_at.desc&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'apikey': svcKey,
        'Authorization': 'Bearer ' + svcKey,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      return { status: 502, body: { error: 'Contacts read failed', detail: res.status } };
    }
    const rows = await res.json();
    return { status: 200, body: { contacts: rows } };
  },

  // get_leads_count: exact total via Content-Range header.
  async get_leads_count({ svcKey }) {
    const url = `${SUPABASE_URL}/rest/v1/leads?select=id`;
    const res = await fetch(url, {
      headers: {
        'apikey': svcKey,
        'Authorization': 'Bearer ' + svcKey,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });
    if (!res.ok && res.status !== 206 && res.status !== 200) {
      return { status: 502, body: { error: 'Leads count failed', detail: res.status } };
    }
    const cr = res.headers.get('content-range') || '';
    const count = parseInt((cr.split('/')[1] || '0'), 10) || 0;
    return { status: 200, body: { count } };
  }
};

function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj)
  };
}

exports.handler = async (event) => {
  // Step 1 — POST only
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // Step 2 — service key present
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) return respond(500, { error: 'Server misconfiguration' });

  // Step 3 — extract Bearer token (caller's session token)
  const authHeader = (event.headers && event.headers['authorization']) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return respond(401, { error: 'Missing Authorization header' });

  // Step 4 — validate token via Supabase Auth
  let userEmail = '';
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': svcKey,
        'Authorization': 'Bearer ' + token
      }
    });
    if (!userRes.ok) return respond(401, { error: 'Invalid or expired session' });
    const userData = await userRes.json();
    if (!userData || !userData.email) return respond(401, { error: 'Invalid or expired session' });
    userEmail = userData.email.toLowerCase().trim();
  } catch (e) {
    return respond(401, { error: 'Auth check failed' });
  }

  // Step 5 — ADMIN_EMAILS allowlist (fail closed)
  const adminEmailsRaw = process.env.ADMIN_EMAILS || '';
  const adminEmails = adminEmailsRaw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  if (adminEmails.length === 0) return respond(403, { error: 'Forbidden' });
  if (!adminEmails.includes(userEmail)) return respond(403, { error: 'Forbidden' });

  // Dispatch
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, { error: 'Invalid JSON body' });
  }
  const { operation, data } = body;
  if (!operation || typeof operation !== 'string') return respond(400, { error: 'Missing operation' });
  const handler = OPERATIONS[operation];
  if (!handler) return respond(400, { error: `Unknown operation: ${operation}` });

  try {
    const result = await handler({ data: data || {}, svcKey });
    return respond(result.status, result.body);
  } catch (e) {
    return respond(500, { error: 'Internal error' });
  }
};
