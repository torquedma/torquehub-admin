'use strict';
// netlify/functions/lib/retreaver.js — Torque Hub ↔ Retreaver governed integration.
// Retreaver owns routing/destinations; Torque Hub owns identity, participation state and the buyer-facing number.
// Every remote mutation follows: LOCAL transition (atomic SQL fn) → REMOTE step(s) → LOCAL commit. reconcile() finishes or reverts.
// Env (ADMIN site only): RETREAVER_API_KEY, RETREAVER_COMPANY_ID (708), SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';
const RT_BASE = 'https://api.retreaver.com';
const CAMPAIGN_CID = 'VehicleNetwork';   // production campaign 2207
const AFID = '1';                        // publisher "1 – Equipment Scout – Ryan Davis" (affiliate id 2748), resolved live 2026-09-20
const RETAIN_DAYS = 30, QUIET_DAYS = 14; // provisional (candidate v2 I.7 / Part B v2.1)

const canon = (s) => { const d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') return '+' + d; if (d.length === 10) return '+1' + d; return null; };
const fmt = (e164) => e164 && /^\+1\d{10}$/.test(e164) ? `${e164.slice(2,5)}-${e164.slice(5,8)}-${e164.slice(8)}` : e164;

// ---------- Retreaver Core API ----------
function rtAuth() {
  const k = process.env.RETREAVER_API_KEY, c = process.env.RETREAVER_COMPANY_ID;
  if (!k || !c) throw new Error('RETREAVER_NOT_CONFIGURED');
  return `api_key=${encodeURIComponent(k)}&company_id=${encodeURIComponent(c)}`;
}
async function rt(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${RT_BASE}${path}${sep}${rtAuth()}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) { const e = new Error(`RETREAVER_${method}_${path.split('?')[0]}_${res.status}`); e.status = res.status; e.body = text.slice(0, 500); throw e; }
  return json;
}
const rtGetTarget  = (id) => rt('GET',    `/targets/${id}.json`).then(j => j && j.target);
const rtGetNumber  = (id) => rt('GET',    `/numbers/${id}.json`).then(j => j && j.number);
const rtPauseTarget= (id, paused) => rt('PUT', `/targets/${id}.json`, { target: { paused } }).then(j => j && j.target);
const rtDeleteNumber = (id) => rt('DELETE', `/numbers/${id}.json`);
const rtDeleteTarget = (id) => rt('DELETE', `/targets/${id}.json`);
async function rtLastCallAt(key) {
  const rows = await rt('GET', `/api/v2/calls.json?sub_id=${encodeURIComponent(key)}&sort_by=created_at&order=desc&per_page=1`);
  const c = Array.isArray(rows) && rows[0] && (rows[0].call || rows[0]);
  return c ? c.created_at : null;
}
const numberTagHasTarget = (num, targetId) => !!(num && Array.isArray(num.tag_values) && num.tag_values.some(t => t.key === 'system_target_id' && String(t.value) === String(targetId)));

// ---------- Supabase (service role) ----------
function sbHeaders(svcKey, prefer) { return { 'apikey': svcKey, 'Authorization': 'Bearer ' + svcKey, 'Content-Type': 'application/json', ...(prefer ? { 'Prefer': prefer } : {}) }; }
async function sb(svcKey, method, path, body, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: sbHeaders(svcKey, prefer), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`SUPABASE_${method}_${path.split('?')[0]}_${res.status}`); e.body = text.slice(0, 500); throw e; }
  return text ? JSON.parse(text) : null;
}
const sbRpc = (svcKey, fn, args) => sb(svcKey, 'POST', `rpc/${fn}`, args);
async function getIdentity(svcKey, key) { const r = await sb(svcKey, 'GET', `tracking_identities?key=eq.${encodeURIComponent(key)}&limit=1`); return r && r[0]; }
async function getDealerById(svcKey, id) { const r = await sb(svcKey, 'GET', `dealers?id=eq.${id}&select=id,name,phone,tracking_identity_id&limit=1`); return r && r[0]; }
async function liveRowCount(svcKey, tiId) { const r = await sb(svcKey, 'GET', `inventory?tracking_identity_id=eq.${tiId}&sold=not.is.true&select=id`); return (r || []).length; }
async function lastDeparture(svcKey, tiId) { const r = await sb(svcKey, 'GET', `inventory?tracking_identity_id=eq.${tiId}&select=sold_at,sold_marked_at,updated_at`); let m = null; (r || []).forEach(x => { const t = x.sold_at || x.sold_marked_at || x.updated_at; if (t && (!m || t > m)) m = t; }); return m; }
async function audit(svcKey, key, op, from, to, outcome, detail, actor) { try { await sb(svcKey, 'POST', 'tracking_events', { key, op, from_state: from || null, to_state: to || null, outcome, detail: detail || null, actor: actor || null }, 'return=minimal'); } catch (_) {} }
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const refuse = (code, extra) => ({ ok: false, code, ...(extra || {}) });

