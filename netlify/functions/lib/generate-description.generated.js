// GENERATED FROM generate-description.source.js — DO NOT EDIT. Run node scripts/generate-description-lib.js
// The description generator is factual, deterministic, and category-aware. It may reorganize and improve
// wording, but it never invents specifications, capabilities, or marketing claims that are not present
// in the canonical packet.
//
// Merged from the two prior diverged copies:
//   - Keeps A's usage-display gating (showMileage/showHours at both prompt-input and Key-Details output;
//     labels "Mileage"/"Hours"), "seller" terminology lock, and "the seller" contact line.
//   - Keeps B's cleanTrim taxonomy firewall, trim in prompt + defaultHeadline, inventory-column
//     horsepower with double-suffix guard, and vPIC-horsepower conflict resolution.
//   - Drops B's runtimeLabel category-switch and the ungated `if (unit.hours)` emission — replaced by
//     A's usage-display gating (fixes the phantom-usage bug: Construction crane truck now shows
//     Mileage, not "Hours Shown").
//
// Public interface (drop-in with the prior A/B copies):
//   module.exports = { buildPrompt, generateDescription };
//
// This is the SOURCE. Do not require it directly. Callers require the .generated.js mirror emitted by
// scripts/generate-description-lib.js.

'use strict';

const { showMileage, showHours, usageClass } = require('./usage-display.generated.js');
const { canonicalize }           = require('./taxonomy.generated.js');

function trimSpec(val) {
  if (!val) return val;
  return val.split(/\s*[—–]\s*|\s+-\s+/)[0].trim();
}

// cleanTrim — behavior parity with the locked title-composition doctrine in
// js/title-helpers.js + netlify/edge-functions/lib/title-helpers.js. Reuses
// the SAME canonicalize() firewall (single source of truth = taxonomy.json),
// rather than duplicating the taxonomy logic. Suppresses values that:
//   - are empty / 'used' / 'new'
//   - equal the make or model (case-insensitive de-dupe)
//   - look like a model fragment (e.g. "3500", "3500HD")
//   - resolve to a canonical subcategory (so a bare body type like "Dump Truck"
//     is suppressed, while a real OEM trim or non-taxonomy descriptor like
//     "Flatbed Dump Truck" passes through to the title).
function cleanTrim(unit) {
  const t = (unit.trim || '').trim();
  if (!t) return '';
  const lt = t.toLowerCase();
  if (lt === 'used' || lt === 'new') return '';
  if (lt === (unit.make || '').toLowerCase() || lt === (unit.model || '').toLowerCase()) return '';
  if (/^\d+[A-Za-z]{0,4}$/.test(t)) return '';      // model fragment (3500, 3500HD)
  if (canonicalize(t)) return '';                    // TAXONOMY FIREWALL: it's a category → suppress
  return t;
}

// T1.2-B Slice 1: provenance-aware usage classifier. Returns { mode, value, claim } where
// claim is the matched SELLER-sourced claim (or null). Only seller claims surface to buyers —
// internal notes (e.g. stampFacts-emitted 'contextualizes' claims) never do.
// Precedence: not-applicable > unknown > disputed/estimated/qualified > plain > fallback.
function usageProvenance(unit, factName) {
  const p = unit && unit.provenance && unit.provenance[factName];
  if (!p) return { mode: 'fallback' };                    // no provenance for this fact → caller uses existing gate
  if (p.applicable === false) return { mode: 'omit' };    // not-applicable by equipment type

  const claims = Array.isArray(p.claims) ? p.claims : [];
  const sellerClaims = claims.filter(c => c && c.source === 'seller');
  const unknownClaim  = sellerClaims.find(c => c.relation === 'states' && String(c.value == null ? '' : c.value).toLowerCase() === 'unknown') || null;
  // Explicit precedence: estimates_actual > disputes > qualifies. estimates_actual is
  // a superset (says inaccurate AND supplies the number) so it must win when both are present.
  const byRel = (r) => sellerClaims.find(c => c.relation === r) || null;
  const disputedClaim = byRel('estimates_actual') || byRel('disputes') || byRel('qualifies');

  if (p.trust === 'unknown' || p.value === null || p.value === undefined || unknownClaim) {
    return { mode: 'unknown', value: p.value, claim: unknownClaim };
  }
  if (disputedClaim) return { mode: 'disputed', value: p.value, claim: disputedClaim };
  return { mode: 'plain', value: p.value, claim: null };  // clean attributed → plain
}

