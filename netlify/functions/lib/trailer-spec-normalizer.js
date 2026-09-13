'use strict';

// trailer-spec-normalizer.js — Stage 0 SKELETON.
// Public entry: normalizeTrailerSpecs(rawDescription, category).
// CommonJS, zero external deps. No handlers yet: HGR/Impex/Allied/free-form all
// route through the skeleton to either a normalized-empty payload (HGR, TODO) or
// safe_fallback with a warning. safe_fallback MUST NOT mutate rawDescription.

/**
 * splitLines — the single source of truth for the sourceLineId scheme.
 * assertAccounting and every future disposition writer will reuse this helper,
 * so the ID rule lives here and nowhere else.
 *
 * Rules:
 *   - Split on newlines; empty / whitespace-only lines are DROPPED (no id).
 *   - The Nth non-empty physical line (0-based) receives parent index N.
 *     Its base id is 'L' + N (e.g. L0, L1, ...).
 *   - Parent indexing is decided BEFORE tab-splitting, so the count of sub-lines
 *     NEVER shifts subsequent parent indices. The physical non-empty line after
 *     L8 is always L9, whether L8 tab-split into two subs or none.
 *   - Tab-split pre-step: if a non-empty line matches /\t+(?=[-·])/, split it
 *     into sub-lines. Sub-lines carry the parent index with alpha suffixes:
 *     L8a, L8b, L8c, ... Empty sub-segments (e.g. from a leading tab) drop.
 *   - A line that does NOT tab-split keeps its bare parent id (L8, not L8a).
 *
 * @param {string} rawDescription
 * @returns {Array<{sourceLineId: string, text: string}>}
 */
function splitLines(rawDescription) {
  const out = [];
  if (rawDescription == null) return out;
  const physicalLines = String(rawDescription).split(/\r?\n/);
  const TAB_SPLIT = /\t+(?=[-·•])/;

  let parentIndex = -1;
  for (const rawLine of physicalLines) {
    if (rawLine.trim() === '') continue;      // empty / whitespace-only → no id, no parent bump
    parentIndex += 1;

    if (TAB_SPLIT.test(rawLine)) {
      const segments = rawLine.split(TAB_SPLIT);
      let suffixCode = 'a'.charCodeAt(0);
      for (const seg of segments) {
        const t = seg.trim();
        if (t === '') continue;               // drop empty sub-segments (e.g. leading-tab artifact)
        out.push({ sourceLineId: 'L' + parentIndex + String.fromCharCode(suffixCode), text: t });
        suffixCode += 1;
      }
    } else {
      out.push({ sourceLineId: 'L' + parentIndex, text: rawLine.trim() });
    }
  }
  return out;
}

/**
 * detectTrailerFormat — SHAPE only (no action/judgment values). Order matters:
 * most-specific-first, because Impex and Allied bodies can incidentally contain
 * bulleted lines that would otherwise satisfy the HGR rule.
 *   1 impex_labeled_sections   — "Quick Highlights:" and/or a "Why Choose" header
 *   2 allied_key_value         — "Weights & Dimensions" or "Category Specific"
 *   3 hgr_delimited            — ≥1 line whose first non-whitespace char is '-' or '·'
 *   4 free_form                — non-empty prose, none of the above
 *   5 unknown                  — empty / whitespace-only
 */
function detectTrailerFormat(rawDescription) {
  const src = String(rawDescription == null ? '' : rawDescription);
  if (src.trim() === '') return 'unknown';

  if (src.includes('Quick Highlights:') || /(^|\n)\s*Why Choose/i.test(src)) {
    return 'impex_labeled_sections';
  }
  if (src.includes('Weights & Dimensions') || src.includes('Category Specific')) {
    return 'allied_key_value';
  }
  for (const line of src.split(/\r?\n/)) {
    const t = line.trimStart();
    if (t.startsWith('-') || t.startsWith('·') || t.startsWith('•')) return 'hgr_delimited';
  }
  return 'free_form';
}

