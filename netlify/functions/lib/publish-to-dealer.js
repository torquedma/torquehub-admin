'use strict';

// Server-side publish orchestrator.
//
// Called from admin-write.js AFTER a successful Supabase mutation, BEFORE
// the success return. It does not throw to the caller: any failure is
// captured in the returned result object and logged to publish_log.
//
// INVARIANT — the caller's Supabase mutation is already committed when this
// runs. A publish failure (dealer network error, missing token, bad HTTP)
// is NEVER rolled back into the underlying DB write. Failures surface via
// the returned status and via a publish_log row; they are not swallowed.
//
// A dealer that is not in dealer-publish-config's DEALERS map is a SILENT
// NO-OP per spec (returns { status: 'skipped', reason: 'dealer_not_configured' }
// and writes no publish_log row).

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';
const { getDealerConfig } = require('./dealer-publish-config');
const { buildDealerPayload } = require('./publish-payload');

// One SELECT to resolve a stock's dealer. Used by toggle_featured, which is
// the only admin-write op whose signature does not carry `data.dealer`
// (see admin-write.js toggle_featured handler; browser call at
// index.html:2838-2861 passes only { stock, featured }). We resolve
// server-side rather than adding a signature parameter — documented
// deliberate choice for this job.
async function lookupDealerByStock(stock, svcKey) {
  const trimmed = String(stock || '').trim();
  if (!trimmed) return null;
  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?stock=eq.${encodeURIComponent(trimmed)}`
    + `&select=dealer&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey:        svcKey,
        Authorization: 'Bearer ' + svcKey,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return (Array.isArray(rows) && rows[0] && rows[0].dealer) || null;
  } catch (_e) {
    return null;
  }
}

// Best-effort publish_log insert. A logging failure does not affect the outer
// response.
async function logPublishAttempt(svcKey, row) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/publish_log`, {
      method: 'POST',
      headers: {
        apikey:        svcKey,
        Authorization: 'Bearer ' + svcKey,
        'Content-Type':'application/json',
        Prefer:        'return=minimal',
      },
      body: JSON.stringify([row]),
    });
  } catch (e) {
    console.error('[publish-to-dealer] publish_log write failed:', e.message);
  }
}

// Orchestrator. Never throws. Returns a small object describing what happened.
//   status: 'success' | 'failed' | 'skipped'
async function publishToDealerAndLog(dealerKey, svcKey) {
  const publishedAt = new Date().toISOString();

  // 1. No dealer? Silent no-op — nothing to publish, nothing to log.
  if (!dealerKey || typeof dealerKey !== 'string' || !dealerKey.trim()) {
    return { status: 'skipped', reason: 'no_dealer', dealer_name: null };
  }

  // 2. Dealer not configured for publish? Silent no-op per spec.
  const cfg = getDealerConfig(dealerKey);
  if (!cfg) {
    return { status: 'skipped', reason: 'dealer_not_configured', dealer_name: dealerKey };
  }

  // 3. Token missing on server env? Log and report failure.
  const token = process.env[cfg.tokenEnvVar] || '';
  if (!token) {
    const row = {
      dealer_name:   dealerKey,
      listing_count: 0,
      published_at:  publishedAt,
      status:        'failed',
      notes:         `env var ${cfg.tokenEnvVar} is not set on this Netlify site`,
    };
    await logPublishAttempt(svcKey, row);
    return { status: 'failed', reason: 'missing_token', dealer_name: dealerKey, envVar: cfg.tokenEnvVar };
  }

  // 4. Build payload from Supabase (26-field ported shape).
  let payload;
  try {
    payload = await buildDealerPayload(dealerKey, svcKey);
  } catch (e) {
    const row = {
      dealer_name:   dealerKey,
      listing_count: 0,
      published_at:  publishedAt,
      status:        'failed',
      notes:         'payload build failed: ' + String(e.message || e).slice(0, 400),
    };
    await logPublishAttempt(svcKey, row);
    return { status: 'failed', reason: 'payload_build', dealer_name: dealerKey, detail: String(e.message || e) };
  }

  // 5. POST to dealer function.
  let httpStatus = 0;
  let respBody   = '';
  try {
    const res = await fetch(cfg.functionUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type':'application/json',
      },
      body: JSON.stringify(payload),
    });
    httpStatus = res.status;
    respBody   = ((await res.text()) || '').slice(0, 400);
  } catch (e) {
    const row = {
      dealer_name:   dealerKey,
      listing_count: payload.length,
      published_at:  publishedAt,
      status:        'failed',
      notes:         'network error to dealer function: ' + String(e.message || e).slice(0, 400),
    };
    await logPublishAttempt(svcKey, row);
    return { status: 'failed', reason: 'network', dealer_name: dealerKey, detail: String(e.message || e) };
  }

  const ok = httpStatus >= 200 && httpStatus < 300;
  const row = {
    dealer_name:   dealerKey,
    listing_count: payload.length,
    published_at:  publishedAt,
    status:        ok ? 'success' : 'failed',
    notes:         ok ? null : `HTTP ${httpStatus}: ${respBody}`,
  };
  await logPublishAttempt(svcKey, row);

  if (ok) {
    return {
      status:        'success',
      dealer_name:   dealerKey,
      listing_count: payload.length,
      published_at:  publishedAt,
    };
  }
  return {
    status:        'failed',
    reason:        'dealer_http',
    dealer_name:   dealerKey,
    listing_count: payload.length,
    published_at:  publishedAt,
    http_status:   httpStatus,
    detail:        respBody,
  };
}

module.exports = { publishToDealerAndLog, lookupDealerByStock };
