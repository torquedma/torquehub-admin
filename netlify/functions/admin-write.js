'use strict';

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';

// ---------------------------------------------------------------------------
// FIELD ALLOWLISTS — only these fields may reach Supabase for each operation.
// ---------------------------------------------------------------------------
const INVENTORY_CREATE_FIELDS = [
  'stock', 'dealer', 'year', 'make', 'model', 'trim', 'price', 'days',
  'condition', 'fuel', 'mileage', 'engine', 'engine_description',
  'transmission', 'transmission_description', 'drivetrain', 'video_url',
  'vin', 'category', 'subcategory', 'featured', 'description', 'notes',
  'prod_status', 'status', 'photos', 'sold',
];

const INVENTORY_UPDATE_FIELDS = [
  // filterStock and dealer are used as URL filters only — not forwarded to body.
  // stock IS included: caller may be changing the stock# (rename case).
  'year', 'make', 'model', 'trim', 'price', 'stock', 'days', 'condition',
  'fuel', 'mileage', 'engine', 'transmission', 'drivetrain',
  'engine_description', 'transmission_description', 'video_url', 'vin',
  'category', 'featured', 'subcategory', 'description', 'notes', 'status',
  'prod_status', 'model_locked', 'dx_locked', 'subcategory_locked',
  'raw_description',
];

const MARK_SOLD_FIELDS = [
  // sold is forced true server-side — caller provides sale metadata only.
  'sold_type', 'sold_price', 'sale_price', 'sold_date', 'sold_at', 'public_sold',
];

const DEALER_FIELDS = ['name', 'category', 'status'];

// ---------------------------------------------------------------------------
// OPERATIONS ALLOWLIST — add handler here to enable an operation.
// ---------------------------------------------------------------------------
const OPERATIONS = {
  toggle_featured:        handleToggleFeatured,
  create_inventory:       handleCreateInventory,
  update_inventory:       handleUpdateInventory,
  patch_inventory_photos: handlePatchInventoryPhotos,
  mark_sold:              handleMarkSold,
  unmark_sold:            handleUnmarkSold,
  remove_inventory:       handleRemoveInventory,
  csv_import_inventory:   handleCsvImportInventory,
  add_dealer:             handleAddDealer,
};

// ---------------------------------------------------------------------------
// MAIN HANDLER
// ---------------------------------------------------------------------------
exports.handler = async function (event) {
  // 1. Method gate
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    console.error('[admin-write] SUPABASE_SERVICE_ROLE_KEY not set');
    return respond(500, { error: 'Server misconfiguration' });
  }

  // 2. Extract bearer token
  const authHeader = (event.headers && event.headers['authorization']) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return respond(401, { error: 'Missing Authorization header' });
  }

  // 3. Verify token with Supabase — proves it is a real, non-expired session token
  let userEmail;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey':        svcKey,
        'Authorization': 'Bearer ' + token,
      },
    });
    if (!userRes.ok) {
      return respond(401, { error: 'Invalid or expired session' });
    }
    const userData = await userRes.json();
    if (!userData || !userData.email) {
      return respond(401, { error: 'Invalid or expired session' });
    }
    userEmail = userData.email.toLowerCase().trim();
  } catch (err) {
    console.error('[admin-write] Auth check failed:', err.message);
    return respond(401, { error: 'Auth check failed' });
  }

  // 4. Authorization — verified Supabase user must also be in ADMIN_EMAILS allowlist
  const adminEmailsRaw = process.env.ADMIN_EMAILS || '';
  const adminEmails = adminEmailsRaw
    .split(',')
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);

  // Fail closed: if ADMIN_EMAILS is unset or empty, reject everyone
  if (adminEmails.length === 0) {
    console.warn('[admin-write] ADMIN_EMAILS not configured — rejecting all');
    return respond(403, { error: 'Forbidden' });
  }
  if (!adminEmails.includes(userEmail)) {
    console.warn('[admin-write] Unauthorized email attempted write:', userEmail);
    return respond(403, { error: 'Forbidden' });
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { operation, data } = body;
  if (!operation || typeof operation !== 'string') {
    return respond(400, { error: 'Missing operation' });
  }

  const handler = OPERATIONS[operation];
  if (!handler) {
    return respond(400, { error: `Unknown operation: ${operation}` });
  }

  // Dispatch
  try {
    const result = await handler({ data: data || {}, svcKey });
    return respond(result.status, result.body);
  } catch (err) {
    console.error(`[admin-write] Operation "${operation}" threw:`, err.message);
    return respond(500, { error: 'Internal error' });
  }
};