// ---------- verify(key): read-only cross-check ----------
async function verify(svcKey, key) {
  const ti = await getIdentity(svcKey, key); if (!ti) return refuse('NOT_FOUND');
  const checks = { state: ti.state };
  if (!['active', 'paused'].includes(ti.state)) return { ok: false, code: 'NOT_OPERATIONAL', checks };
  const target = await rtGetTarget(ti.retreaver_target_id); checks.target_found = !!target; checks.target_tid = target && target.tid; checks.target_paused = target && target.paused;
  const number = ti.retreaver_number_id ? await rtGetNumber(ti.retreaver_number_id) : null; checks.number_found = !!number; checks.number_sid = number && number.sid; checks.number_value = number && number.number;
  checks.bound = numberTagHasTarget(number, ti.retreaver_target_id);
  let expectedPublic = ti.public_number;
  if (ti.scope === 'dealer') { const d = await getDealerById(svcKey, ti.dealer_id); expectedPublic = d && d.phone; checks.dealer_phone = expectedPublic; checks.dealer_linked = d && d.tracking_identity_id === ti.id; }
  checks.public_matches_number = !!(number && expectedPublic && canon(expectedPublic) === canon(number.number));
  const ok = ti.state === 'active'
    ? (checks.target_found && checks.number_found && checks.bound && checks.public_matches_number && target.paused !== true)
    : (checks.target_found);
  return { ok, code: ok ? 'PASS' : 'MISMATCH', key, checks };
}

