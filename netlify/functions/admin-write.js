'use strict';

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';
const { stampFacts } = require('./lib/provenance');
const { publishToDealerAndLog, lookupDealerByStock } = require('./lib/publish-to-dealer');

// ---------------------------------------------------------------------------
// FIELD ALLOWLISTS — only these fields may reach Supabase for each operation.
// ---------------------------------------------------------------------------
const INVENTORY_CREATE_FIELDS = [
  'stock', 'dealer', 'year', 'make', 'model', 'trim', 'price', 'days',
  'condition', 'fuel', 'mileage', 'hours', 'engine', 'engine_description',
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

const DEALER_UPDATE_FIELDS = [
  'phone', 'address', 'city', 'state', 'zip',
  'website', 'site_url', 'status', 'category',
];

const CONTACT_FIELDS = ['name', 'phone', 'email', 'notes'];

// Walkaround review queue — restricted enums for the review op.
const WALKAROUND_REVIEW_STATUSES = new Set(['approved', 'rejected']);
const WALKAROUND_REVIEW_OUTCOMES = new Set([
  'published_unchanged',
  'minor_wording_edit',
  'buyer_insight_changed',
  'wrong_factual_assumption',
  'feed_data_error',
  'wrong_uncertainty_selected',
  'abstain_should_have_generated',
  'generated_should_have_abstained',
]);

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
  rename_dealer:          handleRenameDealer,
  remove_dealer:          handleRemoveDealer,
  update_dealer:          handleUpdateDealer,
  save_contact:           handleSaveContact,
  delete_contact:         handleDeleteContact,
  review_walkaround:      handleReviewWalkaround,
  publish_walkaround:     handlePublishWalkaround,
  unpublish_walkaround:   handleUnpublishWalkaround,
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
  // userEmail flows from the L3-verified Bearer-token check (line 99 above) so
  // handlers that need the actor identity (e.g. publish_walkaround → published_by)
  // get it without trusting any caller-supplied value. Existing handlers ignore it.
  try {
    const result = await handler({ data: data || {}, svcKey, userEmail });
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

  // Server-side publish: toggle_featured's signature does not carry dealer,
  // so we resolve dealer by stock via a small SELECT. Documented deliberate
  // choice; see publish-to-dealer.js lookupDealerByStock().
  const dealerKey = await lookupDealerByStock(stock, svcKey);
  const publish   = await publishToDealerAndLog(dealerKey, svcKey);
  return { status: 200, body: { ok: true, publish } };
}

// ---------------------------------------------------------------------------
// OPERATION: create_inventory
// POST /rest/v1/inventory  Prefer: return=representation (caller needs the id)
// ---------------------------------------------------------------------------
async function handleCreateInventory({ data, svcKey, userEmail }) {
  let err;
  err = requireString(data, 'stock');  if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer'); if (err) return { status: 400, body: { error: err } };

  const row = pickFields(data, INVENTORY_CREATE_FIELDS);
  if (!('sold' in row)) row.sold = false;

  // Provenance (T1.1-c call site 3): server-side stamp. Client cannot send trust/provenance
  // (not in allowlist). All admin-write creates are human_admin/attributed for now.
  const provFactKeys = ['year','make','model','trim','mileage','vin','engine','transmission','drivetrain','hours','fuel','condition'];
  const provFacts = {};
  for (const k of provFactKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') provFacts[k] = row[k];
  }
  if (Object.keys(provFacts).length > 0) {
    row.provenance = stampFacts(null, provFacts, { source: 'human_admin', trust: 'attributed', actor: userEmail, mode: 'overwrite' });
  }

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
async function handleUpdateInventory({ data, svcKey, userEmail }) {
  let err;
  err = requireString(data, 'filterStock'); if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'dealer');      if (err) return { status: 400, body: { error: err } };

  // filterStock and dealer are URL-filter values only — strip from body payload
  const payload = pickFields(data, INVENTORY_UPDATE_FIELDS);

  // Provenance (T1.1-c call site 3): fetch existing provenance as the MERGE BASE so an edit
  // only changes provenance for the fields actually submitted; untouched fields keep theirs.
  const provFactKeys = ['year','make','model','trim','mileage','vin','engine','transmission','drivetrain','hours','fuel','condition'];
  const provFacts = {};
  for (const k of provFactKeys) {
    if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') provFacts[k] = payload[k];
  }
  if (Object.keys(provFacts).length > 0) {
    // Fetch existing provenance as the MERGE BASE. FAIL-SAFE: if this fetch fails, we must NOT
    // write provenance at all — writing from a null base on an UPDATE would replace the whole
    // provenance object with just the edited fields, clobbering untouched (incl. verified) facts.
    let existingProv = null;
    let existingProvFetchOk = false;
    try {
      const getUrl = `${SUPABASE_URL}/rest/v1/inventory`
        + `?select=provenance`
        + `&stock=eq.${encodeURIComponent(data.filterStock.trim())}`
        + `&dealer=eq.${encodeURIComponent(data.dealer.trim())}`;
      const getRes = await fetch(getUrl, {
        headers: {
          'apikey':        svcKey,
          'Authorization': 'Bearer ' + svcKey,
          'Accept':        'application/json',
        },
      });
      if (getRes.ok) {
        const rows = await getRes.json();
        existingProv = (Array.isArray(rows) && rows[0] && rows[0].provenance) ? rows[0].provenance : null;
        existingProvFetchOk = true;
      }
    } catch (e) { existingProvFetchOk = false; }

    if (existingProvFetchOk) {
      // Merge from the real base (existingProv may legitimately be null for a never-stamped row —
      // that's a genuine first-write, which is correct).
      payload.provenance = stampFacts(existingProv, provFacts, { source: 'human_admin', trust: 'attributed', actor: userEmail, mode: 'overwrite' });
    } else {
      // Fetch failed — leave payload.provenance UNSET so the PATCH does not touch the provenance
      // column. Values still update; provenance is preserved as-is and re-established on the next
      // successful edit or dx/sync pass.
      console.warn(`admin-write update_inventory: existing-provenance fetch failed for stock=${data.filterStock} dealer=${data.dealer} — skipping provenance write to avoid clobber.`);
    }
  }

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

  const publish = await publishToDealerAndLog(data.dealer.trim(), svcKey);
  return { status: 200, body: { ok: true, publish } };
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

  const publish = await publishToDealerAndLog(data.dealer.trim(), svcKey);
  return { status: 200, body: { ok: true, publish } };
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

  const publish = await publishToDealerAndLog(data.dealer.trim(), svcKey);
  return { status: 200, body: { ok: true, publish } };
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
// OPERATION: update_dealer
// PATCH /rest/v1/dealers?name=eq.{name}
// data: { name, phone?, city?, state?, zip?, address?, website?, site_url?,
//         status?, category? }
// name is required (URL filter only — not written; use rename_dealer to change name).
// ---------------------------------------------------------------------------
async function handleUpdateDealer({ data, svcKey }) {
  const err = requireString(data, 'name');
  if (err) return { status: 400, body: { error: err } };

  const row = pickFields(data, DEALER_UPDATE_FIELDS);
  if (Object.keys(row).length === 0) {
    return { status: 400, body: { error: 'No updatable fields provided' } };
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dealers?name=eq.${encodeURIComponent(data.name.trim())}`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        svcKey,
        'Authorization': 'Bearer ' + svcKey,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: rename_dealer
// PATCH /rest/v1/dealers   then   PATCH /rest/v1/inventory (cascade)
// data: { oldName, newName }
// Step 1 must succeed before step 2 runs — no cross-table transaction available.
// ---------------------------------------------------------------------------
async function handleRenameDealer({ data, svcKey }) {
  let err;
  err = requireString(data, 'oldName'); if (err) return { status: 400, body: { error: err } };
  err = requireString(data, 'newName'); if (err) return { status: 400, body: { error: err } };

  if (data.oldName.trim() === data.newName.trim()) {
    return { status: 400, body: { error: 'oldName and newName are identical' } };
  }

  const headers = {
    'apikey':        svcKey,
    'Authorization': 'Bearer ' + svcKey,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal',
  };

  // Step 1: rename the dealers row
  const r1 = await fetch(
    `${SUPABASE_URL}/rest/v1/dealers?name=eq.${encodeURIComponent(data.oldName)}`,
    { method: 'PATCH', headers, body: JSON.stringify({ name: data.newName }) }
  );
  if (!r1.ok) {
    const errText = await r1.text();
    return { status: r1.status, body: { error: errText } };
  }

  // Step 2: cascade rename to all inventory rows
  const r2 = await fetch(
    `${SUPABASE_URL}/rest/v1/inventory?dealer=eq.${encodeURIComponent(data.oldName)}`,
    { method: 'PATCH', headers, body: JSON.stringify({ dealer: data.newName }) }
  );
  if (!r2.ok) {
    const errText = await r2.text();
    return { status: r2.status, body: { error: 'Dealer renamed but inventory cascade failed: ' + errText } };
  }

  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: remove_dealer
// Hard refuse if any inventory exists for this dealer — no cascade, no exceptions.
// data: { name }
// ---------------------------------------------------------------------------
async function handleRemoveDealer({ data, svcKey }) {
  const err = requireString(data, 'name');
  if (err) return { status: 400, body: { error: err } };

  const headers = {
    'apikey':        svcKey,
    'Authorization': 'Bearer ' + svcKey,
  };

  // Step 1: count this dealer's inventory server-side (never trust the client count)
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/inventory?dealer=eq.${encodeURIComponent(data.name)}&select=id`,
    {
      method: 'GET',
      headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-0' },
    }
  );
  if (!countRes.ok) {
    const errText = await countRes.text();
    return { status: countRes.status, body: { error: 'Could not verify dealer inventory: ' + errText } };
  }

  // Parse count from Content-Range header (format: '0-0/N' or '*/N')
  let count = 0;
  const contentRange = countRes.headers.get('content-range') || '';
  const rangeMatch = contentRange.match(/\/(\d+)$/);
  if (rangeMatch) {
    count = parseInt(rangeMatch[1], 10);
  } else {
    // Fallback: count returned array
    try { const rows = await countRes.json(); count = Array.isArray(rows) ? rows.length : 0; } catch { count = 0; }
  }

  // Step 2: refuse if any inventory exists
  if (count > 0) {
    return {
      status: 409,
      body: { error: "Cannot remove this dealer while inventory exists. Remove or reassign that dealer's listings first.", count },
    };
  }

  // Step 3: delete the dealers row (count === 0 confirmed above)
  const delRes = await fetch(
    `${SUPABASE_URL}/rest/v1/dealers?name=eq.${encodeURIComponent(data.name)}`,
    { method: 'DELETE', headers }
  );
  if (!delRes.ok) {
    const errText = await delRes.text();
    return { status: delRes.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: save_contact
// POST /rest/v1/contacts  Prefer: return=minimal
// data: { name, phone, email, dealer_name, notes } — only these fields accepted.
// ---------------------------------------------------------------------------
async function handleSaveContact({ data, svcKey }) {
  const err = requireString(data, 'name');
  if (err) return { status: 400, body: { error: err } };

  const row = pickFields(data, CONTACT_FIELDS);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
    method: 'POST',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// OPERATION: delete_contact
// DELETE /rest/v1/contacts?id=eq.{data.id}
// data: { id } — required.
// ---------------------------------------------------------------------------
async function handleDeleteContact({ data, svcKey }) {
  if (!data.id) {
    return { status: 400, body: { error: 'data.id is required' } };
  }

  const url = `${SUPABASE_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(data.id)}`;

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
// OPERATION: review_walkaround
// PATCH /rest/v1/walkaround_review_queue?id=eq.{id}
// data: { id, status, review_outcome }
//   - status must be 'approved' or 'rejected'
//   - review_outcome must be one of the 8 taxonomy values
// Uses Prefer: return=representation so we can confirm exactly one row updated.
// ---------------------------------------------------------------------------
async function handleReviewWalkaround({ data, svcKey }) {
  if (data.id == null || data.id === '') {
    return { status: 400, body: { error: 'data.id is required' } };
  }
  if (!WALKAROUND_REVIEW_STATUSES.has(data.status)) {
    return { status: 400, body: { error: "data.status must be 'approved' or 'rejected'" } };
  }
  if (!WALKAROUND_REVIEW_OUTCOMES.has(data.review_outcome)) {
    return { status: 400, body: { error: 'data.review_outcome is missing or not in the 8 allowed taxonomy values' } };
  }

  // Allowlist enforced: only these three columns travel to Supabase.
  const payload = {
    status:         data.status,
    review_outcome: data.review_outcome,
    reviewed_at:    new Date().toISOString(),
  };

  const url = `${SUPABASE_URL}/rest/v1/walkaround_review_queue?id=eq.${encodeURIComponent(data.id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey':        svcKey,
      'Authorization': 'Bearer ' + svcKey,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { status: res.status, body: { error: errText } };
  }
  const updated = await res.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    return { status: 404, body: { error: 'queue row not found' } };
  }
  if (updated.length > 1) {
    return { status: 500, body: { error: 'multiple queue rows matched the id — data integrity issue' } };
  }
  return { status: 200, body: { ok: true, id: updated[0].id } };
}

// ---------------------------------------------------------------------------
// OPERATION: publish_walkaround
// Ported from netlify/functions/publish-walkaround.js in the sister site repo.
// Deterministic governance: no AI, no generation, no editing.
//
// WRITE BOUNDARY: this handler writes to `inventory` in EXACTLY ONE place
// (step 6), and the only column it touches there is `buyer_intelligence`.
// All other writes target walkaround_review_queue.
//
// data: { id }  OR  { stock, engine_version }
// ---------------------------------------------------------------------------
async function handlePublishWalkaround({ data, svcKey, userEmail }) {
  const idParam = data.id ? String(data.id).trim() : '';
  const stockParam = data.stock ? String(data.stock).trim() : '';
  const evParam = data.engine_version ? String(data.engine_version).trim() : '';
  const haveId = !!idParam;
  const haveStockPair = !!stockParam && !!evParam;
  if (!haveId && !haveStockPair) {
    return { status: 400, body: { error: 'Provide data.id or data.stock + data.engine_version' } };
  }

  const headers = {
    'apikey':        svcKey,
    'Authorization': 'Bearer ' + svcKey,
    'Content-Type':  'application/json',
  };

  // 1. Fetch queue row
  let queueUrl = `${SUPABASE_URL}/rest/v1/walkaround_review_queue?select=*`;
  if (haveId) {
    queueUrl += `&id=eq.${encodeURIComponent(idParam)}`;
  } else {
    queueUrl += `&stock=eq.${encodeURIComponent(stockParam)}`;
    queueUrl += `&engine_version=eq.${encodeURIComponent(evParam)}`;
  }
  const qRes = await fetch(queueUrl, { headers });
  if (!qRes.ok) {
    const errText = await qRes.text();
    return { status: 500, body: { ok: false, error: 'queue fetch failed: ' + errText } };
  }
  const queueRows = await qRes.json();
  if (!Array.isArray(queueRows) || queueRows.length === 0) {
    return { status: 404, body: { ok: false, error: 'queue row not found' } };
  }
  if (queueRows.length > 1) {
    return { status: 500, body: { ok: false, error: 'multiple queue rows matched the input — data integrity issue' } };
  }
  const row = queueRows[0];

  // 2. Hard gate (no writes have happened yet)
  if (row.status !== 'approved') {
    return { status: 400, body: { ok: false, error: `only approved rows can be published (status='${row.status}')` } };
  }
  if (row.generated_bi == null && row.edited_bi == null) {
    return { status: 400, body: { ok: false, error: 'both generated_bi and edited_bi are null — nothing to publish' } };
  }

  // 3. Payload selection: edited_bi wins if present, else generated_bi
  const usedField = row.edited_bi != null ? 'edited_bi' : 'generated_bi';
  const payload = row.edited_bi != null ? row.edited_bi : row.generated_bi;

  // 4. Payload shape validation (reject abstain, require required keys)
  const shapeErrs = validateWalkaroundPayload(payload);
  if (shapeErrs.length) {
    return { status: 400, body: { ok: false, error: 'payload failed shape validation', details: shapeErrs, used: usedField } };
  }

  // 5. Snapshot existing inventory.buyer_intelligence for rollback. READ only.
  const snapUrl = `${SUPABASE_URL}/rest/v1/inventory?select=buyer_intelligence&stock=eq.${encodeURIComponent(row.stock)}`;
  const sRes = await fetch(snapUrl, { headers });
  if (!sRes.ok) {
    const errText = await sRes.text();
    await recordWalkaroundPublishError(svcKey, row.id, 'snapshot read failed: ' + errText);
    return { status: 500, body: { ok: false, error: 'snapshot read failed' } };
  }
  const snapRows = await sRes.json();
  if (!Array.isArray(snapRows) || snapRows.length === 0) {
    await recordWalkaroundPublishError(svcKey, row.id, `inventory has no row for stock='${row.stock}'`);
    return { status: 500, body: { ok: false, error: `inventory has no row for stock='${row.stock}'` } };
  }
  if (snapRows.length > 1) {
    await recordWalkaroundPublishError(svcKey, row.id, `inventory has ${snapRows.length} rows for stock='${row.stock}' (expected 1)`);
    return { status: 500, body: { ok: false, error: 'snapshot ambiguous' } };
  }
  const snapshot = snapRows[0].buyer_intelligence; // may be null — that is the correct rollback value

  // 6. THE ONLY WRITE TO `inventory` IN THIS HANDLER.
  // Updates exactly one column (buyer_intelligence). Prefer: return=representation
  // gives us back the affected rows so we can confirm exactly 1.
  const invUrl = `${SUPABASE_URL}/rest/v1/inventory?stock=eq.${encodeURIComponent(row.stock)}`;
  const updRes = await fetch(invUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ buyer_intelligence: payload }),
  });
  if (!updRes.ok) {
    const errText = await updRes.text();
    await recordWalkaroundPublishError(svcKey, row.id, 'inventory update failed: ' + errText);
    return { status: 500, body: { ok: false, error: 'inventory update failed' } };
  }
  const updated = await updRes.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    await recordWalkaroundPublishError(svcKey, row.id, `inventory update affected 0 rows for stock='${row.stock}'`);
    return { status: 500, body: { ok: false, error: 'inventory update affected 0 rows' } };
  }
  if (updated.length > 1) {
    await recordWalkaroundPublishError(svcKey, row.id, `inventory update affected ${updated.length} rows for stock='${row.stock}'`);
    return { status: 500, body: { ok: false, error: 'inventory update affected multiple rows' } };
  }

  // 7. Mark the queue row published. published_by = the L3-verified user email
  // (the TODO from the site-repo standalone version is now resolved).
  const publishedAt = new Date().toISOString();
  const queuePatchUrl = `${SUPABASE_URL}/rest/v1/walkaround_review_queue?id=eq.${encodeURIComponent(row.id)}`;
  const qPatchRes = await fetch(queuePatchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      status:                      'published',
      published_at:                publishedAt,
      previous_buyer_intelligence: snapshot,           // null is a valid snapshot
      published_by:                userEmail || null,  // L3-verified, never caller-supplied
      publish_error:               null,
    }),
  });
  if (!qPatchRes.ok) {
    const errText = await qPatchRes.text();
    // Inventory is already updated, so we can't cleanly roll back from here.
    // Surface the failure loudly; an operator may need to manually reconcile.
    return { status: 500, body: {
      ok: false,
      error: 'inventory updated but queue write failed — queue row needs manual reconciliation',
      detail: errText,
      stock: row.stock,
      id: row.id,
    } };
  }

  // 8. Success
  return { status: 200, body: {
    ok: true,
    stock: row.stock,
    id: row.id,
    published_at: publishedAt,
    used: usedField,
  } };
}

// ---------------------------------------------------------------------------
// OPERATION: unpublish_walkaround
// Ported from netlify/functions/unpublish-walkaround.js in the sister site repo.
// Roll a published Walkaround back: restore inventory.buyer_intelligence to the
// snapshot taken at publish time, revert queue row to 'approved'.
//
// WRITE BOUNDARY: this handler writes to `inventory` in EXACTLY ONE place
// (step 2), and the only column it touches there is `buyer_intelligence`.
//
// data: { id }
// ---------------------------------------------------------------------------
async function handleUnpublishWalkaround({ data, svcKey }) {
  const idParam = data.id ? String(data.id).trim() : '';
  if (!idParam) {
    return { status: 400, body: { error: 'data.id is required' } };
  }

  const headers = {
    'apikey':        svcKey,
    'Authorization': 'Bearer ' + svcKey,
    'Content-Type':  'application/json',
  };

  // 1. Fetch queue row
  const queueUrl = `${SUPABASE_URL}/rest/v1/walkaround_review_queue?select=*&id=eq.${encodeURIComponent(idParam)}`;
  const qRes = await fetch(queueUrl, { headers });
  if (!qRes.ok) {
    const errText = await qRes.text();
    return { status: 500, body: { ok: false, error: 'queue fetch failed: ' + errText } };
  }
  const queueRows = await qRes.json();
  if (!Array.isArray(queueRows) || queueRows.length === 0) {
    return { status: 404, body: { ok: false, error: 'queue row not found' } };
  }
  if (queueRows.length > 1) {
    return { status: 500, body: { ok: false, error: 'multiple queue rows matched the id — data integrity issue' } };
  }
  const row = queueRows[0];

  // Hard gate — only published rows can be unpublished. previous_buyer_intelligence
  // may legitimately be null (means the unit had no buyer_intelligence before
  // publish); we still proceed and restore null.
  if (row.status !== 'published') {
    return { status: 400, body: { ok: false, error: `only published rows can be unpublished (status='${row.status}')` } };
  }

  // 2. THE ONLY WRITE TO `inventory` IN THIS HANDLER.
  // Restore the snapshot. Updates exactly one column.
  const invUrl = `${SUPABASE_URL}/rest/v1/inventory?stock=eq.${encodeURIComponent(row.stock)}`;
  const updRes = await fetch(invUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ buyer_intelligence: row.previous_buyer_intelligence }),
  });
  if (!updRes.ok) {
    const errText = await updRes.text();
    await recordWalkaroundPublishError(svcKey, row.id, 'inventory restore failed: ' + errText);
    return { status: 500, body: { ok: false, error: 'inventory restore failed' } };
  }
  const updated = await updRes.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    await recordWalkaroundPublishError(svcKey, row.id, `inventory update affected 0 rows for stock='${row.stock}'`);
    return { status: 500, body: { ok: false, error: 'inventory restore affected 0 rows' } };
  }
  if (updated.length > 1) {
    await recordWalkaroundPublishError(svcKey, row.id, `inventory update affected ${updated.length} rows for stock='${row.stock}'`);
    return { status: 500, body: { ok: false, error: 'inventory restore affected multiple rows' } };
  }

  // 3. Revert the queue row. Clear previous_buyer_intelligence so a future
  // publish takes a fresh snapshot — prevents stale-snapshot replay on
  // publish/unpublish/publish sequences.
  const queuePatchUrl = `${SUPABASE_URL}/rest/v1/walkaround_review_queue?id=eq.${encodeURIComponent(row.id)}`;
  const qPatchRes = await fetch(queuePatchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      status:                      'approved',
      published_at:                null,
      previous_buyer_intelligence: null,
      publish_error:               null,
    }),
  });
  if (!qPatchRes.ok) {
    const errText = await qPatchRes.text();
    return { status: 500, body: {
      ok: false,
      error: 'inventory restored but queue write failed — queue row needs manual reconciliation',
      detail: errText,
      stock: row.stock,
      id: row.id,
    } };
  }

  // 4. Success
  return { status: 200, body: { ok: true, stock: row.stock, id: row.id, restored: true } };
}

// validateWalkaroundPayload — returns an array of error strings; empty = OK.
// Same shape contract as the site-repo standalone version: rejects abstain,
// requires title/meet_title/meet/torque_take/decision_factors.{makes_it_a_yes,
// makes_it_a_yes_footer}.
function validateWalkaroundPayload(payload) {
  const errs = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errs.push('payload is not an object');
    return errs;
  }
  if (payload.abstain === true) errs.push('cannot publish an abstain object');
  if (typeof payload.title !== 'string' || !payload.title.trim())             errs.push('missing or empty title');
  if (typeof payload.meet_title !== 'string' || !payload.meet_title.trim())   errs.push('missing or empty meet_title');
  if (typeof payload.meet !== 'string' || !payload.meet.trim())               errs.push('missing or empty meet');
  if (!Array.isArray(payload.torque_take))                                    errs.push('torque_take is not an array');
  const df = payload.decision_factors;
  if (!df || typeof df !== 'object' || Array.isArray(df)) {
    errs.push('missing decision_factors object');
  } else {
    if (!Array.isArray(df.makes_it_a_yes)) errs.push('decision_factors.makes_it_a_yes is not an array');
    const footer = df.makes_it_a_yes_footer;
    if (footer == null || (typeof footer === 'string' && !footer.trim())) {
      errs.push('missing or empty decision_factors.makes_it_a_yes_footer');
    }
  }
  return errs;
}

// Best-effort: write a publish_error breadcrumb on the queue row WITHOUT
// touching status. Used by both publish and unpublish failure paths so the
// queue row carries enough information for a reviewer to retry or escalate.
async function recordWalkaroundPublishError(svcKey, queueId, message) {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/walkaround_review_queue?id=eq.${encodeURIComponent(queueId)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey':        svcKey,
          'Authorization': 'Bearer ' + svcKey,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ publish_error: message }),
      }
    );
  } catch (e) {
    console.error(`[admin-write] failed to record publish_error on id=${queueId}: ${e.message}`);
  }
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
