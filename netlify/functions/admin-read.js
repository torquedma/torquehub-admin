// admin-read.js — authenticated read gateway, mirrors admin-write.js auth gate exactly.
// Operations: get_leads, get_leads_count, get_contacts, get_unit_debug. Service-role SELECT, fail-closed.
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

const INVENTORY_ADMIN_SELECT = [
  'id','year','make','model','trim','condition','price','dealer','stock','created_at',
  'fuel','description','category','subcategory','vin','featured','sold','sold_price',
  'sold_date','sold_type','public_sold','engine','transmission','drivetrain',
  'engine_description','transmission_description','video_url','mileage','notes','status',
  'prod_status','dx_locked','model_locked','subcategory_locked','raw_description',
  'description_source','photo_count','first_photo','hours','horsepower',
  'gvwr_class','body_class','provenance','vin_decoded_at'
].join(',');

// Walkaround Review queue columns the admin UI consumes.
const WALKAROUND_QUEUE_SELECT = [
  'id','stock','title','category','subcategory','generated_bi','edited_bi',
  'uncertainty_type','status','engine_version','review_outcome'
].join(',');

// Source inventory facts shown alongside each queue row so reviewers can sanity-check
// the BI payload against the underlying listing.
const WALKAROUND_FACT_SELECT = [
  'stock','year','make','model','trim','price','hours','horsepower','mileage',
  'engine','fuel','condition','description'
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
  },

  // get_unit_debug: full inventory + inventory_cards rows for a stock number.
  // Read-only. Used by the Ingestion Debug view (roadmap #4 v1).
  // Returns ALL matching rows so duplicates are visible.
  async get_unit_debug({ data, svcKey }) {
    const stock = (data.stock || '').trim();
    if (!stock) return { status: 400, body: { error: 'Missing stock param' } };
    const headers = {
      'apikey': svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type': 'application/json'
    };
    const enc = encodeURIComponent(stock);
    const [invRes, cardsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/inventory?stock=eq.${enc}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/inventory_cards?stock=eq.${enc}&select=*`, { headers })
    ]);
    if (!invRes.ok) {
      return { status: 502, body: { error: 'inventory read failed', detail: invRes.status } };
    }
    if (!cardsRes.ok) {
      return { status: 502, body: { error: 'inventory_cards read failed', detail: cardsRes.status } };
    }
    const inventory_rows = await invRes.json();
    const cards_rows = await cardsRes.json();
    return { status: 200, body: { inventory_rows, cards_rows } };
  },

  // get_inventory_admin: full admin inventory rows, paginated, optional dealer filter.
  // Service-role SELECT behind the auth gate. Mirrors the column list the admin UI consumes.
  // Params: limit (default 1000, clamped 1..1000), offset (default 0, min 0), dealer (optional).
  // Returns { rows, count, has_more } — count is the exact total via Content-Range.
  async get_inventory_admin({ data, svcKey }) {
    const limit = Math.min(Math.max(parseInt(data.limit, 10) || 1000, 1), 1000);
    const offset = Math.max(parseInt(data.offset, 10) || 0, 0);
    let url = `${SUPABASE_URL}/rest/v1/inventory?select=${INVENTORY_ADMIN_SELECT}&order=dealer,stock&offset=${offset}&limit=${limit}`;
    if (data.dealer) {
      url += `&dealer=eq.${encodeURIComponent(data.dealer)}&sold=eq.false`;
    }
    const res = await fetch(url, {
      headers: {
        'apikey': svcKey,
        'Authorization': 'Bearer ' + svcKey,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    });
    if (!res.ok && res.status !== 206 && res.status !== 200) {
      return { status: 502, body: { error: 'inventory read failed', detail: res.status } };
    }
    const rows = await res.json();
    const cr = res.headers.get('content-range') || '';
    const count = parseInt((cr.split('/')[1] || '0'), 10) || 0;
    const has_more = offset + rows.length < count;
    return { status: 200, body: { rows, count, has_more } };
  },

  // get_dealer_health: aggregates active inventory per dealer for the health dashboard.
  // Read-only. Used by the Dealer Health view (roadmap #5 v1). No params.
  async get_dealer_health({ svcKey }) {
    const url = `${SUPABASE_URL}/rest/v1/inventory?sold=eq.false&select=dealer,photos,price,year,engine,category,description,sold&limit=5000`;
    const res = await fetch(url, {
      headers: {
        'apikey': svcKey,
        'Authorization': 'Bearer ' + svcKey,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      return { status: 502, body: { error: 'inventory read failed', detail: res.status } };
    }
    const rows = await res.json();

    const POWERED_CATS = new Set(['Trucks', 'Construction', 'Farm']);
    const map = {};
    for (const row of rows) {
      const dealer = row.dealer || '(unknown)';
      if (!map[dealer]) {
        map[dealer] = { dealer, units: 0, missing_photos: 0, missing_price: 0, missing_year: 0, missing_engine_powered: 0, has_dx: 0 };
      }
      const d = map[dealer];
      d.units++;

      // missing_photos: null, empty array, or stringified empty
      const photos = row.photos;
      if (photos == null || ['[]', 'null', ''].includes(String(photos))) d.missing_photos++;

      // missing_price: null or zero/blank (price is a TEXT column)
      const price = row.price;
      if (price == null || ['', '0', '$0'].includes(String(price).trim())) d.missing_price++;

      // missing_year: null or zero/blank
      const year = row.year;
      if (year == null || ['', '0'].includes(String(year).trim())) d.missing_year++;

      // missing_engine_powered: only counted for powered categories
      const cat = row.category || '';
      if (POWERED_CATS.has(cat) && (row.engine == null || row.engine === '')) d.missing_engine_powered++;

      // has_dx: description of meaningful length
      if ((row.description || '').length >= 80) d.has_dx++;
    }

    const dealers = Object.values(map).sort((a, b) => b.units - a.units);
    return { status: 200, body: { dealers } };
  },

  // get_walkaround_queue: returns review-queue rows joined with their source inventory
  // facts. Default status='generated' (pending review); accept data.status to fetch
  // approved/published/rejected later. Two reads: queue rows, then inventory for those
  // stocks. Attach source facts as row.source_facts (null when no matching inventory row).
  async get_walkaround_queue({ data, svcKey }) {
    const status = (typeof data.status === 'string' && data.status.trim())
      ? data.status.trim()
      : 'generated';
    const limit = Math.min(Math.max(parseInt(data.limit, 10) || 500, 1), 1000);

    const headers = {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json'
    };

    // 1. Queue rows
    const queueUrl = `${SUPABASE_URL}/rest/v1/walkaround_review_queue`
      + `?select=${WALKAROUND_QUEUE_SELECT}`
      + `&status=eq.${encodeURIComponent(status)}`
      + `&order=id&limit=${limit}`;
    const qRes = await fetch(queueUrl, { headers });
    if (!qRes.ok) {
      return { status: 502, body: { error: 'walkaround_review_queue read failed', detail: qRes.status } };
    }
    const queueRows = await qRes.json();
    if (!Array.isArray(queueRows) || queueRows.length === 0) {
      return { status: 200, body: { rows: [] } };
    }

    // 2. Source facts for the matching stocks
    const stocks = [...new Set(queueRows.map(r => r.stock).filter(Boolean))];
    const factsByStock = new Map();
    if (stocks.length) {
      // PostgREST IN filter: stock=in.(val1,val2,...). Each value URL-encoded so
      // commas/parens/quotes inside values don't break the filter parser.
      const inList = stocks.map(s => encodeURIComponent(s)).join(',');
      const factsUrl = `${SUPABASE_URL}/rest/v1/inventory`
        + `?stock=in.(${inList})`
        + `&select=${WALKAROUND_FACT_SELECT}`;
      const fRes = await fetch(factsUrl, { headers });
      if (!fRes.ok) {
        return { status: 502, body: { error: 'inventory facts read failed', detail: fRes.status } };
      }
      const factsRows = await fRes.json();
      for (const f of (factsRows || [])) {
        if (f && f.stock) factsByStock.set(f.stock, f);
      }
    }

    // 3. Attach source_facts to each queue row (null when no matching inventory row)
    const rows = queueRows.map(r => ({ ...r, source_facts: factsByStock.get(r.stock) || null }));
    return { status: 200, body: { rows } };
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