// ---------- provision: REMOTE FIRST with compensation, then local active identity ----------
// input: { scope:'dealer'|'seller'|'unit', key, dealer_id?, display_name, contact_first_name, destination_number, area_code?, unit_stocks?[] }
async function provision(svcKey, input, actor) {
  const { scope, key } = input;
  if (!['dealer', 'seller', 'unit'].includes(scope)) return refuse('BAD_SCOPE');
  if (!key || !/^[A-Z0-9][A-Z0-9-]{1,40}$/.test(key)) return refuse('BAD_KEY');
  if (await getIdentity(svcKey, key)) return refuse('KEY_EXISTS');
  const dest = canon(input.destination_number); if (!dest) return refuse('BAD_DESTINATION');
  if (scope === 'dealer') { const d = await getDealerById(svcKey, input.dealer_id); if (!d) return refuse('DEALER_NOT_FOUND'); if (d.tracking_identity_id) return refuse('DEALER_ALREADY_TRACKED'); }
  const name = `${key} · ${input.display_name || key}${input.contact_first_name ? ' · ' + input.contact_first_name : ''}`;
  let target = null, number = null;
  try {
    target = (await rt('POST', '/targets.json', { target: { number: dest, name, client_tid: key, time_zone: 'Eastern Time (US & Canada)' } })).target;
    if (!target || !target.id) throw new Error('TARGET_NO_ID');
    const numBody = { type: 'Local', country: 'US', afid: AFID, cid: CAMPAIGN_CID, sid: key };
    if (input.area_code && /^\d{3}$/.test(input.area_code)) numBody.desired_text = input.area_code;  // best-effort; unverified capability
    number = (await rt('POST', '/numbers.json', { number: numBody })).number;
    if (!number || !number.id) throw new Error('NUMBER_NO_ID');
    let bound = false;
    try { await rt('PUT', `/numbers/${number.id}.json`, { number: { tag_list: `<<<system_target_id:${target.id}>>>` } }); const rb = await rtGetNumber(number.id); bound = numberTagHasTarget(rb, target.id); } catch (_) { bound = false; }
    const publicE164 = canon(number.number), publicFmt = fmt(publicE164);
    const areaOk = !input.area_code || (publicE164 && publicE164.slice(2, 5) === input.area_code);
    // LOCAL: identity active (+ links)
    const ti = (await sb(svcKey, 'POST', 'tracking_identities', {
      scope, dealer_id: scope === 'dealer' ? input.dealer_id : null, key,
      public_number: scope === 'dealer' ? null : publicFmt,
      retreaver_target_id: target.id, retreaver_number_id: number.id, state: 'active', activated_at: new Date().toISOString(),
      notes: `provisioned ${new Date().toISOString().slice(0,10)} · dest ${fmt(dest)} · bound=${bound} · area_ok=${areaOk}`,
    }, 'return=representation'))[0];
    if (scope === 'dealer') await sb(svcKey, 'PATCH', `dealers?id=eq.${input.dealer_id}`, { phone: publicFmt, tracking_identity_id: ti.id }, 'return=minimal');
    else if (Array.isArray(input.unit_stocks) && input.unit_stocks.length) {
      const list = input.unit_stocks.map(s => `"${s}"`).join(',');
      await sb(svcKey, 'PATCH', `inventory?stock=in.(${list})`, { tracking_identity_id: ti.id, contact_phone: publicFmt }, 'return=minimal');
    }
    await audit(svcKey, key, 'provision', null, 'active', 'ok', { target_id: target.id, number_id: number.id, number: publicE164, bound, area_ok: areaOk }, actor);
    return { ok: true, code: bound ? 'PASS' : 'UNBOUND', key, public_number: publicFmt, target_id: target.id, number_id: number.id, bound, area_ok: areaOk,
             note: bound ? null : 'Number created but not bound to the Buyer via API — bind system_target_id in the Retreaver UI, then run verify.' };
  } catch (err) {
    // compensation: delete ONLY what this call created; surface an orphan row if compensation fails
    const leftover = [];
    if (number && number.id) { try { await rtDeleteNumber(number.id); } catch (_) { leftover.push(`number:${number.id}`); } }
    if (target && target.id) { try { await rtDeleteTarget(target.id); } catch (_) { leftover.push(`target:${target.id}`); } }
    if (leftover.length) { try { await sb(svcKey, 'POST', 'tracking_identities', { scope: scope === 'dealer' ? 'unit' : scope, key: `ORPHAN-${key}-${Date.now()}`, retreaver_target_id: target && leftover.includes(`target:${target.id}`) ? target.id : null, retreaver_number_id: number && leftover.includes(`number:${number.id}`) ? number.id : null, state: 'historical', notes: `orphan from failed provision of ${key}: ${err.message}` }, 'return=minimal'); } catch (_) {} }
    await audit(svcKey, key, 'provision', null, null, 'error', { error: err.message, body: err.body, leftover }, actor);
    return refuse('PROVISION_FAILED', { error: err.message, leftover });
  }
}

