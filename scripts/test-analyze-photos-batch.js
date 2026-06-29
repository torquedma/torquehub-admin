// Batch tester for the analyze-photos Deploy Preview endpoint.
// Reads test cases from scripts/analyze-test-cases.json, POSTs each to the
// Deploy Preview, prints the raw response side-by-side, and saves a combined
// dump to scripts/analyze-batch-results.json for later review.
//
// Usage:   node scripts/test-analyze-photos-batch.js
// No npm deps. Uses built-in fetch (Node 18+).
// Does NOT touch any database. Does NOT push or deploy anything.

const fs = require('fs');
const path = require('path');

const ENDPOINT     = 'https://deploy-preview-1--admin-torquehub.netlify.app/.netlify/functions/analyze-photos';
const CASES_FILE   = path.join(__dirname, 'analyze-test-cases.json');
const RESULTS_FILE = path.join(__dirname, 'analyze-batch-results.json');
const PLACEHOLDER_RX = /REPLACE-WITH/i;

function divider(ch) { return ch.repeat(72); }

async function postCase(c) {
  const payload = {
    category: c.category,
    subcategory: c.subcategory,
    photos: c.photos
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = { _raw: text, _parse_error: 'response was not valid JSON' }; }
  return { status: res.status, body };
}

async function main() {
  // Read cases
  let cases;
  try {
    cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read ' + CASES_FILE + ': ' + e.message);
    process.exit(1);
  }
  if (!Array.isArray(cases) || cases.length === 0) {
    console.error('Test cases file must contain a non-empty array');
    process.exit(1);
  }

  console.log(divider('='));
  console.log('analyze-photos batch tester');
  console.log(divider('='));
  console.log('Endpoint: ' + ENDPOINT);
  console.log('Cases:    ' + cases.length);
  console.log('');

  const results = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const name = c.name || ('(unnamed #' + (i + 1) + ')');
    const photos = Array.isArray(c.photos) ? c.photos : [];

    console.log(divider('-'));
    console.log('[' + (i + 1) + '/' + cases.length + '] ' + name);
    console.log(divider('-'));
    console.log('category:    ' + (c.category || '(missing)'));
    console.log('subcategory: ' + (c.subcategory || '(missing)'));
    console.log('photos:      ' + photos.length + ' url(s)');

    // Skip cases whose photo URLs are still placeholders — surface clearly
    // rather than burning an Anthropic call on a guaranteed failure.
    const hasPlaceholder = photos.some(p => PLACEHOLDER_RX.test(String(p || '')));
    if (hasPlaceholder) {
      console.log('status:      SKIPPED — placeholder URL detected (populate real photo URLs first)');
      console.log('');
      results.push({
        name, category: c.category, subcategory: c.subcategory,
        status: 'skipped', reason: 'placeholder URL'
      });
      continue;
    }

    let status = null;
    let body = null;
    let error = null;
    try {
      const r = await postCase(c);
      status = r.status;
      body = r.body;
    } catch (e) {
      error = e.message;
    }

    console.log('status:      ' + (status == null ? 'NETWORK_ERROR' : status));
    if (error) {
      console.log('error:       ' + error);
    } else {
      console.log('response:');
      console.log(JSON.stringify(body, null, 2));
    }
    console.log('');

    results.push({
      name,
      category: c.category,
      subcategory: c.subcategory,
      http_status: status,
      response: body,
      error
    });
  }

  // Save combined results for review
  try {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(divider('='));
    console.log('Saved combined results: ' + RESULTS_FILE);
    console.log(divider('='));
  } catch (e) {
    console.error('Failed to write results file: ' + e.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
