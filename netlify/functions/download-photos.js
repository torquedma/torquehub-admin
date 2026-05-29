'use strict';

// Proxy for client-side photo downloads that would otherwise be blocked by CORS.
// Accepts http(s) URLs only — data: URLs are handled entirely client-side.
//
// Response size note: Netlify synchronous functions have a hard 6 MB response limit.
// This function enforces a 4 MB raw-bytes budget (≈5.3 MB base64) to stay safely under
// that limit. For listings with many large photos (>20 × 300 KB), some photos may be
// omitted with a warning; the client reports partial success rather than a silent empty zip.

const PHOTO_CAP     = 60;
const SIZE_BUDGET   = 4 * 1024 * 1024; // 4 MB raw → ~5.3 MB base64
const FETCH_TIMEOUT = 8000;             // ms per image — keeps total within Netlify's 10 s limit

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let photos;
  try {
    ({ photos } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!Array.isArray(photos) || photos.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'photos must be a non-empty array of { url, name? } objects' }),
    };
  }

  if (photos.length > PHOTO_CAP) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Safety cap: ${photos.length} photos exceeds limit of ${PHOTO_CAP}. Split into smaller batches.`,
      }),
    };
  }

  const invalid = photos.filter(p => !p.url || !/^https?:\/\//.test(p.url));
  if (invalid.length > 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `${invalid.length} entr${invalid.length === 1 ? 'y has a' : 'ies have'} non-http(s) URL. Only send http(s) URLs to this proxy.`,
      }),
    };
  }

  // results is indexed 1-to-1 with the input photos array; null means the fetch failed.
  const results    = new Array(photos.length).fill(null);
  const failedUrls = [];
  let totalBytes   = 0;
  let budgetExceeded = false;

  await Promise.all(photos.map(async (p, i) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const resp = await fetch(p.url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 TorqueHub/1.0' },
      });
      clearTimeout(timer);

      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);

      const buf = Buffer.from(await resp.arrayBuffer());

      totalBytes += buf.length;
      if (totalBytes > SIZE_BUDGET) {
        budgetExceeded = true;
        failedUrls.push(`${p.url} (4 MB response budget exceeded)`);
        return;
      }

      results[i] = {
        name:   p.name || `photo-${i + 1}.jpg`,
        base64: buf.toString('base64'),
      };
    } catch (e) {
      clearTimeout(timer);
      const reason = e.name === 'AbortError' ? 'timeout' : e.message;
      console.warn(`[download-photos] index ${i} failed (${reason}): ${p.url}`);
      failedUrls.push(p.url);
    }
  }));

  const succeeded = results.filter(Boolean).length;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Indexed same as input photos array; null entries = failed fetches.
      images:     results,
      total:      photos.length,
      succeeded,
      failed:     failedUrls.length,
      failedUrls,
      ...(budgetExceeded
        ? { warning: 'Response size budget (4 MB raw) exceeded — some photos omitted. Consider downloading in smaller batches.' }
        : {}),
    }),
  };
};
