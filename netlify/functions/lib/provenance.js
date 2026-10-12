'use strict';

/**
 * ⚠ MIRRORED FILE — authoritative home: torque-hub-site/netlify/functions/lib/provenance.js
 * A byte-identical copy lives in torque-hub-admin/netlify/functions/lib/provenance.js.
 * This is hand-authored logic (no source→generated build step — there is nothing to compile it from).
 * If you edit one copy, you MUST copy it to the other repo. Keep them identical.
 *
 * Torque Hub — shared provenance helper (T1.1-c).
 *
 * THE SECURITY RULE (the spine — non-negotiable):
 *   Clients may submit values. Servers stamp provenance. Trust is NEVER accepted from the client.
 *   This module is server-only code. Callers pass source/trust they can HONESTLY claim from
 *   server-known origin (feed type, vin_decode, auth-verified userEmail). Never wire this to accept
 *   trust from a client payload.
 *
 * The helper owns: trust/source/relation validation, fact-object shape, merge rules, timestamps,
 * claims handling. Callers own: which fields they write, and what source/trust they can honestly claim.
 */

// ---- Enums (helper-owned; single source of truth) -------------------------------------------------

const TRUST_LEVELS = new Set(['verified', 'attributed', 'unknown']);
const TRUST_RANK = { unknown: 0, attributed: 1, verified: 2 };

const FACT_ORIGINS = new Set(['vin_decode', 'seller', 'human_admin', 'seller_photo_extraction']);
const FEED_ORIGINS = new Set([
  'truckpaper_apify', 'machinerytrader_apify', 'tractorhouse_apify', 'sandhills_direct',
  'endeavorsuite_feed', 'cfs', 'cfs_manual', 'cfs_public',
]);
const SOURCE_VALUES = new Set([...FACT_ORIGINS, ...FEED_ORIGINS, 'usage_display_rule', 'unknown']);

const RELATIONS = new Set([
  'qualifies', 'disputes', 'narrows', 'contextualizes', 'states', 'estimates_actual',
]);

const MODES = new Set(['fill-empty', 'overwrite']);

// ---- Helpers --------------------------------------------------------------------------------------

function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function normalize(v) {
  return String(v == null ? '' : v).toLowerCase().trim();
}

/**
 * "Compatible" = deterministic, NOT fuzzy. Normalized equality OR one is a substring of the other.
 * e.g. "Detroit" vs "Detroit DD13" -> compatible (refinement). "Cat" vs "Detroit DD13" -> not.
 */
function compatibleValues(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === '' || nb === '') return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function nowIso() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, matching census as_of format
}

// ---- Core: stampFacts -----------------------------------------------------------------------------

/**
 * stampFacts(existingProvenance, facts, opts) -> newProvenance  (PURE — no hidden state)
 *
 * @param existingProvenance {object|null} the row's current provenance (keyed by fact name)
 * @param facts {object} { factName: value, ... } — fields this producer writes THIS run
 * @param opts {object} { source, trust, as_of?, actor?, mode? }
 *   source: validated against SOURCE_VALUES
 *   trust:  validated against TRUST_LEVELS
 *   as_of:  timestamp (default today)
 *   actor:  server-known identity (e.g. userEmail) for human_admin writes — recorded in notes
 *   mode:   'fill-empty' (default) | 'overwrite'
 * @returns new provenance object (does not mutate inputs)
 */
