// Manual AI Intake v1 — read-only photo analyzer.
// Accepts 1-8 photo URLs / data URLs and returns proposed inventory fields with
// confidence + reason for each. Writes NOTHING to the database; the caller decides
// what to do with the proposals.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-8';   // supports image input; do NOT set temperature/top_p/top_k
const MAX_TOKENS    = 1024;
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

// CTL field set hardcoded for v1 (no schema system yet).
function buildExtractionPrompt() {
  return `You are identifying a Compact Track Loader from photos for a commercial equipment marketplace. Using ONLY what is visibly determinable in these photos, report these fields: make, model, year, hours, cab_type (Open ROPS | Enclosed Cab), aux_hydraulics (None | Standard Flow | High Flow), track_type (Rubber | Steel), fuel (Diesel | Electric), attachments_included (array of strings).
RULES:
- Use ONLY what the photos show. Do NOT infer specs from the model number, do NOT guess, do NOT use prior knowledge of the model's typical specs.
- hours: provide a number ONLY if an hour-meter / dashboard reading is legibly visible in a photo (read the displayed number). If no meter is legible, return null. NEVER estimate hours.
- For every field, include a confidence 0.0-1.0 and a short reason (e.g. 'Bobcat decals visible', 'hour meter reads 487', 'not determinable from photos').
- If a field cannot be determined, return value null with confidence 0. Do not omit it.
- NEVER include price, condition, service history, or title — these are not photo-derivable.
Fuel rule: For compact track loaders and similar large construction equipment, default fuel is Diesel unless clear electric indicators are visible, such as electric model branding, a charge port, battery pack, or zero-emissions markings. If returning Diesel by category default rather than visual confirmation, say so in the reason. If electric indicators are visible, return Electric with high confidence. Do not use low confidence for Diesel solely because a fuel label is not visible.
ADDITIONALLY: include a "review_flags" array of short string flags noting items that should be manually checked, OR where a better photo would help determination. Examples: "Hours not visible — upload an hour-meter photo or ask the seller", "Track condition not assessable from photos — inspect manually". Return an empty array if nothing needs flagging.
Return ONLY valid JSON, no prose, no markdown fences, in exactly this shape:
{ "make": {"value":..., "confidence":..., "reason":"..."}, ..., "review_flags": ["...", "..."] }`;
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

  const imageBlocks = photos.map(photoToBlock).filter(Boolean);
  if (imageBlocks.length === 0) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'no usable photo entries (all empty or invalid)' })
    };
  }

  // Images BEFORE the text instruction (per Anthropic vision guidance).
  const content = [...imageBlocks, { type: 'text', text: buildExtractionPrompt() }];

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