// Thousands-separator for odometer/hour values. Strip existing commas/units first so it is
// idempotent; if not a positive integer after stripping, return the input unchanged (never NaN).
function formatNumber(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : (v == null ? '' : String(v));
}

// usageNoun — canonical meter-type vocabulary.
// FACT-SCOPED first: the caller's factName ('mileage'|'hours') wins, because a given
// sentence/flag is describing one specific fact. usageClass(unit) is only consulted when
// factName is absent/unrecognized. This prevents rendering an hours claim on an odometer
// truck as "Odometer shows N miles..." (unit-scoped noun mismatched to fact-scoped attribution).
// Returns null when neither factName nor usageClass resolves — callers use the neutral path.
function usageNoun(unit, factName) {
  if (factName === 'mileage') return { verb: 'Odometer shows',   unit: 'miles', reading: 'odometer',   kind: 'mileage' };
  if (factName === 'hours')   return { verb: 'Hour meter shows', unit: 'hours', reading: 'hour-meter', kind: 'hours'   };
  const cls = usageClass(unit);
  if (cls === 'odometer')    return { verb: 'Odometer shows',   unit: 'miles', reading: 'odometer',   kind: 'mileage' };
  if (cls === 'hours-based') return { verb: 'Hour meter shows', unit: 'hours', reading: 'hour-meter', kind: 'hours'   };
  return null;
}

// buildUsageSentence — verbatim Overview sentence, deterministic. The LLM must reproduce
// this string exactly; that responsibility is enforced by the USAGE DOCTRINE block in the
// prompt. No branching by category outside usageNoun; no editorializing.
function buildUsageSentence(unit, factName, value, claim) {
  const n = usageNoun(unit, factName);
  const rel = claim && claim.relation;
  const hasVal = value !== null && value !== undefined && String(value).trim() !== '';

  // Meter type unknown ('neither' subcategory). Use neutral vocabulary but STILL append the
  // seller attribution — dropping it would silently lose the dispute/estimate/unknown claim.
  if (!n) {
    console.warn('[usage-sentence] no meter type for ' + ((unit && unit.stock) || '?'));
    const observation = hasVal ? ('Displayed usage is ' + formatNumber(value) + '.') : '';
    let attribution = '';
    if (rel === 'disputes') {
      attribution = ' Seller states the reading is not accurate.';
    } else if (rel === 'states') {
      attribution = ' Seller states the actual usage is unknown.';
    } else if (rel === 'estimates_actual') {
      attribution = ' Seller states the reading is not accurate and reports approximately ' + formatNumber(claim.value) + ' in actual use.';
    } else if (rel === 'qualifies') {
      attribution = ' Seller states ' + (claim && (claim.note || claim.value)) + '.';
    }
    return (observation + attribution).trim();
  }

  const observation = hasVal ? (n.verb + ' ' + formatNumber(value) + ' ' + n.unit + '.') : '';
  let attribution = '';
  if (rel === 'disputes') {
    attribution = ' Seller states the ' + n.reading + ' reading is not accurate.';
  } else if (rel === 'states') {
    const usageNoun2 = n.unit === 'hours' ? 'hours' : 'mileage';
    const be = n.unit === 'hours' ? 'are' : 'is';
    attribution = ' Seller states the actual ' + usageNoun2 + ' ' + be + ' unknown.';
  } else if (rel === 'estimates_actual') {
    attribution = ' Seller states the ' + n.reading + ' reading is not accurate and reports approximately ' + formatNumber(claim.value) + ' actual ' + n.unit + '.';
  } else if (rel === 'qualifies') {
    attribution = ' Seller states ' + (claim && (claim.note || claim.value)) + '.';
  }
  return (observation + attribution).trim();
}

// usageFlag — short Key Details parenthetical. Points buyers to the Overview for detail.
function usageFlag(factName, claim, unit) {
  const n = usageNoun(unit, factName);
  const word = n ? n.unit : 'usage';
  const rel = claim && claim.relation;
  if (rel === 'disputes')         return '(seller-disputed — see description)';
  if (rel === 'states')           return '(actual ' + word + ' unknown — see description)';
  if (rel === 'estimates_actual') return '(seller reports different actual ' + word + ' — see description)';
  if (rel === 'qualifies')        return '(seller-qualified — see description)';
  return '';
}