// ---------- optOut(dealer_id, direct_phone): local-safe-side first ----------
async function optOut(svcKey, dealerId, directPhone, actor) {
  const direct = canon(directPhone); if (!direct) return refuse('BAD_DIRECT_PHONE');
  let ti;
  try { ti = await sbRpc(svcKey, 'tracking_optout_begin', { p_dealer_id: dealerId, p_direct_phone: fmt(direct) }); }
  catch (e) { const code = /ALREADY_OFF|DEALER_NOT_FOUND|NOT_OPERATIONAL/.exec(e.body || '')?.[0] || 'OPTOUT_BEGIN_FAILED'; await audit(svcKey, null, 'optOut', null, null, 'refused', { dealer_id: dealerId, code }, actor); return refuse(code); }
  try { await rtPauseTarget(ti.retreaver_target_id, true); }
  catch (e) { await audit(svcKey, ti.key, 'optOut', 'pausing', null, 'error', { step: 'T1', error: e.message }, actor); return { ok: false, code: 'REMOTE_PAUSE_FAILED_RECONCILE_REQUIRED', key: ti.key }; }
  const done = await sbRpc(svcKey, 'tracking_complete_transition', { p_key: ti.key, p_to: 'paused' });
  await audit(svcKey, ti.key, 'optOut', 'active', 'paused', 'ok', { dealer_id: dealerId, direct: fmt(direct) }, actor);
  return { ok: true, code: 'PASS', key: done.key, state: done.state };
}

// ---------- pausePrivate(key): server-side LIVE gate inside tracking_begin_transition ----------
async function pausePrivate(svcKey, key, actor) {
  let ti;
  try { ti = await sbRpc(svcKey, 'tracking_begin_transition', { p_key: key, p_from: ['active'], p_to: 'pausing' }); }
  catch (e) { const code = /LIVE_ROWS_REMAIN|NOT_OPERATIONAL|NOT_FOUND/.exec(e.body || '')?.[0] || 'PAUSE_BEGIN_FAILED'; await audit(svcKey, key, 'pausePrivate', null, null, 'refused', { code }, actor); return refuse(code); }
  if (ti.scope === 'dealer') { await sbRpc(svcKey, 'tracking_complete_transition', { p_key: key, p_to: 'revert' }); return refuse('DEALER_SCOPE_USE_OPTOUT'); }
  try { await rtPauseTarget(ti.retreaver_target_id, true); }
  catch (e) { await audit(svcKey, key, 'pausePrivate', 'pausing', null, 'error', { step: 'T1', error: e.message }, actor); return { ok: false, code: 'REMOTE_PAUSE_FAILED_RECONCILE_REQUIRED', key }; }
  const done = await sbRpc(svcKey, 'tracking_complete_transition', { p_key: key, p_to: 'paused' });
  await audit(svcKey, key, 'pausePrivate', 'active', 'paused', 'ok', null, actor);
  return { ok: true, code: 'PASS', key, state: done.state };
}

// ---------- release(key): ONE path, all scopes; gates P1–P5 evaluated fresh ----------
async function release(svcKey, key, actor) {
  const ti = await getIdentity(svcKey, key); if (!ti) return refuse('NOT_FOUND');
  if (!['paused', 'releasing'].includes(ti.state)) return refuse('NOT_RELEASABLE', { state: ti.state });
  if (ti.scope === 'dealer') { const d = await getDealerById(svcKey, ti.dealer_id); if (d && d.tracking_identity_id) return refuse('DEALER_STILL_LINKED'); }
  else { const live = await liveRowCount(svcKey, ti.id); if (live > 0) return refuse('LIVE_ROWS_REMAIN', { live }); }
  const anchor = ti.scope === 'dealer' ? ti.paused_at : [ti.paused_at, await lastDeparture(svcKey, ti.id)].filter(Boolean).sort().pop();
  if (!anchor || anchor > daysAgo(RETAIN_DAYS)) return refuse('TOO_SOON', { anchor, retain_days: RETAIN_DAYS });
  if (!ti.retreaver_number_id) return refuse('NO_NUMBER_TO_RELEASE');
  const num = await rtGetNumber(ti.retreaver_number_id).catch(() => null);
  if (num && num.sid && num.sid !== key && ti.state === 'paused') return refuse('NOT_OURS', { sid: num.sid });
  const last = await rtLastCallAt(key); if (last && last > daysAgo(QUIET_DAYS)) return refuse('CALL_TAIL_ACTIVE', { last_call: last, quiet_days: QUIET_DAYS });
  if (ti.state === 'paused') { try { await sbRpc(svcKey, 'tracking_begin_transition', { p_key: key, p_from: ['paused'], p_to: 'releasing' }); } catch (e) { return refuse('RELEASE_BEGIN_FAILED', { body: e.body }); } }
  try { if (num) await rtDeleteNumber(ti.retreaver_number_id); }
  catch (e) { await audit(svcKey, key, 'release', 'releasing', null, 'error', { step: 'R1', error: e.message }, actor); return { ok: false, code: 'REMOTE_DELETE_FAILED_RECONCILE_REQUIRED', key }; }
  try { const t = await rtGetTarget(ti.retreaver_target_id); if (t && t.paused !== true) await rtPauseTarget(ti.retreaver_target_id, true); } catch (_) {}
  const done = await sbRpc(svcKey, 'tracking_complete_transition', { p_key: key, p_to: 'released' });
  await audit(svcKey, key, 'release', ti.state, 'released', 'ok', { number_id: ti.retreaver_number_id, anchor, last_call: last }, actor);
  return { ok: true, code: 'PASS', key, state: done.state, former_number: ti.public_number };
}