// ---------------------------------------------------------------------------
// OPERATION: toggle_featured
// PATCH /rest/v1/inventory?stock=eq.{stock}  body: { featured }
// ---------------------------------------------------------------------------
async function handleToggleFeatured({ data, svcKey }) {
  const stock = typeof data.stock === 'string' ? data.stock.trim() : '';
  if (!stock) {
    return { status: 400, body: { error: 'data.stock is required and must be a non-empty string' } };
  }
  if (!('featured' in data)) {
    return { status: 400, body: { error: 'data.featured is required' } };
  }

  // Field allowlist — only stock (used as filter) and featured are accepted;
  // any other fields in data are silently dropped here and never forwarded.
  const payload = { featured: data.featured };

  const url = `${SUPABASE_URL}/rest/v1/inventory?stock=eq.${encodeURIComponent(stock)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: create_inventory
// POST /rest/v1/inventory  Prefer: return=representation (caller needs the id)
// ---------------------------------------------------------------------------
async function handleCreateInventory({ data, svcKey }) {
  let err;
  err = requireString(data, 'stock');  if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer'); if (err) return { status: 400, body: { error: err } };

  const row = pickFields(data, INVENTORY_CREATE_FIELDS);
  if (!('sold' in row)) row.sold = false;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory`, {
    method: 'POST',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify([row]),
  });

  const text = await res.text();
  if (!res.ok) return { status: res.status, body: { error: text } };

  let inserted;
  try { inserted = JSON.parse(text); } catch { inserted = []; }
  const id = Array.isArray(inserted) && inserted[0] ? inserted[0].id || null : null;
  return { status: 200, body: { ok: true, id } };
}