function stampFacts(existingProvenance, facts, opts) {
  const { source, trust, as_of, actor, mode = 'fill-empty' } = opts || {};

  // ---- Validation (helper-owned; reject anything the enums don't allow) ----
  if (!TRUST_LEVELS.has(trust)) {
    throw new Error(`stampFacts: invalid trust "${trust}" (allowed: ${[...TRUST_LEVELS].join(', ')})`);
  }
  if (!SOURCE_VALUES.has(source)) {
    throw new Error(`stampFacts: invalid source "${source}"`);
  }
  if (!MODES.has(mode)) {
    throw new Error(`stampFacts: invalid mode "${mode}" (allowed: ${[...MODES].join(', ')})`);
  }
  if (!facts || typeof facts !== 'object') {
    throw new Error('stampFacts: facts must be an object of { factName: value }');
  }

  const asOf = as_of || nowIso();
  // Deep-ish clone of existing provenance so the function stays pure.
  const out = existingProvenance ? JSON.parse(JSON.stringify(existingProvenance)) : {};

  for (const [factName, rawValue] of Object.entries(facts)) {
    // Never stamp a fact with a blank value (blank isn't a claim; that's true absence -> omit).
    if (isBlank(rawValue)) continue;
    const value = String(rawValue);

    const incoming = { value, source, trust, as_of: asOf };
    if (actor && source === 'human_admin') {
      incoming.notes = [`Set by ${actor}.`];
    }

    const existing = out[factName];

    // Case 1 — no existing provenance for this fact -> set incoming as primary.
    if (!existing) {
      out[factName] = incoming;
      continue;
    }

    const existingRank = TRUST_RANK[existing.trust] ?? 0;
    const incomingRank = TRUST_RANK[trust];

    // Case 2 — incoming trust is HIGHER (e.g. attributed -> verified).
    if (incomingRank > existingRank) {
      if (compatibleValues(existing.value, value)) {
        // Mere refinement (Detroit -> Detroit DD13): incoming primary, preserve any prior claims, no new claim.
        const preservedClaims = existing.claims;
        out[factName] = incoming;
        if (preservedClaims) out[factName].claims = preservedClaims;
      } else {
        // Real disagreement (Cat vs Detroit): incoming primary; displaced value preserved as a claim.
        const claim = {
          value: existing.value,
          source: existing.source,
          trust: existing.trust,
          relation: 'contextualizes',
          note: `Source ${existing.source} reported ${existing.value}.`,
        };
        const priorClaims = Array.isArray(existing.claims) ? existing.claims : [];
        out[factName] = incoming;
        out[factName].claims = [...priorClaims, claim];
      }
      continue;
    }

    // Case 3 — incoming trust is LOWER or EQUAL.
    if (mode === 'overwrite' && incomingRank === existingRank) {
      // Same-trust human overwrite (admin editing a human_admin field): replace value, keep claims.
      const preservedClaims = existing.claims;
      out[factName] = incoming;
      if (preservedClaims) out[factName].claims = preservedClaims;
    } else {
      // Do NOT downgrade a higher-trust primary with a lower-trust rewrite.
      // If values differ, record incoming as a contextualizing claim; else no-op (fill-empty semantics).
      if (!compatibleValues(existing.value, value)) {
        const claim = {
          value,
          source,
          trust,
          relation: 'contextualizes',
          note: `Source ${source} reported ${value}.`,
        };
        const priorClaims = Array.isArray(existing.claims) ? existing.claims : [];
        // Avoid duplicate identical claims.
        const dup = priorClaims.some(c => c.value === value && c.source === source);
        out[factName].claims = dup ? priorClaims : [...priorClaims, claim];
      }
      // compatible + lower/equal trust in fill-empty mode -> keep existing primary, do nothing.
    }
  }

  return out;
}

// ---- Claim builder (helper-owned shape for explicit disputes/qualifications) ----------------------

/**
 * buildClaim — for producers that need to attach an explicit claim (dispute, stated-unknown, estimate)
 * rather than a value overwrite. Returns a validated claim object.
 */
function buildClaim({ value, source, trust, relation, note }) {
  if (!TRUST_LEVELS.has(trust)) throw new Error(`buildClaim: invalid trust "${trust}"`);
  if (!SOURCE_VALUES.has(source)) throw new Error(`buildClaim: invalid source "${source}"`);
  if (!RELATIONS.has(relation)) throw new Error(`buildClaim: invalid relation "${relation}"`);
  const claim = { value: value == null ? null : String(value), source, trust, relation };
  if (note) claim.note = note;
  return claim;
}