function buildPrompt(unit, dealer) {
  const price = unit.price ? '$' + Number(unit.price).toLocaleString() : 'Call for Price';

  // Build UNIT INFO from non-empty fields only — sparse units get no blank labels.
  // Mileage/hours are gated by lib/usage-display's subcategory-level rule (single
  // canonical authority) — NOT a category-level switch (which mis-labels e.g.
  // Construction crane trucks whose actual runtime is odometer miles, not hours).
  const lines = [];
  lines.push('Year: ' + (unit.year || 'Unknown'));
  if (unit.make)  lines.push('Make: ' + unit.make);
  if (unit.model) lines.push('Model: ' + unit.model);
  // Real trim / body descriptor only — taxonomy firewall in cleanTrim suppresses
  // bare subcategory leakage (e.g. "Dump Truck") so the LLM can't invent a
  // generic taxonomy-shaped hook in place of the actual descriptor.
  const ct = cleanTrim(unit); if (ct) lines.push('Trim: ' + ct);
  lines.push('Price: ' + price);
  {
    const mp = usageProvenance(unit, 'mileage');
    if (mp.mode === 'omit') { /* omit */ }
    else if (mp.mode === 'unknown') {
      if (showMileage(unit) || unit.provenance?.mileage) {
        if (mp.claim) {
          lines.push('USAGE STATEMENT (reproduce verbatim in the Overview): ' + buildUsageSentence(unit, 'mileage', mp.value, mp.claim));
        } else {
          lines.push('Mileage: reported unknown by seller');
        }
      }
    }
    else if (mp.mode === 'disputed') {
      lines.push('USAGE STATEMENT (reproduce verbatim in the Overview): ' + buildUsageSentence(unit, 'mileage', mp.value, mp.claim));
    }
    else if (mp.mode === 'plain') { if (showMileage(unit)) lines.push('Mileage: ' + mp.value); }
    else { if (showMileage(unit)) lines.push('Mileage: ' + unit.mileage); }
  }
  {
    const hp = usageProvenance(unit, 'hours');
    if (hp.mode === 'omit') { /* omit */ }
    else if (hp.mode === 'unknown') {
      if (showHours(unit) || unit.provenance?.hours) {
        if (hp.claim) {
          lines.push('USAGE STATEMENT (reproduce verbatim in the Overview): ' + buildUsageSentence(unit, 'hours', hp.value, hp.claim));
        } else {
          lines.push('Hours: reported unknown by seller');
        }
      }
    }
    else if (hp.mode === 'disputed') {
      lines.push('USAGE STATEMENT (reproduce verbatim in the Overview): ' + buildUsageSentence(unit, 'hours', hp.value, hp.claim));
    }
    else if (hp.mode === 'plain') { if (showHours(unit)) lines.push('Hours: ' + hp.value); }
    else { if (showHours(unit)) lines.push('Hours: ' + unit.hours); }
  }
  if (trimSpec(unit.engine))           lines.push('Engine: ' + trimSpec(unit.engine));
  if (trimSpec(unit.transmission))     lines.push('Transmission: ' + trimSpec(unit.transmission));
  if (unit.drivetrain)                 lines.push('Drivetrain: ' + unit.drivetrain);
  if (unit.fuel)                       lines.push('Fuel: ' + unit.fuel);
  if (unit.vin)                        lines.push('VIN: ' + unit.vin);
  if (unit.stock)                      lines.push('Stock #: ' + unit.stock);

  // unit.description is DELIBERATELY NOT a fallback here. It is prior Presentation
  // output; feeding it back as a source seed makes each regeneration a paraphrase of
  // the previous paraphrase, laundering provenance and letting the generator treat its
  // own output as evidence. PRESENTATION OUTPUT IS NEVER A SOURCE INPUT.
  const rawEvidence = unit.raw_description || '';

  return `You are writing inventory descriptions for Torque Hub, a commercial equipment marketplace.

Rewrite the following raw seller description into the Torque Hub standard format:

UNIT INFO:
${lines.join('\n')}

RAW DESCRIPTION:
${rawEvidence}

USAGE DOCTRINE:
If UNIT INFO contains a line beginning "USAGE STATEMENT", you MUST reproduce that sentence verbatim and in full somewhere in the Overview, placed naturally. Do not rephrase, shorten, split, soften, or add to it. When reporting a disputed, unknown, qualified, or estimated usage reading:
- report the displayed mileage or hours only as an observation;
- attribute the seller's statement directly to the seller;
- include any seller-provided estimated value exactly as given;
- never resolve the disagreement or say which number is correct;
- never present either value as verified;
- never editorialize about the discrepancy or convert between units.

CRITICAL ACCURACY RULE:
Use ONLY information explicitly present in UNIT INFO or RAW DESCRIPTION above.
Do not infer, guess, decode, assume, or add any engine manufacturer, horsepower, torque, body style, drivetrain, mileage, condition, or specification that is not explicitly stated in the source.
If the source does not state it, omit it.
Accuracy over completeness.

TERMINOLOGY: Always refer to the inventory source as the "seller" — never "dealer" or "dealership" — in all output text, even if the raw description uses those words.

OUTPUT FORMAT — return EXACTLY two parts separated by a line containing only "===":
[Year] [Make] [Model] – [Short Buyer Hook]
===
[2-3 sentence Overview: what it is, condition, best use case. Professional, direct, blue-collar tone. No fluff. Only use the word "fleet" if the raw description explicitly mentions it.]

If a Trim value is provided in UNIT INFO, use the full "[Year] [Make] [Model] [Trim]" as the unit's name in the Overview's opening sentence (e.g. "This 1998 International 4700 Flatbed Dump Truck is powered by..."), not a generic class descriptor.

Do NOT write a "Key Details" section, bullet list, contact section, prices, or specs lists. ONLY the headline line, then "===", then the Overview prose.`;
}

