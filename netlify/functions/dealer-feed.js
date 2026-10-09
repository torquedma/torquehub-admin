'use strict';

// dealer-feed.js — public, read-only dealer inventory feed (pull model).
//
// Chief ruling 2026-10-07 on design 14NqveYH0QuEmYu2FiPdnOvZgmIiPNJ_RJZjmG19z8xA,
// Decision 1: ONE public ADMIN GET endpoint backed by the existing
// buildDealerPayload() contract, with a closed dealer-code map (lib/dealer-feed-codes.js).
//
//   GET /.netlify/functions/dealer-feed?dealer=ATC|DAV|FDT|WTS
//
// - The body is exactly buildDealerPayload(dealer) — the canonical dealer payload
//   (27 keys, status = 'published' rows only). The dealer sites read only this feed;
//   the temporary server push publisher was retired (Chief 2026-10-09).
// - No auth: the data is already public on the dealer sites. The Supabase
//   service key stays inside this function and never appears in a response.
// - Unknown or missing dealer code -> 404. Non-GET -> 405. Build failure -> 502.
//   Error responses are never cached; error detail is logged, not returned.
// - 200 responses are CDN-cacheable for 60 s (s-maxage=60) so public traffic
//   cannot turn into one Supabase SELECT per request; dealer sites add their
//   own cache on top.
// - This function never writes anything.

const { getDealerByCode } = require('./lib/dealer-feed-codes');
const { buildDealerPayload } = require('./lib/publish-payload');

const OK_CACHE = 'public, max-age=0, s-maxage=60';
const NO_STORE = 'no-store';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Feed-Dealer, X-Feed-Generated-At, X-Feed-Count',
};

function reply(statusCode, body, cacheControl, extraHeaders) {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, 'Cache-Control': cacheControl, ...(extraHeaders || {}) },
    body: body === '' ? '' : JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const method = String((event && event.httpMethod) || 'GET').toUpperCase();
  if (method === 'OPTIONS') return reply(204, '', NO_STORE);
  if (method !== 'GET') return reply(405, { error: 'method_not_allowed' }, NO_STORE);

  const params = (event && event.queryStringParameters) || {};
  const code = String(params.dealer || '').trim().toUpperCase();
  const dealerKey = getDealerByCode(code);
  if (!dealerKey) return reply(404, { error: 'unknown_dealer' }, NO_STORE);

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    console.error('[dealer-feed] SUPABASE_SERVICE_ROLE_KEY is not set');
    return reply(500, { error: 'feed_unavailable' }, NO_STORE);
  }

  let units;
  try {
    units = await buildDealerPayload(dealerKey, svcKey);
  } catch (e) {
    console.error(`[dealer-feed] build failed for ${code}:`, String((e && e.message) || e).slice(0, 300));
    return reply(502, { error: 'feed_unavailable' }, NO_STORE);
  }

  return reply(200, units, OK_CACHE, {
    'X-Feed-Dealer': code,
    'X-Feed-Generated-At': new Date().toISOString(),
    'X-Feed-Count': String(units.length),
  });
};