// ---- Adjudication marker (fact-object shape; helper-owned) ----------------------------------------
//
// provenance[<fact>].adjudication records that the OWNER adjudicated this fact's value. It is created
// and released ONLY by governed, Owner-authorized SQL (recorded_by 'governed_sql'). Nothing else can
// create it: stampFacts never emits the key, and no client allowlist forwards provenance. A writer
// that honors it (sync-truckpaper receiver, admin-write update_inventory) does not write the fact while
// the key is present, so the marker is never stamped over. readAdjudication CLASSIFIES; it never repairs.
//   none         — the fact has NO adjudication key; it is ordinary (an ordinary human_admin stamp included).
//   valid        — well-formed, and the primary is human_admin carrying the adjudicated value.
//   inconsistent — well-formed, but the primary no longer carries the adjudicated value.
//   malformed    — the adjudication key is PRESENT but not well-formed, including an explicit null (Chief final
//                  review 2026-10-11) and an unreplaced placeholder date or recorded_at token (an unexecuted
//                  template can never protect anything, and can never unprotect a row either).
// KEY PRESENCE decides protection, exactly as the database guard (jsonb ? 'adjudication') does: a null or broken
// marker is still a marker. Callers hold the fact for every state except 'none' and log the last two for governed
// reconcile.
const ADJUDICATION_BASES = new Set(['owner_confirmation', 'seller_listing_capture']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
// A real value: a non-empty string that is not an unreplaced template token such as "<CHIEF_RULING_REF>".
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '' && !/^<[^>]*>$/.test(s.trim());

function readAdjudication(fact) {
  // jsonb cannot hold undefined, so an own key whose value is undefined is not a stored key.
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)
      || !Object.prototype.hasOwnProperty.call(fact, 'adjudication') || fact.adjudication === undefined) {
    return { state: 'none' };
  }
  const a = fact.adjudication;
  const bad = (reason) => ({ state: 'malformed', reason, marker: a });
  if (a === null) return bad('marker is null');
  if (typeof a !== 'object' || Array.isArray(a)) return bad('marker is not an object');
  if (a.v !== 1) return bad('v must be 1');
  if (!nonEmpty(a.value)) return bad('value missing');
  if (a.authority !== 'owner') return bad('authority must be owner');
  if (!nonEmpty(a.authorized_by)) return bad('authorized_by missing');
  if (!(typeof a.authorized_on === 'string' && ISO_DATE.test(a.authorized_on))) return bad('authorized_on must be YYYY-MM-DD');
  if (!ADJUDICATION_BASES.has(a.basis)) return bad('basis invalid');
  if (!Array.isArray(a.evidence) || a.evidence.length === 0
      || !a.evidence.every((e) => e && typeof e === 'object' && nonEmpty(e.kind) && nonEmpty(e.ref))) {
    return bad('evidence missing');
  }
  if (!nonEmpty(a.ruling)) return bad('ruling missing');
  if (a.recorded_by !== 'governed_sql') return bad('recorded_by must be governed_sql');
  if (!(typeof a.recorded_at === 'string' && ISO_TIMESTAMP.test(a.recorded_at))) return bad('recorded_at must be an ISO timestamp');
  if (fact.source !== 'human_admin' || String(fact.value) !== a.value) {
    return { state: 'inconsistent', reason: `primary ${fact.source}:"${fact.value}" is not the adjudicated "${a.value}"`, marker: a };
  }
  return { state: 'valid', marker: a };
}

module.exports = {
  stampFacts,
  buildClaim,
  readAdjudication,
  // exported for testing / caller validation
  TRUST_LEVELS, SOURCE_VALUES, RELATIONS, MODES,
  compatibleValues,
};
