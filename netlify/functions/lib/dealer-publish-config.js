'use strict';

// Server-side dealer publish configuration.
//
// Keys mirror inventory.dealer VALUES exactly (same strings as index.html's
// PUBLISH_DEALERS at ~line 5983). They must match Supabase inventory.dealer
// for the payload builder to find rows.
//
// A dealer that is absent from this map is a SILENT NO-OP for the publish
// step. The underlying Supabase mutation is unaffected and still succeeds.
//
// ENV VARS TO SET ON THE ADMIN NETLIFY SITE:
//   PUBLISH_TOKEN_DAV    Davenport Motors
//   PUBLISH_TOKEN_FDT    Fat Daddy's Truck Sales
//   PUBLISH_TOKEN_WTS    Wilson Trailer Sales & Service
//
// Each value is the Bearer token the corresponding dealer function accepts
// on its POST (validated against INVENTORY_TOKEN in that dealer's own repo,
// e.g. wilson-trailer-sales/netlify/functions/inventory.js:36). The tokens
// are never hardcoded here.
const DEALERS = {
  'Davenport Motors': {
    functionUrl: 'https://davenportmotors.net/.netlify/functions/inventory',
    tokenEnvVar: 'PUBLISH_TOKEN_DAV',
  },
  "Fat Daddy's Truck Sales": {
    functionUrl: 'https://fatdaddystrucksales.netlify.app/.netlify/functions/inventory',
    tokenEnvVar: 'PUBLISH_TOKEN_FDT',
  },
  'Wilson Trailer Sales & Service': {
    functionUrl: 'https://wilson-trailer-sales.netlify.app/.netlify/functions/inventory',
    tokenEnvVar: 'PUBLISH_TOKEN_WTS',
  },
};

function getDealerConfig(dealerKey) {
  if (!dealerKey || typeof dealerKey !== 'string') return null;
  return DEALERS[dealerKey] || null;
}

module.exports = { DEALERS, getDealerConfig };
