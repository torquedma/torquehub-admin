'use strict';

// Canonical server-side dealer payload builder (WTS / DAV / FDT).
//
// EMITS EXACTLY THE 27 KEYS, and no others:
//   year, make, model, trim,
//   condition, price, stock,
//   days, fuel, vin,
//   description, color,
//   mileage, hours, photos,
//   engine, transmission, drivetrain,
//   engine_description, transmission_description,
//   category, subcategory, siteTag, featured, video_url,
//   sold, sold_type
//
// NOTES ON VALUE SOURCES:
//
//  - photos come from Supabase inventory.photos, mapped to the
//    { url, name, fromUrl: true } shape; entries without a url are dropped.
//    Production evidence 2026-08-31: Wilson photo ordering is 9/9 exact
//    for count, URL and order between Supabase and the live blob, including
//    deliberately reordered WTS-614 (9,0,1,2…) and WTS-DTP-21 (1,0,2,3…).
//    PHOTO_STORE is a browser-only localStorage cache and cannot be reached
//    from server-side; production evidence proves it is not carrying unique
//    published state for the WTS population.
//
//  - color and siteTag are NOT columns in Supabase per INVENTORY_ADMIN_SELECT
//    in admin-read.js. Server emits null for both to keep the 27-key list
//    fixed.
//
//  - days is computed from created_at —
//      created_at ? Math.floor((Date.now() - Date.parse(created_at)) / 86400000) : 0
//
//  - hours is inventory.hours passed through raw (?? null, so a legitimate
//    0 survives); no parsing or trimming.
//
//  - public_sold is deliberately NOT emitted; live-blob observation
//    2026-08-31 showed public_sold undefined on every Wilson unit.

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';

async function buildDealerPayload(dealerKey, svcKey) {
  const cols = [
    'year', 'make', 'model', 'trim',
    'condition', 'price', 'stock', 'created_at',
    'fuel', 'vin', 'description', 'mileage', 'hours', 'photos',
    'engine', 'transmission', 'drivetrain',
    'engine_description', 'transmission_description',
    'category', 'subcategory', 'featured', 'video_url',
    'sold', 'sold_type',
    'dealer',
  ].join(',');

  const url = `${SUPABASE_URL}/rest/v1/inventory`
    + `?dealer=eq.${encodeURIComponent(dealerKey)}`
    + `&status=eq.published`
    + `&select=${cols}`
    + `&limit=1000`;

  const res = await fetch(url, {
    headers: {
      apikey:        svcKey,
      Authorization: 'Bearer ' + svcKey,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`payload SELECT failed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const rows = await res.json();
  const now = Date.now();

  return (Array.isArray(rows) ? rows : []).map(u => ({
    year:                     u.year,
    make:                     u.make,
    model:                    u.model,
    trim:                     u.trim || null,
    condition:                u.condition,
    price:                    u.price,
    stock:                    u.stock,
    days:                     u.created_at ? Math.floor((now - Date.parse(u.created_at)) / 86400000) : 0,
    fuel:                     u.fuel || null,
    vin:                      u.vin || null,
    description:              u.description || null,
    color:                    null,
    mileage:                  u.mileage || null,
    hours:                    u.hours ?? null,
    photos:                   (Array.isArray(u.photos) ? u.photos : [])
                                .map(p => ({
                                  url:     p.url || p.dataUrl || null,
                                  name:    p.name || null,
                                  fromUrl: true,
                                }))
                                .filter(p => p.url),
    engine:                   u.engine || null,
    transmission:             u.transmission || null,
    drivetrain:               u.drivetrain || null,
    engine_description:       u.engine_description || null,
    transmission_description: u.transmission_description || null,
    category:                 u.category || null,
    subcategory:              u.subcategory || null,
    siteTag:                  null,
    featured:                 u.featured || 0,
    video_url:                u.video_url || null,
    sold:                     u.sold === true,
    sold_type:                u.sold_type || null,
  }));
}

module.exports = { buildDealerPayload };
