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

module.exports = {
  stampFacts,
  buildClaim,
  // exported for testing / caller validation
  TRUST_LEVELS, SOURCE_VALUES, RELATIONS, MODES,
  compatibleValues,
};
