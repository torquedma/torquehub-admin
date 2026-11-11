'use strict';
// preserve-photo-order.js - HGR curated photo order (Chief 1 -398/-401, HST -324).
// On a feed update of an existing row: keep the stored (curated) gallery order for photos the
// feed still carries, drop photos the feed no longer has, and append new feed photos in feed
// order. Membership always equals the feed's, so a stale gallery can never persist. Photos are
// matched by url. Duplicate or keyless feed entries, an empty stored gallery, or no overlap at
// all fall back to the feed order unchanged (today's behavior). The feed's photo objects are
// returned (fresh metadata), never the stored ones.
function preserveCuratedPhotoOrder(stored, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return incoming;
  if (!Array.isArray(stored) || stored.length === 0) return incoming;
  const key = p => (p && typeof p === 'object') ? p.url : p;
  const byKey = new Map();
  for (const p of incoming) { const k = key(p); if (!k || byKey.has(k)) return incoming; byKey.set(k, p); }
  const kept = [], seen = new Set();
  for (const p of stored) { const k = key(p); if (byKey.has(k) && !seen.has(k)) { kept.push(byKey.get(k)); seen.add(k); } }
  if (kept.length === 0) return incoming;
  return kept.concat(incoming.filter(p => !seen.has(key(p))));
}
module.exports = { preserveCuratedPhotoOrder };
