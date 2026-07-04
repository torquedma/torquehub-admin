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

const { showMileage, showHours } = require('./usage-display.generated.js');
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
  if (showMileage(unit))               lines.push('Mileage: ' + unit.mileage);
  if (showHours(unit))                 lines.push('Hours: ' + unit.hours);
  if (trimSpec(unit.engine))           lines.push('Engine: ' + trimSpec(unit.engine));
  if (trimSpec(unit.transmission))     lines.push('Transmission: ' + trimSpec(unit.transmission));
  if (unit.drivetrain)                 lines.push('Drivetrain: ' + unit.drivetrain);
  if (unit.fuel)                       lines.push('Fuel: ' + unit.fuel);
  if (unit.vin)                        lines.push('VIN: ' + unit.vin);
  if (unit.stock)                      lines.push('Stock #: ' + unit.stock);

  return `You are writing inventory descriptions for Torque Hub, a commercial equipment marketplace.

Rewrite the following raw seller description into the Torque Hub standard format:

UNIT INFO:
${lines.join('\n')}

RAW DESCRIPTION:
${unit.raw_description || unit.description || ''}

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
  const detailLines = [];
  if (unit.year)                   detailLines.push('- Year: ' + unit.year);
  if (unit.make)                   detailLines.push('- Make: ' + unit.make);
  if (unit.model)                  detailLines.push('- Model: ' + unit.model);
  if (showMileage(unit))           detailLines.push('- Mileage: ' + unit.mileage);
  if (showHours(unit))             detailLines.push('- Hours: ' + unit.hours);
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
  // vPIC-enriched fields (verified, code-owned) — only when present.
  const vp = unit._vpic || {};
  if (vp.gvwrClass)  detailLines.push('- GVWR: ' + vp.gvwrClass);
  if (vp.bodyClass)  detailLines.push('- Body Class: ' + vp.bodyClass);
  // Inventory column wins over vPIC enrichment — emit vPIC horsepower only when
  // the inventory column is absent, so the buyer sees at most one Horsepower line.
  if (vp.horsepower && !unit.horsepower) detailLines.push('- Horsepower: ' + vp.horsepower + ' HP');
  if (vp.torque)     detailLines.push('- Torque: ' + vp.torque + ' lb-ft');
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