// ─────────────────────────────────────────────────────────────────────────────
// assignGroup — first-match-wins over an ORDERED [group, keywords] table.
// Chassis groups first (deck_loading before interior_buildout, etc.) so that
// "2″ Treated Pine Floor" lands in deck_loading rather than interior_buildout.
// Short keywords (length ≤ 3) are word-boundary-anchored on any side that
// ends in a word char; longer keywords use plain case-insensitive substring.
// ─────────────────────────────────────────────────────────────────────────────
const HGR_GROUPS = [
  ['deck_loading',         ['deck', 'dovetail', 'ramp', 'tilt', 'flat deck', 'bed length', 'slide in', 'treated pine', 'pine floor', 'wood floor', 'trailer floor']],
  ['axles_tires_brakes',   ['axle', 'tire', 'radial', 'brake', 'spring', 'suspension', 'wheel', 'gvwr', 'gawr', 'load range', 'lre', 'lr-e', 'dexter', 'lippert']],
  ['frame_construction',   ['frame', 'i-beam', 'ibeam', 'channel', 'crossmember', 'steel', 'tube', 'gauge', 'ga.', 'beavertail', 'bump rail']],
  ['coupling_support',     ['coupler', 'gooseneck', 'hitch', 'jack', 'drop leg', 'ball', 'pintle', 'safety chain', 'landing gear', 'chain tray']],
  ['electrical_lighting',  ['light', 'led', 'wiring', 'harness', 'plug', '7 way', 'rv', 'breakaway', 'break away', 'd.o.t', 'dot', 'receptacle', 'recept']],
  ['finish_convenience',   ['powdercoat', 'powder coat', 'paint', 'color', 'primer', 'sandblast', 'acid wash', 'stake pocket', 'toolbox', 'spare', 'side step', 'd-ring', 'tie down', 'pin stripe', 'stoneguard', 'trim']],
  ['interior_buildout',    ['cabinet', 'wall', 'ceiling', 'floor covering', 'vinyl floor', 'rubber floor', 'plywood wall', 'interior height', 'inside height', 'insulation', 'stud', 'door', 'window', 'screen', 'closet', 'escape door', 'kickplate', 'treadplate']],
  ['hvac_plumbing',        ['hvac', 'a/c', 'air conditioner', 'furnace', 'sink', 'water tank', 'water heater', 'plumbing', 'propane', 'exhaust hood', 'mini split', 'fresh water', 'freshwater', 'waste tank', 'bathroom and shower']],
  ['appliances_equipment', ['refrigerator', 'freezer', 'microwave', 'generator', 'converter', 'battery', 'stereo', 'appliance', 'winch', 'hot water heater', 'refridgerator']],
];

// Compile keyword → RegExp ONCE, at module load. Rule applies to EVERY keyword
// (no length gate). Only the FIRST and LAST characters of the keyword decide
// anchoring; punctuation inside is handled by escaping.
//
//   LEADING \b   — added when the FIRST char is a word char. Prevents keywords
//                  from matching inside larger words on the left.
//   TRAILING     — decided by the LAST char alone:
//                    alphabetic       → append  s?\b
//                    other word char  → append  \b
//                    non-word char    → append  nothing
//                  The trailing \b is what stops 'frame' from matching inside
//                  'FRAMELESS', 'wall' inside 'SIDEWALL', 'stud' inside 'STUDDED'.
//                  The optional 's' is LOAD-BEARING: without it a bare trailing
//                  \b would drop the ubiquitous plurals — DOORS, AXLES, WHEELS,
//                  BRAKES, TIRES, CABINETS, CROSSMEMBERS — collapsing much of
//                  the taxonomy into additional_features. Nothing beyond that:
//                  no irregular plurals, no stemming.
//                  A last char that is not a word char (e.g. 'ga.' ending in '.')
//                  gets no trailing anchor, because \b requires a word char on
//                  one side.
function _kwToRegex(kw) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = kw.charAt(0);
  const last  = kw.charAt(kw.length - 1);
  const left  = /\w/.test(first) ? '\\b' : '';
  let right;
  if      (/[a-z]/i.test(last)) right = 's?\\b';
  else if (/\w/.test(last))     right = '\\b';
  else                          right = '';
  return new RegExp(left + escaped + right, 'i');
}
const HGR_GROUP_MATCHERS = HGR_GROUPS.map(([group, kws]) => [group, kws.map(_kwToRegex)]);

