'use strict';

// Closed dealer-code map for the public pull feed (dealer-feed.js; Chief rulings 2026-10-07/09).
//
// Keys mirror inventory.dealer VALUES exactly; they must match Supabase inventory.dealer for the payload
// builder to find rows. Only these three codes resolve; anything else is 404 at the feed.
// The dealer sites (Wilson, Davenport, Fat Daddy's) read this feed directly; nothing pushes to them.
const DEALERS = {
  'Davenport Motors': { code: 'DAV' },
  "Fat Daddy's Truck Sales": { code: 'FDT' },
  'Wilson Trailer Sales & Service': { code: 'WTS' },
};

// Resolves a feed dealer code (WTS / DAV / FDT) to the inventory.dealer value.
// Returns null for anything that is not exactly one of the configured codes.
function getDealerByCode(code) {
  if (!code || typeof code !== 'string') return null;
  for (const [dealerKey, cfg] of Object.entries(DEALERS)) {
    if (cfg.code === code) return dealerKey;
  }
  return null;
}

module.exports = { DEALERS, getDealerByCode };