// ---------- reconcile(key): idempotent finish-or-revert for pausing / releasing ----------
async function reconcile(svcKey, key, actor) {
  const ti = await getIdentity(svcKey, key); if (!ti) return refuse('NOT_FOUND');
  if (!['pausing', 'releasing'].includes(ti.state)) return { ok: true, code: 'NOTHING_TO_DO', state: ti.state };
  if (ti.state === 'pausing') {
    const t = await rtGetTarget(ti.retreaver_target_id).catch(() => null);
    if (t && t.paused === true) { const d = await sbRpc(svcKey, 'tracking_complete_transition', { p_key: key, p_to: 'paused' }); await audit(svcKey, key, 'reconcile', 'pausing', 'paused', 'ok', null, actor); return { ok: true, code: 'COMPLETED', state: d.state }; }
    try { await rtPauseTarget(ti.retreaver_target_id, true); const d = await sbRpc(svcKey, 'tracking_complete_transition', { p_key: key, p_to: 'paused' }); await audit(svcKey, key, 'reconcile', 'pausing', 'paused', 'ok', { retried: 'T1' }, actor); return { ok: true, code: 'COMPLETED', state: d.state }; }
    catch (e) { return refuse('STILL_PENDING', { error: e.message }); }
  }
  // releasing
  const num = await rtGetNumber(ti.retreaver_number_id).catch(err => (err.status === 404 ? null : undefined));
  if (num === undefined) return refuse('STILL_PENDING', { error: 'number read failed' });
  if (num) { try { await rtDeleteNumber(ti.retreaver_number_id); } catch (e) { return refuse('STILL_PENDING', { error: e.message }); } }
  try { const t = await rtGetTarget(ti.retreaver_target_id); if (t && t.paused !== true) await rtPauseTarget(ti.retreaver_target_id, true); } catch (_) {}
  const d = await sbRpc(svcKey, 'tracking_complete_transition', { p_key: key, p_to: 'released' });
  await audit(svcKey, key, 'reconcile', 'releasing', 'released', 'ok', null, actor);
  return { ok: true, code: 'COMPLETED', state: d.state };
}

// Used by admin-write update_dealer: a tracked dealer's phone may only be its Retreaver Number.
async function assertDealerPhoneAllowed(svcKey, dealerName, newPhone) {
  const rows = await sb(svcKey, 'GET', `dealers?name=eq.${encodeURIComponent(dealerName)}&select=id,tracking_identity_id&limit=1`);
  const d = rows && rows[0]; if (!d || !d.tracking_identity_id) return { ok: true };
  const ti = (await sb(svcKey, 'GET', `tracking_identities?id=eq.${d.tracking_identity_id}&limit=1`))[0];
  const num = await rtGetNumber(ti.retreaver_number_id).catch(() => null);
  if (!num) return { ok: false, code: 'TRACKING_NUMBER_UNREADABLE' };
  return canon(newPhone) === canon(num.number) ? { ok: true } : { ok: false, code: 'TRACKING_PHONE_MISMATCH', expected: fmt(canon(num.number)) };
}

module.exports = { verify, provision, optOut, pausePrivate, release, reconcile, assertDealerPhoneAllowed, canon, fmt };
