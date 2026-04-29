#!/usr/bin/env node
// One-time script to backfill Claude-generated descriptions for all inventory.
// Usage:
//   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node backfill-descriptions.js
//   Add --dry-run to preview without writing to Supabase.

const { generateDescription } = require('./netlify/functions/lib/generate-description');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

const DEALER_INFO_MAP = {
  "HGR's Truck and Trailer":      { name: "HGR's Truck and Trailer",      phone: '910-425-6104', location: 'Hope Mills, NC' },
  'Impex Heavy Metal':             { name: 'Impex Heavy Metal',             phone: '336-715-8704', location: 'Greensboro, NC' },
  "Joe's Tractor Sales":           { name: "Joe's Tractor Sales",           phone: '336-850-8271', location: 'Thomasville, NC' },
  "Fat Daddy's Truck Sales":       { name: "Fat Daddy's Truck Sales",       phone: '919-759-5434', location: 'Goldsboro, NC' },
  'Auto Connection 210 LLC':       { name: 'Auto Connection 210 LLC',       phone: '910-490-2596', location: 'Angier, NC' },
  'Davenport Inc.':                { name: 'Davenport Motors',              phone: '252-809-2172', location: 'Plymouth, NC' },
  'Dick Smith Equipment':          { name: 'Dick Smith Equipment',          phone: '919-734-1191', location: '' },
  'Wilson Trailer Sales & Service':{ name: 'Wilson Trailer Sales & Service',phone: '',             location: '' },
};

async function fetchAllInventory() {
  const limit = 1000;
  let offset = 0;
  let all = [];
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/inventory?sold=eq.false&select=stock,dealer,year,make,model,price,mileage,vin,engine,transmission,drivetrain,fuel,condition,raw_description,description&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    if (!page.length) break;
    all = all.concat(page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

async function patchDescription(stock, dealer, description) {
  const url = `${SUPABASE_URL}/rest/v1/inventory?stock=eq.${encodeURIComponent(stock)}&dealer=eq.${encodeURIComponent(dealer)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ description })
  });
  if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
}

async function main() {
  if (!DRY_RUN && !ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
  if (!SUPABASE_URL)                  throw new Error('Missing SUPABASE_URL');
  if (!SUPABASE_KEY)                  throw new Error('Missing SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY)');

  if (DRY_RUN) console.log('[DRY RUN] No changes will be written.\n');

  console.log('Fetching inventory...');
  const inventory = await fetchAllInventory();
  console.log(`Fetched ${inventory.length} active listings`);

  const toProcess = inventory.filter(u => u.raw_description || u.description);
  const skipped = inventory.length - toProcess.length;
  console.log(`Processing ${toProcess.length} listings (${skipped} skipped — no description text)\n`);

  let done = 0, errors = 0;

  for (const unit of toProcess) {
    const dealerInfo = DEALER_INFO_MAP[unit.dealer] || { name: unit.dealer };
    const label = `${unit.stock} [${unit.dealer}]`;
    try {
      if (DRY_RUN) {
        done++;
        console.log(`  [${done}/${toProcess.length}] WOULD UPDATE ${label}`);
        continue;
      }
      const description = await generateDescription(unit, dealerInfo, ANTHROPIC_API_KEY);
      if (!description) {
        console.warn(`  SKIP ${label} — empty response`);
        continue;
      }
      await patchDescription(unit.stock, unit.dealer, description);
      done++;
      console.log(`  [${done}/${toProcess.length}] OK   ${label}`);
    } catch (err) {
      errors++;
      console.error(`  [${done + errors}/${toProcess.length}] ERR  ${label}: ${err.message}`);
    }
  }

  console.log(`\nFinished. ${done} updated, ${errors} errors, ${skipped} skipped.`);
  if (DRY_RUN) console.log('[DRY RUN] No changes were written.');
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