async function generateDescription(unit, dealer, apiKey) {
  // EVIDENCE/PRESENTATION SEPARATION. Generation requires either genuine raw evidence, or
  // enough canonical identity to say what the unit IS. `unit.description` is NEVER either:
  // it is prior Presentation output, and promoting it upstream launders provenance.
  // An epistemic refusal is NOT an execution failure — hence a typed error, so callers can
  // distinguish "we declined to speak" from "generation broke".
  const hasRawEvidence = !!String(unit.raw_description || '').trim();
  if (!hasRawEvidence) {
    // Placeholder values represent ABSENCE, not identity. "Unknown" and "Assorted" are truthy
    // in JS but epistemically mean missing.
    const rawMake = String(unit.make || '').trim();
    const meaningfulMake = !!rawMake && !/^(unknown|assorted)$/i.test(rawMake);
    const model = String(unit.model || '').trim();
    // cleanTrim carries the taxonomy firewall: it returns '' for bare subcategory leakage,
    // model fragments, and condition words, so a suppressed trim correctly fails this gate.
    const hasIdentity = !!((meaningfulMake && model) || cleanTrim(unit));
    if (!hasIdentity) {
      const err = new Error('No source evidence and insufficient canonical identity to generate DX.');
      err.code = 'INSUFFICIENT_EVIDENCE';
      throw err;
    }
  }
  const detailLines = [];
  if (unit.year)                   detailLines.push('- Year: ' + unit.year);
  if (unit.make)                   detailLines.push('- Make: ' + unit.make);
  if (unit.model)                  detailLines.push('- Model: ' + unit.model);
  {
    const mp = usageProvenance(unit, 'mileage');
    if (mp.mode === 'omit') { /* not-applicable: render nothing */ }
    else if (mp.mode === 'unknown') {
      if (showMileage(unit) || unit.provenance?.mileage) {
        if (mp.claim) {
          const hasVal = mp.value !== null && mp.value !== undefined && String(mp.value).trim() !== '';
          detailLines.push(hasVal
            ? '- Mileage: ' + formatNumber(mp.value) + ' ' + usageFlag('mileage', mp.claim, unit)
            : '- Mileage: ' + usageFlag('mileage', mp.claim, unit));
        } else {
          detailLines.push('- Mileage: reported unknown by seller');
        }
      }
    }
    else if (mp.mode === 'disputed') {
      detailLines.push('- Mileage: ' + formatNumber(mp.value) + ' ' + usageFlag('mileage', mp.claim, unit));
    }
    else if (mp.mode === 'plain') { if (showMileage(unit)) detailLines.push('- Mileage: ' + formatNumber(mp.value)); }
    else { if (showMileage(unit)) detailLines.push('- Mileage: ' + formatNumber(unit.mileage)); }  // fallback: unchanged
  }
  {
    const hp = usageProvenance(unit, 'hours');
    if (hp.mode === 'omit') { /* not-applicable: render nothing */ }
    else if (hp.mode === 'unknown') {
      if (showHours(unit) || unit.provenance?.hours) {
        if (hp.claim) {
          const hasVal = hp.value !== null && hp.value !== undefined && String(hp.value).trim() !== '';
          detailLines.push(hasVal
            ? '- Hours: ' + formatNumber(hp.value) + ' ' + usageFlag('hours', hp.claim, unit)
            : '- Hours: ' + usageFlag('hours', hp.claim, unit));
        } else {
          detailLines.push('- Hours: reported unknown by seller');
        }
      }
    }
    else if (hp.mode === 'disputed') {
      detailLines.push('- Hours: ' + formatNumber(hp.value) + ' ' + usageFlag('hours', hp.claim, unit));
    }
    else if (hp.mode === 'plain') { if (showHours(unit)) detailLines.push('- Hours: ' + formatNumber(hp.value)); }
    else { if (showHours(unit)) detailLines.push('- Hours: ' + formatNumber(unit.hours)); }  // fallback: unchanged
  }
  if (trimSpec(unit.engine))       detailLines.push('- Engine: ' + trimSpec(unit.engine));
  // Horsepower from the inventory column with double-suffix guard — some feeds
  // store it with a unit already attached ("97 HP", "300 hp", "200-300 HP.").
  // Word boundary prevents matching e.g. trailing "...ship".
  if (unit.horsepower) {
    const hpVal    = String(unit.horsepower).trim();
    const hpSuffix = /\bhp\.?$/i.test(hpVal) ? '' : ' HP';
    detailLines.push('- Horsepower: ' + hpVal + hpSuffix);
  }
  if (trimSpec(unit.transmission)) detailLines.push('- Transmission: ' + trimSpec(unit.transmission));
  if (unit.drivetrain)             detailLines.push('- Drivetrain: ' + unit.drivetrain);
  if (unit.fuel)                   detailLines.push('- Fuel: ' + unit.fuel);
  if (unit.gvwr_class) detailLines.push('- GVWR: ' + unit.gvwr_class);
  if (unit.body_class) detailLines.push('- Body Class: ' + unit.body_class);
  const priceNum = Number(String(unit.price).replace(/[^0-9.]/g, ''));
  if (priceNum > 0)                detailLines.push('- Price: $' + priceNum.toLocaleString());
  if (unit.vin)                    detailLines.push('- VIN: ' + unit.vin);
  if (unit.stock)                  detailLines.push('- Stock #: ' + unit.stock);
  if (detailLines.length === 0 && unit.stock) detailLines.push('- Stock #: ' + unit.stock);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1536,
      messages: [{ role: 'user', content: buildPrompt(unit, dealer) }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const raw = (data.content?.[0]?.text || '').trim();
  const parts = raw.split(/\n?===\n?/);
  const defaultHeadline = [unit.year, unit.make, unit.model, cleanTrim(unit)].filter(Boolean).join(' ') || 'Unit Available';
  let headline = '';
  let overview = '';
  if (parts.length >= 2) {
    headline = (parts[0] || '').trim();
    overview = (parts.slice(1).join('\n').trim() || '').replace(/^Overview\s*/i, '').trim();
  } else {
    headline = defaultHeadline;
    overview = raw.replace(/^Overview\s*/i, '').trim();
  }
  if (!headline) headline = defaultHeadline;
  headline = headline.replace(/^#+\s*/, '').trim();
  overview = overview.replace(/^#+\s*/gm, '').trim();

  const d = dealer || {};
  let text = headline + '\n\nKey Details\n' + detailLines.join('\n') + '\n\nOverview\n' + overview;
  if (d.name || d.phone || d.location) {
    const contactBits = [d.phone, d.location].filter(Boolean).join(' | ');
    text += '\n\nInterested In This Unit?\nCall ' + (d.name || 'the seller') + (contactBits ? ': ' + contactBits : '');
  }
  return text;
}

module.exports = { buildPrompt, generateDescription };