// ---------------------------------------------------------------------------
// OPERATION: update_inventory
// PATCH /rest/v1/inventory?stock=eq.{filterStock}&dealer=eq.{dealer}
// filterStock = original stock to match on (stock in body may differ if renamed)
// dealer guard added here — current browser code filtered stock-only on update
// ---------------------------------------------------------------------------
async function handleUpdateInventory({ data, svcKey }) {
  let err;
  err = requireString(data, 'filterStock'); if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer');      if (err) return { status: 400, body: { error: err } };

  // filterStock and dealer are URL-filter values only — strip from body payload
  const payload = pickFields(data, INVENTORY_UPDATE_FIELDS);

  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?stock=eq.${encodeURIComponent(data.filterStock.trim())}`
    + `&dealer=eq.${encodeURIComponent(data.dealer.trim())}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: patch_inventory_photos
// PATCH /rest/v1/inventory?stock=eq.{stock}&dealer=eq.{dealer}
// dealer guard added here — current browser code filtered stock-only (collision risk)
// ---------------------------------------------------------------------------
async function handlePatchInventoryPhotos({ data, svcKey }) {
  let err;
  err = requireString(data, 'stock');  if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer'); if (err) return { status: 400, body: { error: err } };
  if (!Array.isArray(data.photos)) {
    return { status: 400, body: { error: 'data.photos is required and must be an array' } };
  }

  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?stock=eq.${encodeURIComponent(data.stock.trim())}`
    + `&dealer=eq.${encodeURIComponent(data.dealer.trim())}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({ photos: data.photos }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: mark_sold
// PATCH /rest/v1/inventory?stock=eq.{stock}&dealer=eq.{dealer}
// ---------------------------------------------------------------------------
async function handleMarkSold({ data, svcKey }) {
  let err;
  err = requireString(data, 'stock');  if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer'); if (err) return { status: 400, body: { error: err } };

  const payload = pickFields(data, MARK_SOLD_FIELDS);
  payload.sold = true; // always forced — caller cannot override

  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?stock=eq.${encodeURIComponent(data.stock.trim())}`
    + `&dealer=eq.${encodeURIComponent(data.dealer.trim())}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: unmark_sold
// PATCH /rest/v1/inventory?stock=eq.{stock}&dealer=eq.{dealer}
// All sale fields are hardcoded server-side — no caller-supplied values used.
// ---------------------------------------------------------------------------
async function handleUnmarkSold({ data, svcKey }) {
  let err;
  err = requireString(data, 'stock');  if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer'); if (err) return { status: 400, body: { error: err } };

  const payload = {
    sold:        false,
    sold_type:   null,
    sold_price:  null,
    sale_price:  null,
    sold_date:   null,
    sold_at:     null,
    public_sold: false,
  };

  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?stock=eq.${encodeURIComponent(data.stock.trim())}`
    + `&dealer=eq.${encodeURIComponent(data.dealer.trim())}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: remove_inventory
// DELETE /rest/v1/inventory?stock=eq.{stock}&dealer=eq.{dealer}
// dealer guard added here — current browser code filtered stock-only (debt #23)
// ---------------------------------------------------------------------------
async function handleRemoveInventory({ data, svcKey }) {
  let err;
  err = requireString(data, 'stock');  if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer'); if (err) return { status: 400, body: { error: err } };

  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?stock=eq.${encodeURIComponent(data.stock.trim())}`
    + `&dealer=eq.${encodeURIComponent(data.dealer.trim())}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: csv_import_inventory
// POST /rest/v1/inventory  Prefer: return=representation (return inserted ids)
// data: { rows: [...] } — caller may pre-batch at 50/req; gateway accepts any size
// All rows validated before any insert — rejects the whole request if any row fails
// ---------------------------------------------------------------------------
async function handleCsvImportInventory({ data, svcKey }) {
  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    return { status: 400, body: { error: 'data.rows is required and must be a non-empty array' } };
  }

  // Validate all rows before touching Supabase
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i];
    if (!row || typeof row !== 'object') {
      return { status: 400, body: { error: `rows[${i}] is not an object` } };
    }
    if (typeof row.stock !== 'string' || row.stock.trim() === '') {
      return { status: 400, body: { error: `rows[${i}].stock is required and must be a non-empty string` } };
    }
    if (typeof row.dealer !== 'string' || row.dealer.trim() === '') {
      return { status: 400, body: { error: `rows[${i}].dealer is required and must be a non-empty string` } };
    }
  }

  const rows = data.rows.map(row => {
    const r = pickFields(row, INVENTORY_CREATE_FIELDS);
    if (!('sold' in r)) r.sold = false;
    return r;
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory`, {
    method: 'POST',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(rows),
  });

  const text = await res.text();
  if (!res.ok) return { status: res.status, body: { error: text } };

  let inserted;
  try { inserted = JSON.parse(text); } catch { inserted = []; }
  const ids = Array.isArray(inserted) ? inserted.map(r => r.id || null) : [];
  return { status: 200, body: { ok: true, ids } };
}

// ---------------------------------------------------------------------------
// OPERATION: add_dealer
// POST /rest/v1/dealers
// ---------------------------------------------------------------------------
async function handleAddDealer({ data, svcKey }) {
  const err = requireString(data, 'name');
  if (err) return { status: 400, body: { error: err } };

  const row = pickFields(data, DEALER_FIELDS);
  if (!row.status) row.status = 'Active';

  const res = await fetch(`${SUPABASE_URL}/rest/v1/dealers`, {
    method: 'POST',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify([row]),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// Copies only keys in allowedFields from obj — any other keys are dropped.
function pickFields(obj, allowedFields) {
  const result = {};
  for (const key of allowedFields) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

// Returns an error string if field is missing/empty, null if valid.
function requireString(data, field) {
  const val = data[field];
  if (typeof val !== 'string' || val.trim() === '') {
    return `data.${field} is required and must be a non-empty string`;
  }
  return null;
}

function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  };
}