// ─────────────────────────────────────────────────────────────────────────────
// HGR_OVERRIDES — ordered override layer, checked BEFORE the flat HGR_GROUPS map.
// Encodes OBJECT precedence that a flat first-match keyword map cannot express:
// e.g. an ACCESS DOOR is a finish item regardless of the 'gooseneck' token on
// the same line, and a (7)WAY PLUG is electrical regardless of the 'frame'
// token in a line about wiring welded to the frame.
//
// Every entry is backed by a G1 evidence row or an explicit Ryan judgment; no
// override may be added without one. Entries that produce no behavior change
// are DELIBERATELY EXCLUDED — regression protection belongs in the fixture
// diff and the golden assertions, not in production branches.
//
// MOST SPECIFIC FIRST; first match wins.
// ─────────────────────────────────────────────────────────────────────────────
const HGR_OVERRIDES = [
  [/^\d+\s*["“”″]?\s*wide\b/i,                           'deck_loading',        'R7 — T1260854 L9 "102” Wide"; bare overall-width dimension. Inch markers only: straight quote, curly quotes, double-prime. Single prime EXCLUDED — it denotes feet. Leading-digit anchor keeps this off "REAR DOOR OPENING WIDTH" and "68\" FROM THE WIDEST POINT".'],
  [/\bbetween\s+(?:the\s+)?fenders\b/i,                  'deck_loading',        'R7 — S1253510 L6; S1254388 L5; T1261698 L2. One concept, optional article. Must live here rather than in HGR_GROUPS because _kwToRegex escapes metacharacters, so a regex written as a keyword string would be compiled to a literal and match nothing.'],
  [/\b(rear|ramp) door opening\b/i,                      'deck_loading',        'R10 — 223168 L32/L33; TF112953 L12/L13; TA224280 L35/L36'],
  [/\baccess door\b/i,                                   'finish_convenience',  'Ryan judgment — TA224280 L14; gooseneck is location, not function'],
  [/\bside doors?\b/i,                                   'interior_buildout',   'R10 — 223168 L28; TA224280 L37; rv is a door style'],
  [/(\(7\)|\b7[\s-])way plug\b/i,                        'electrical_lighting', 'R2 — S1253510 L16; S1254388 L15; incidental FRAME'],
  [/\bbottom trim\b/i,                                   'finish_convenience',  'Ryan judgment — 223168 L15; TA224280 L24; trim is the object, DOT tape a qualifier'],
  [/\bspare\b.*\b(mount|rack|carrier|compartment)s?\b/i, 'finish_convenience',  'Ryan judgment R6 — storage hardware, not running gear'],
  [/\btire compartment\b/i,                              'finish_convenience',  'Ryan judgment R6 — TA224280 L57; no "spare" token in line'],
  [/\bspring assist\b/i,                                 'deck_loading',        'Ryan judgment D1/A1 — load access, not suspension'],
  [/\bstake pockets?\b/i,                                'deck_loading',        'Ryan judgment D1/A3 — cargo securement'],
  [/\bstuds?\b/i,                                        'frame_construction',  'Ryan judgment D2/A2 — structural member'],
  [/\broof bows?\b/i,                                    'frame_construction',  'Ryan judgment D2/A2 — structural member'],
];

function assignGroup(normalizedLine) {
  const s = normalizedLine == null ? '' : String(normalizedLine);
  for (const [rx, group] of HGR_OVERRIDES) {
    if (rx.test(s)) return group;
  }
  for (const [group, matchers] of HGR_GROUP_MATCHERS) {
    for (const rx of matchers) {
      if (rx.test(s)) return group;
    }
  }
  return 'additional_features';
}

/**
 * classifyHgr — HGR bullet-body classifier. Operates on splitLines() output only;
 * every text field is already trimmed and every empty line is already dropped.
 *
 * FIRST-MATCH-WINS in this exact order (no empty case — splitLines removed those):
 *   1  header           → excluded (rule: HEADER)
 *   2  dealer offer     → excluded (rule: DEALER_OFFER)
 *   3  marketing badge  → excluded (rule: MARKETING)
 *   4  '-'/'·' bullet   → keyDetails (confidence: 'high')
 *   5  pre-bullet prose → leadProse   (only when i < firstBulletIndex AND not spec-shaped)
 *   6  bare spec-shaped → keyDetails (confidence: 'low')
 *   7  fallthrough      → keyDetails (confidence: 'low') + UNCLASSIFIED warning
 *
 * SPEC-SHAPE = a POSITIVE signal, never a word-count guess:
 *   - starts with a recognized label (Length|Width|Height|Axle|GVWR|GAWR|Deck|Frame|Tongue)
 *     followed by a value, OR
 *   - starts with a digit (leading number/measurement), OR
 *   - contains a measurement token: " (inch), ' (foot), or whole-word lb/lbs/amp/volt/ft/in/ga.
 *
 * MOJIBAKE is a WARNING, not a disposition — matching entries still land in keyDetails;
 * normalizedLine strips the leading delimiter and collapses whitespace exactly as normal,
 * preserving garbled bytes without repair.
 *
 * Contradiction detection and assertAccounting are DEFERRED. conflictsWith stays undefined.
 * Grouping is delegated to assignGroup (chassis-first table); schemaHint is computed
 * afterward by inferSchemaHint in the routing layer.
 */
function classifyHgr(lines) {
  const leadProse = [];
  const keyDetails = [];
  const excluded = [];
  const warnings = [];

  const HEADER_TEXT_LOWER = 'trailers for everything and everything for trailers';
  const DEALER_OFFER_RX   = /^[-·]?\s*(WE CAN ADD|HGR'?S CAN ADD|HGRS? GUARANTEES)/i;
  // Rule 3 vocabulary. Each alternative is a LITERAL corpus-observed phrase — deliberately
  // NOT a hype or sentiment detector, which would eventually consume legitimate prose such as
  // "one-owner, always stored inside" or "recently repacked wheel bearings". The principle is
  // broad (remove unverifiable promotion, not prose); the implementation is narrow on purpose.
  // Adding a phrase here requires an OBSERVED CORPUS LINE, not an intuition.
  //
  // ANCHORING FOLLOWS THE EVIDENCE, and the asymmetry is deliberate:
  //   GOLD MINE SERIES / MORE UNITED TRAILERS TO COME — each is an ENTIRE source line, so
  //     each stays fully anchored.
  //   WORTH EVERY PENNY — appears INSIDE a long multi-sentence line, so it must be an
  //     unanchored substring to reach it. It is safe unanchored because it is distinctive
  //     endorsement language with no equipment meaning and cannot occur in a spec line.
  //   ONE OBSERVED LINE EARNS ONE RULE: 'NO CORNERS HAVE BEEN CUT' and 'THIS TRAILER IS
  //     RIGHT' also appear in that same L1 and are deliberately NOT added — WORTH EVERY PENNY
  //     already matches the line, so they would be pins producing no behavior change. They
  //     remain part of the recorded evidence for WHY L1 was judged promotional, not
  //     production branches, until another observed line requires them.
  //   NEVER anchor on '!!!!' or any punctuation-as-hype signal — a dealer could legitimately
  //     write '3500# AXLES!!!'.
  const MARKETING_RX      = new RegExp(
    '^[-·]?\\s*GOLD MINE SERIES$'
    + '|^[-·]?\\s*MORE UNITED TRAILERS TO COME$'
    + '|WORTH EVERY PENNY'
  , 'i');
  const DELIMITED_RX      = /^[-·•]/;
  const MOJIBAKE_RX       = /Ã|Â|\?1\/2/;
  const SPEC_LABEL_RX     = /^(Length|Width|Height|Axle|GVWR|GAWR|Deck|Frame|Tongue)\b\s*\S/i;
  const STARTS_DIGIT_RX   = /^\d/;
  const MEASUREMENT_RX    = /["']|\b(?:lb|lbs|amp|volt|ft|in|ga)\b/i;

  const isSpecShaped = (t) => SPEC_LABEL_RX.test(t) || STARTS_DIGIT_RX.test(t) || MEASUREMENT_RX.test(t);
  const normalizeLine = (text) => text.replace(/^[-·•]\s*/, '').replace(/\s+/g, ' ').trim();

  // Compute pre-bullet boundary ONCE — do not toggle state in the loop.
  const firstBulletIndex = lines.findIndex(({ text }) => DELIMITED_RX.test(text));

  const pushKeyDetail = (sourceLineId, text, confidence) => {
    const normalizedLine = normalizeLine(text);
    keyDetails.push({
      sourceLineId,
      originalLine: text,
      normalizedLine,
      group: assignGroup(normalizedLine),
      confidence,
      presentation: 'default',
      conflictsWith: undefined,
    });
    if (MOJIBAKE_RX.test(text)) {
      warnings.push({ code: 'MOJIBAKE', sourceLineIds: [sourceLineId], note: 'Mojibake preserved; not repaired.' });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const { sourceLineId, text } = lines[i];

    // 1. Header
    if (text.toLowerCase() === HEADER_TEXT_LOWER) {
      excluded.push({ sourceLineId, line: text, rule: 'HEADER' });
      continue;
    }
    // 2. Dealer offer
    if (DEALER_OFFER_RX.test(text)) {
      excluded.push({ sourceLineId, line: text, rule: 'DEALER_OFFER' });
      continue;
    }
    // 3. Marketing badge
    if (MARKETING_RX.test(text)) {
      excluded.push({ sourceLineId, line: text, rule: 'MARKETING' });
      continue;
    }
    // 4. Delimited spec
    if (DELIMITED_RX.test(text)) {
      pushKeyDetail(sourceLineId, text, 'high');
      continue;
    }
    // 5. Lead prose — only strictly before the first bullet, AND not spec-shaped.
    if (firstBulletIndex !== -1 && i < firstBulletIndex && !isSpecShaped(text)) {
      leadProse.push({ sourceLineId, text });
      continue;
    }
    // 6. Bare spec-shaped, no delimiter
    if (isSpecShaped(text)) {
      pushKeyDetail(sourceLineId, text, 'low');
      continue;
    }
    // 7. Fallthrough — retain, flag UNCLASSIFIED
    pushKeyDetail(sourceLineId, text, 'low');
    warnings.push({
      code: 'UNCLASSIFIED',
      sourceLineIds: [sourceLineId],
      note: 'Unclassified line; retained in additional_features.',
    });
  }

  return { leadProse, keyDetails, excluded, warnings };
}

/**
 * inferSchemaHint — advisory schema classification computed AFTER classifyHgr.
 * ADVISORY ONLY: this MUST NOT change any keyDetail's group. It reads the set of
 * groups that classification produced plus the full rawDescription (lowercased).
 *
 * Precedence: living_quarters → concession → chassis → unknown.
 *
 * @param {{ keyDetails: Array, rawDescription: string }} args
 * @returns {'chassis' | 'concession' | 'living_quarters' | 'unknown'}
 */
function inferSchemaHint({ keyDetails, rawDescription }) {
  const groups = new Set((keyDetails || []).map(k => k.group));
  const text = String(rawDescription || '').toLowerCase();

  if (groups.has('interior_buildout') && /bathroom|freshwater|fresh water|furnace|shower|living quarter/i.test(text)) {
    return 'living_quarters';
  }
  if (/concession|vendor|serving|hood|sink/i.test(text) &&
      (groups.has('interior_buildout') || groups.has('electrical_lighting') ||
       groups.has('hvac_plumbing')     || groups.has('appliances_equipment'))) {
    return 'concession';
  }
  if (groups.has('deck_loading') || groups.has('axles_tires_brakes') ||
      groups.has('frame_construction') || groups.has('coupling_support')) {
    return 'chassis';
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// detectContradictions — small, explicit contradiction detector. NO general
// equivalence engine. FIVE attributes only:
//   deck_length      (feet — ADDITIVE totals so "16'+2'" and "18'" both = 18)
//   width            (inches — first number on a width/between-fenders line)
//   axle_rating      (pounds — first weight on an axle line; commas/# stripped)
//   tire_size        (digits-only normalization of an ST or bare NNN/NN token)
//   tire_load_range  (single letter after "Load Range")
//
// A contradiction fires in a group iff ≥1 high AND ≥1 low entry exist AND at
// least one low value differs from the canonical (first) high value.
// KEEP BOTH: mark each conflicting low with presentation:'suppressed_due_to_conflict'
// and conflictsWith:<high sourceLineId>. Never touch the high entry. Delete nothing.
// Push ONE warning per contradicting group.
// ─────────────────────────────────────────────────────────────────────────────

// Derive a single {attribute, value} for a normalized line via first-match-wins
// over the five detectors in spec order. Returns {attribute:null, value:null}
// when nothing matches. Numbers are numeric; tire_size/tire_load_range are strings.
function _deriveAttribute(text) {
  const s = String(text == null ? '' : text);

  // 1. deck_length — additive foot total across the line.
  if (/deck\s*length/i.test(s) ||
      /\d+\s*['’]\s*\+\s*\d+\s*['’]/.test(s) ||
      /^\s*Length\s+\d+\s*['’]/i.test(s)) {
    const feetMatches = [...s.matchAll(/(\d+)\s*(?:['’]|\bft\b)/gi)];
    if (feetMatches.length > 0) {
      const total = feetMatches.reduce((sum, m) => sum + parseInt(m[1], 10), 0);
      return { attribute: 'deck_length', value: total };
    }
  }

  // 2. width — first number on a width/between-fenders line.
  if (/\bwidth\b/i.test(s) || /between\s+(?:the\s+)?fenders/i.test(s)) {
    const m = s.match(/(\d+)/);
    if (m) return { attribute: 'width', value: parseInt(m[1], 10) };
  }

  // 3. axle_rating — first weight on an axle line (also matches "axles").
  if (/\baxles?\b/i.test(s)) {
    const m = s.match(/(\d[\d,]*)/);
    if (m) {
      const w = parseInt(m[1].replace(/,/g, ''), 10);
      if (w > 0) return { attribute: 'axle_rating', value: w };
    }
  }

  // 4. tire_size — ST-prefixed first, else bare NNN/NN in tire context.
  const st = s.match(/\bST\d+[\/\-\d]+[A-Z]?\d*/i);
  if (st) {
    const digits = st[0].replace(/\D/g, '');
    if (digits) return { attribute: 'tire_size', value: digits };
  }
  const bare = s.match(/\b\d{3}[\/\-]\d{2}(?:R\d{2,3}|\d{0,3})?/i);
  if (bare && /tires?|radial|\bLR[A-Z]?\b|load\s*range/i.test(s)) {
    const digits = bare[0].replace(/\D/g, '');
    if (digits) return { attribute: 'tire_size', value: digits };
  }

  // 5. tire_load_range — single letter after "Load Range".
  const lr = s.match(/load\s*range\s*([A-Z])/i);
  if (lr) return { attribute: 'tire_load_range', value: lr[1].toUpperCase() };

  return { attribute: null, value: null };
}

function detectContradictions(keyDetails, warnings) {
  // Bucket entries by non-null attribute.
  const groups = new Map();
  for (const entry of (keyDetails || [])) {
    const derived = _deriveAttribute(entry.normalizedLine);
    if (derived.attribute == null) continue;
    if (!groups.has(derived.attribute)) groups.set(derived.attribute, []);
    groups.get(derived.attribute).push({ entry, value: derived.value });
  }

  for (const [attribute, members] of groups) {
    const highs = members.filter(m => m.entry.confidence === 'high');
    const lows  = members.filter(m => m.entry.confidence === 'low');
    if (highs.length === 0 || lows.length === 0) continue; // need both to constitute a contradiction

    const canonicalHigh = highs[0];
    const conflictingLows = lows.filter(l => l.value !== canonicalHigh.value);
    if (conflictingLows.length === 0) continue; // all lows agree with canonical high — no conflict

    // Mark each conflicting low; delete nothing; do NOT touch the high entry.
    for (const l of conflictingLows) {
      l.entry.presentation = 'suppressed_due_to_conflict';
      l.entry.conflictsWith = canonicalHigh.entry.sourceLineId;
    }

    const involvedIds = [
      ...highs.map(m => m.entry.sourceLineId),
      ...conflictingLows.map(l => l.entry.sourceLineId),
    ];
    warnings.push({
      code: 'CONTRADICTION',
      sourceLineIds: involvedIds,
      note: attribute + ': conflicting values retained; low-confidence reading suppressed for display.',
    });
  }
}

/**
 * normalizeTrailerSpecs — public entry. GATE FIRST, then detect and route.
 */
function normalizeTrailerSpecs(rawDescription, category) {
  // LOAD-BEARING: gate precedes detection. Never detect-then-gate.
  if (category !== 'Trailers') return null;

  const format = detectTrailerFormat(rawDescription);

  const base = {
    format,
    handling: 'safe_fallback',
    schemaHint: 'unknown',
    leadProse: [],
    keyDetails: [],
    excluded: [],
    warnings: [],
  };

  if (format === 'hgr_delimited') {
    const { leadProse, keyDetails, excluded, warnings } = classifyHgr(splitLines(rawDescription));
    detectContradictions(keyDetails, warnings);
    return {
      format: 'hgr_delimited',
      handling: 'normalized',
      schemaHint: inferSchemaHint({ keyDetails, rawDescription }),
      leadProse,
      keyDetails,
      excluded,
      warnings,
    };
  }

  if (format === 'impex_labeled_sections') {
    return { ...base, warnings: [{
      code: 'FORMAT_HANDLER_DEFERRED',
      sourceLineIds: [],
      note: 'Impex format detected; existing description path preserved.',
    }] };
  }

  if (format === 'allied_key_value') {
    return { ...base, warnings: [{
      code: 'FORMAT_HANDLER_DEFERRED',
      sourceLineIds: [],
      note: 'Allied format detected; existing description path preserved.',
    }] };
  }

  if (format === 'free_form') {
    return { ...base, warnings: [{
      code: 'FORMAT_FREE_FORM',
      sourceLineIds: [],
      note: 'No structured format detected; existing description path preserved.',
    }] };
  }

  // format === 'unknown'
  return { ...base, warnings: [{
    code: 'FORMAT_UNKNOWN',
    sourceLineIds: [],
    note: 'Raw description is empty or unparseable; existing description path preserved.',
  }] };
}

// ─────────────────────────────────────────────────────────────────────────────
// assertAccounting — TEST-TIME helper (not called from normalizeTrailerSpecs).
// Reports every contract violation it finds; never throws for a contract issue.
// Throws TypeError only when rawDescription is not a string — that is a
// programming error at the CALL SITE, not a fixture/output violation.
//
// Raw byte-identity of rawDescription is deliberately NOT checked here. JS
// strings are immutable and this helper receives no transformed copy, so any
// in-helper comparison would be a meaningless self-check. Byte-identity is
// asserted at the Step 6 fixture call sites where the raw body and the
// normalized-input string are two independent references worth comparing.
// ─────────────────────────────────────────────────────────────────────────────
function assertAccounting(result, rawDescription) {
  if (typeof rawDescription !== 'string') {
    throw new TypeError('assertAccounting: rawDescription must be a string');
  }

  // Rule 1: category gate short-circuit — nothing to account for.
  if (result === null) return { ok: true, violations: [] };

  const violations = [];

  // CHANGE 1 — SHAPE validation. Accumulating (never early-returns). An absent
  // or wrong-typed field must be VISIBLE, not silently coerced to []. describe()
  // is needed because JSON.stringify(undefined) returns undefined, not a string.
  const describe = (v) =>
    v === undefined ? 'undefined' :
    v === null      ? 'null'      :
    JSON.stringify(v);
  const validateShape = (raw, name) => {
    if (!Array.isArray(raw)) {
      violations.push('SHAPE: ' + name + ' must be an array (got ' + describe(raw) + ')');
      return [];
    }
    return raw;
  };
  const leadProse  = validateShape(result && result.leadProse,  'leadProse');
  const keyDetails = validateShape(result && result.keyDetails, 'keyDetails');
  const excluded   = validateShape(result && result.excluded,   'excluded');
  const warnings   = validateShape(result && result.warnings,   'warnings');

  const handling = result && result.handling;

  // Rule 5: unknown handling value → early return. SHAPE violations already
  // in `violations` come along, so callers see the full picture.
  if (handling !== 'normalized' && handling !== 'safe_fallback') {
    violations.push('HANDLING: unknown handling value ' + JSON.stringify(handling));
    return { ok: false, violations };
  }

  // Rule 4: safe_fallback contract — the three arrays must be empty, warnings
  // must be a single entry with an allowlisted code. NO accounting union here.
  if (handling === 'safe_fallback') {
    if (leadProse.length !== 0)  violations.push('SAFE_FALLBACK: leadProse must be empty (got ' + leadProse.length + ')');
    if (keyDetails.length !== 0) violations.push('SAFE_FALLBACK: keyDetails must be empty (got ' + keyDetails.length + ')');
    if (excluded.length !== 0)   violations.push('SAFE_FALLBACK: excluded must be empty (got ' + excluded.length + ')');
    if (warnings.length !== 1) {
      violations.push('SAFE_FALLBACK: warnings must have exactly 1 entry (got ' + warnings.length + ')');
    } else {
      const code = warnings[0] && warnings[0].code;
      const allowed = new Set(['FORMAT_HANDLER_DEFERRED', 'FORMAT_FREE_FORM', 'FORMAT_UNKNOWN']);
      if (!allowed.has(code)) {
        violations.push('SAFE_FALLBACK: warning code must be one of FORMAT_HANDLER_DEFERRED, FORMAT_FREE_FORM, FORMAT_UNKNOWN (got ' + JSON.stringify(code) + ')');
      }
    }
    return { ok: violations.length === 0, violations };
  }

  // Rule 2 + 3: normalized — full accounting union.
  // Re-derive expected ids via THIS MODULE'S OWN splitLines — same reference the
  // normalizer used. If the id scheme drifts, this is the drift-detector.
  const expectedList = splitLines(rawDescription);
  const expected     = expectedList.map((l) => l.sourceLineId);
  const expectedSet  = new Set(expected);

  // CHANGE 2 — SPLIT_ID_COLLISION. When expected is degenerate (splitLines
  // emitted a duplicate id) the accounting union is meaningless: one disposition
  // can satisfy two distinct input lines while MISSING and FOREIGN both stay
  // silent. This is the ONE condition under which the accounting invariant
  // cannot be evaluated at all, so it's the ONE place an early-return is
  // correct inside the normalized branch.
  if (expected.length !== expectedSet.size) {
    const seen = new Set();
    const dups = [];
    for (const id of expected) {
      if (seen.has(id) && !dups.includes(id)) dups.push(id);
      seen.add(id);
    }
    violations.push('SPLIT_ID_COLLISION: ' + dups.join(', ') + ' emitted more than once by splitLines');
    return { ok: false, violations };
  }

  const arrayNames = ['leadProse', 'keyDetails', 'excluded'];
  const arrayLists = { leadProse, keyDetails, excluded };

  // CHANGE 3 — MALFORMED disposition entries. An entry whose sourceLineId is
  // null/undefined/non-string is invalid. Push one MALFORMED per broken entry
  // and DROP it from downstream accounting (contributes nothing to dispositioned,
  // never appears in DUPLICATE/OVERLAP/FOREIGN). The input line it should have
  // owned naturally surfaces as MISSING — both firing together is the intended,
  // complete diagnosis. Never infer or repair the id.
  const idsByArray = {};
  for (const arrName of arrayNames) {
    const list = arrayLists[arrName];
    const good = [];
    for (let idx = 0; idx < list.length; idx++) {
      const id = list[idx] && list[idx].sourceLineId;
      if (typeof id !== 'string') {
        violations.push('MALFORMED: ' + arrName + '[' + idx + '] has no sourceLineId');
        continue;
      }
      good.push(id);
    }
    idsByArray[arrName] = good;
  }

  // 3b: DUPLICATE within a single array.
  for (const arrName of arrayNames) {
    const seen = new Set();
    const dups = [];
    for (const id of idsByArray[arrName]) {
      if (id == null) continue;
      if (seen.has(id) && !dups.includes(id)) dups.push(id);
      seen.add(id);
    }
    if (dups.length > 0) {
      violations.push('DUPLICATE: ' + dups.join(', ') + ' appears more than once in ' + arrName);
    }
  }

  // 3c: OVERLAP — id in more than one of the three arrays.
  const memberOf = new Map();
  for (const arrName of arrayNames) {
    for (const id of idsByArray[arrName]) {
      if (id == null) continue;
      if (!memberOf.has(id)) memberOf.set(id, []);
      const list = memberOf.get(id);
      if (!list.includes(arrName)) list.push(arrName);
    }
  }
  for (const [id, arrNames] of memberOf) {
    if (arrNames.length > 1) {
      const joined = arrNames.length === 2
        ? 'both ' + arrNames[0] + ' and ' + arrNames[1]
        : arrNames.slice(0, -1).join(', ') + ', and ' + arrNames[arrNames.length - 1];
      violations.push('OVERLAP: ' + id + ' in ' + joined);
    }
  }

  // Union of dispositioned ids across the three arrays (for 3d/3e).
  const dispositioned = new Set();
  for (const arrName of arrayNames) {
    for (const id of idsByArray[arrName]) if (id != null) dispositioned.add(id);
  }

  // 3d: MISSING — expected ids not dispositioned. Preserve splitLines order.
  const missing = expected.filter((id) => !dispositioned.has(id));
  if (missing.length > 0) {
    violations.push('MISSING: ' + missing.join(', ') + ' not dispositioned');
  }

  // 3e: FOREIGN — dispositioned ids not in expected. Preserve first-seen order.
  const foreignSeen = new Set();
  const foreign = [];
  for (const arrName of arrayNames) {
    for (const id of idsByArray[arrName]) {
      if (id != null && !expectedSet.has(id) && !foreignSeen.has(id)) {
        foreignSeen.add(id);
        foreign.push(id);
      }
    }
  }
  if (foreign.length > 0) {
    violations.push('FOREIGN: ' + foreign.join(', ') + ' not in expected line ids');
  }

  // 3f: warnings ANNOTATE only — sourceLineIds must be a subset of expected.
  // An empty sourceLineIds array is legal (e.g. FORMAT_HANDLER_DEFERRED).
  const warningForeignSeen = new Set();
  const warningForeign = [];
  for (const w of warnings) {
    const wids = w && Array.isArray(w.sourceLineIds) ? w.sourceLineIds : [];
    for (const id of wids) {
      if (id != null && !expectedSet.has(id) && !warningForeignSeen.has(id)) {
        warningForeignSeen.add(id);
        warningForeign.push(id);
      }
    }
  }
  if (warningForeign.length > 0) {
    violations.push('WARNING_FOREIGN: ' + warningForeign.join(', ') + ' in warnings.sourceLineIds not in expected');
  }

  return { ok: violations.length === 0, violations };
}

module.exports = { normalizeTrailerSpecs, detectTrailerFormat, splitLines, classifyHgr, assignGroup, inferSchemaHint, detectContradictions, assertAccounting };
