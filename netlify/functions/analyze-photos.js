// Manual AI Intake v2 — read-only photo analyzer.
// Category-aware: the extraction prompt is built from the fieldset resolved by
// getFieldset(category, subcategory) — same intake-fieldsets module the browser
// mirror comes from. Writes NOTHING to the database; the caller decides what to
// do with the proposals.

const { getFieldset } = require('./lib/intake-fieldsets.generated.js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-8';   // supports image input; do NOT set temperature/top_p/top_k
const MAX_TOKENS    = 2048;   // sized for the largest fieldset (truck has ~10 ai_proposable fields)
const MAX_PHOTOS    = 8;
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Convert one photo input into an Anthropic image content block.
// http(s) URL                 -> { type:'image', source:{ type:'url', url } }
// data:<mt>;base64,<data>    -> base64 block with detected media_type (default jpeg)
// raw base64 (no prefix)     -> base64 block, media_type defaults to image/jpeg
function photoToBlock(photo) {
  const s = String(photo || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    return { type: 'image', source: { type: 'url', url: s } };
  }
  let mediaType = 'image/jpeg';
  let data = s;
  const m = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) {
    const detected = m[1].toLowerCase();
    if (SUPPORTED_MEDIA_TYPES.has(detected)) mediaType = detected;
    data = m[2];
  }
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

// Build the extraction prompt from the resolved fieldset. Only fields marked
// ai_proposable:true are asked of the model — human_only fields stay in the UI
// as reminders and are never sent to the model. Per-field prompt_rule strings
// (which encode the hours=meter-only doctrine, mileage/year strictness, and
// fuel=diesel-default-with-visual-override doctrine) come from the fieldset —
// no category-specific prompt text is hardcoded here.
function buildExtractionPrompt(fs) {
  const proposable    = fs.fields.filter(f => f.ai_proposable === true);
  const fieldNameList = proposable.map(f => f.key).join(', ');
  const perField      = proposable.map(f => {
    const q = f.question || ('What is the ' + (f.label || f.key) + '?');
    return '- ' + f.key + ': ' + q + (f.prompt_rule ? ' ' + f.prompt_rule : '');
  }).join('\n');
  // Optional category-level rules — not currently in the source, but supported
  // so a future source edit can add them without touching this file.
  const extraRules = (Array.isArray(fs.rules) ? fs.rules : []).map(r => '- ' + r).join('\n');
  const jsonShape  = proposable.map(f => `"${f.key}": {"value":..., "confidence":..., "reason":"..."}`).join(', ');

  return `${fs.preamble || 'You are identifying commercial equipment from photos for a commercial equipment marketplace.'}
Using ONLY what is visibly determinable in these photos, report these fields: ${fieldNameList}.

RULES:
- Use ONLY what the photos show. Do NOT infer specs from the model number, do NOT guess, do NOT use prior knowledge of the model's typical specs.
- For every field, include a confidence 0.0-1.0 and a short reason (e.g. 'Peterbilt badge visible on grille', 'hour meter reads 487', 'not determinable from photos').
- If a field cannot be determined, return value null with confidence 0. Do not omit it.
- NEVER include price, condition, service history, or title — these are not photo-derivable.${extraRules ? '\n' + extraRules : ''}

PER-FIELD EXTRACTION INSTRUCTIONS:
${perField}

ADDITIONALLY: include a "review_flags" array of short string flags noting items that should be manually checked, OR where a better photo would help determination. Examples: "Hours not visible — upload an hour-meter photo or ask the seller", "Tire condition not assessable from photos — inspect manually". Return an empty array if nothing needs flagging.

Return ONLY valid JSON, no prose, no markdown fences, in exactly this shape:
{ ${jsonShape}, "review_flags": ["...", "..."] }`;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const { category, subcategory, photos } = payload;
  if (!category || !String(category).trim()) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'category is required' })
    };
  }
  if (!subcategory || !String(subcategory).trim()) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'subcategory is required' })
    };
  }
  if (!Array.isArray(photos) || photos.length === 0) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'photos must be a non-empty array' })
    };
  }
  if (photos.length > MAX_PHOTOS) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `photos array exceeds maximum of ${MAX_PHOTOS}` })
    };
  }

  // Resolve the fieldset. getFieldset always returns something (generic_minimal
  // for unknown/Other), so this never throws. Defensive: if the resolved fieldset
  // somehow has zero ai_proposable fields, short-circuit to a clean 200 rather
  // than call Anthropic with a malformed prompt. This is the guard that fixes
  // the v1 regression where non-CTL subcategories 500'd because FIELD_MAP[sub]
  // was undefined.
  const fs = getFieldset(category, subcategory);
  const proposableFields = (fs && Array.isArray(fs.fields))
    ? fs.fields.filter(f => f.ai_proposable === true)
    : [];
  if (proposableFields.length === 0) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcategory,
        proposals: {},
        review_flags: ['No category-specific fields available for this selection — fill in fields manually.']
      })
    };
  }

  const imageBlocks = photos.map(photoToBlock).filter(Boolean);
  if (imageBlocks.length === 0) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'no usable photo entries (all empty or invalid)' })
    };
  }

  // Images BEFORE the text instruction (per Anthropic vision guidance).
  const content = [...imageBlocks, { type: 'text', text: buildExtractionPrompt(fs) }];

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const raw = (data.content?.[0]?.text || '').trim();

    // Strip ```json / ``` fences if the model wrapped despite being asked not to.
    let jsonText = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence && fence[1]) jsonText = fence[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      return {
        statusCode: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Model did not return valid JSON', raw })
      };
    }

    // Split review_flags out of the parsed object so the response shape is
    // { subcategory, proposals: {field map}, review_flags: [...] } rather than
    // nesting flags inside the field map. Default to [] if model omits or
    // returns a non-array (defensive).
    const { review_flags: rawReviewFlags, ...proposals } = parsed;
    const reviewFlags = Array.isArray(rawReviewFlags) ? rawReviewFlags : [];

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subcategory, proposals, review_flags: reviewFlags })
    };
  } catch (err) {
    console.error('analyze-photos error:', err.message);
    const status = err.message.startsWith('Anthropic API') ? 502 : 500;
    return {
      statusCode: status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Unknown error' })
    };
  }
};
