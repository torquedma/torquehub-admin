const https = require('https');
const { generateDescription } = require('./lib/generate-description');
const { CANONICAL_SUBCATEGORIES, SUBCATEGORY_ALIASES, canonicalize } = require('./lib/taxonomy.generated.js');

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEALER = "HGR's Truck and Trailer";
const FEED_URL = 'https://www.hgrstrailer.com/unitinventory_univ.xml';
const DEALER_INFO = {
  name: "HGR's Truck and Trailer",
  location: '4519 Marracco Dr, Hope Mills, NC 28348',
  phone: '910-425-6104'
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function supabaseFetch(path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'bxsikkmqasydosmblzov.supabase.co',
      path,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function normalizeHgrStock(s) {
  if (!s) return s;
  const prefixed = s.startsWith('HGR') ? s : 'HGR' + s;
  return prefixed.length > 3 && prefixed[3] !== '-'
    ? prefixed.slice(0, 3) + '-' + prefixed.slice(3)
    : prefixed;
}

function parseXml(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const item = match[1];
    const get = (tag) => {
      const m = item.match(new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>|<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>'));
      if (!m) return '';
      return (m[1] || m[2] || '').trim();
    };
    const getAttr = (name) => {
      const pattern = new RegExp('<name>' + name + '<\/name>\\s*<value>([^<]*)<\/value>', 'i');
      const m = item.match(pattern);
      return m ? m[1].trim() : '';
    };
    const rawStock = get('stocknumber');
    if (!rawStock) continue;
    const stock = normalizeHgrStock(rawStock);
    const photos = [];
    const imgMatches = item.matchAll(/<imageurl>([^<]+)<\/imageurl>/g);
    for (const img of imgMatches) photos.push({ url: img[1].trim(), name: img[1].trim().split('/').pop() });
    const rawPrice = get('price');
    const priceNum = parseFloat(rawPrice);
    const price = priceNum > 0 ? '$' + priceNum.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'Call';
    const condition = get('usage') === 'New' ? 'New' : 'Used';
    const desc = get('description').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    const modelType = get('model_type').toLowerCase();
    let category = 'Trailers';
    if (modelType.includes('trailer')) category = 'Trailers';
    else if (modelType.includes('truck')) category = 'Trucks';
    else if (modelType.includes('equipment') || modelType.includes('construction')) category = 'Construction';
    else if (modelType.includes('farm') || modelType.includes('agri')) category = 'Farm';
    const rawDesc = get('description').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    const rawModelType = get('model_type') || '';
    const canonicalSubcategory = canonicalize(rawModelType) || null;
    items.push({
      stock,
      year: get('year') || null,
      make: (function() {
        var mfr = get('manufacturer');
        var mn = get('model_name');
        if (mfr === 'Wildwood') return 'Forest River';
        if (mfr && mfr.toLowerCase() === 'other') {
          return mn.trim().split(/\s+/)[0] || mfr;
        }
        return mfr;
      })(),
      model: (function() {
        var modelName = get('model_name');
        var rawType = get('model_type');
        if (rawType) {
          var tailPat = rawType
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\s*\/\s*/g, '\\s*/\\s*')
            .replace(/\s+/g, '\\s+');
          modelName = modelName.replace(new RegExp('\\s*' + tailPat + 's?\\s*$', 'i'), '').trim();
          // Also strip the ABBREVIATED type tail: HGR model_name often carries
          // a condensed form (e.g. "Car/Racing") while model_type is the full
          // phrase ("Car / Racing Trailer"), so the full-phrase strip above misses it.
          var abbrevType = rawType
            .replace(new RegExp('\\s*/?\\s*[Tt]railer\\s*$'), '')
            .replace(new RegExp('\\s*/\\s*', 'g'), '/')
            .trim();
          if (abbrevType) {
            var abbrevPat = abbrevType
              .replace(new RegExp('[.*+?^${}()|[\\]\\\\]', 'g'), '\\$&')
              .replace(new RegExp('\\s*/\\s*', 'g'), '\\s*/\\s*');
            modelName = modelName.replace(new RegExp('\\s*' + abbrevPat + 's?\\s*$', 'i'), '').trim();
          }
        }

        // --- SIZE ---
        // Try NxM format first (must check before feet-only)
        var size = '';
        var nxm = modelName.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
        var feet = modelName.match(/(\d+(?:\.\d+)?)'(?!\s*x)/);
        var plusFt = modelName.match(/(\d+\+\d+)/);
        if (nxm) {
          var w = parseFloat(nxm[1]);
          var l = parseFloat(nxm[2]);
          if (l >= 60) {
            size = nxm[1] + 'ft x ' + nxm[2] + 'in';
          } else if (w > 53) {
            size = nxm[1] + 'in x ' + nxm[2] + 'ft';
          } else {
            size = nxm[1] + 'ft x ' + nxm[2] + 'ft';
          }
        } else if (plusFt) {
          size = plusFt[1] + 'ft';
        } else if (feet) {
          size = feet[1] + 'ft';
        }

        // --- DESCRIPTORS ---
        var keepers = ['gooseneck','tandem','aluminum','vnose','tilt','dovetail','telescoping','deckover'];
        var descs = [];
        modelName.toLowerCase().split(/\s+/).forEach(function(w) {
          var clean = w.replace(/[^a-z]/g,'');
          if (keepers.indexOf(clean) !== -1) descs.push(clean.charAt(0).toUpperCase() + clean.slice(1));
        });

        // --- TYPE ---
        if (rawType.toLowerCase() === 'other trailer') {
          if (/camper|rv|travel/i.test(modelName)) rawType = 'Camper';
          else if (/aerial|tower|bucket/i.test(modelName)) rawType = 'Aerial';
          else rawType = '';
        }
        var typeMap = {
          'car / racing trailer': 'Car/Racing',
          'cargo / enclosed trailer': 'Cargo/Enclosed',
          'equipment trailer': 'Equipment',
          'dump trailer': 'Dump',
          'utility trailer': 'Utility',
          'vending / concession trailer': 'Vending/Concession',
          'landscape': 'Landscape',
          'motorcycle trailer': 'Motorcycle'
        };
        var type = typeMap[rawType.toLowerCase()] || rawType
          .replace(/\s*\/\s*[Tt]railer\s*$/,'').replace(/\s*[Tt]railer\s*$/,'')
          .replace(/\s*\/\s*/g,'/').trim();

        // --- MODEL CODE FALLBACK (only if no size found) ---
        var code = '';
        if (!size) {
          var codeMatch = modelName.match(/\b([A-Z]?\d+[A-Z]+\d*|[A-Z]+\d+)\b/);
          if (codeMatch) code = codeMatch[1];
        }

        // --- ASSEMBLE ---
        var parts = [];
        if (size) parts.push(size);
        else if (code) parts.push(code); // only use code if no size
        if (descs.length) parts.push(descs.join(' '));
        return parts.length ? parts.join(' ') : modelName.split(/\s+/).slice(0,3).join(' ');
      })(),

      price,
      condition,
      vin: get('vin') || null,
      raw_description: rawDesc,
      // DX-owned fields land NULL for HGR intake. The chained
      // generate-dx-background invocation after the loop populates
      // description and description_source and promotes status.
      description: null,
      torque_hub_dx: null,
      description_source: null,
      category,
      trim: canonicalSubcategory || '',
      subcategory: canonicalSubcategory,
      fuel: null,
      dealer: DEALER,
      sold: false,
      featured: 0,
      photos
    });
    // DX generation is retired from this parser. Fresh rows land as drafts
    // (see INSERT branch) and are canonicalized by generate-dx-background
    // via a post-loop chained trigger. buildTorqueHubDX was the legacy
    // VN.NET-shaped envelope with a stale hard-coded phone number; it has
    // no cross-file callers and its definition is deleted below.
  }
  return items;
}

exports.handler = async (event) => {
  console.log('HGR sync started');
  if (!SUPABASE_KEY) {
    console.error('HGR sync aborted: SUPABASE_SERVICE_ROLE_KEY not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }) };
  }
  try {
    const xml = await fetchUrl(FEED_URL);
    const feedItems = parseXml(xml);
    console.log('Parsed ' + feedItems.length + ' items');
    if (!feedItems.length) return { statusCode: 200, body: JSON.stringify({ error: 'No items parsed' }) };

    const existing = await supabaseFetch('/rest/v1/inventory?dealer=eq.' + encodeURIComponent(DEALER) + '&select=stock,subcategory_locked,model_locked,sold,dx_locked', 'GET');
    const existingRows = JSON.parse(existing.body);
    const existingStocks = new Set(existingRows.map(r => normalizeHgrStock(r.stock)));
    // soldStocks is LOAD-BEARING: already-sold rows never reappear in the feed, so without
    // excluding them from toDelete they get re-PATCHed and sold_date restamped to today on
    // EVERY run (nightly sold_date corruption). Fixed 2026-07-06. Do not remove this guard.
    const soldStocks = new Set(existingRows.filter(r => r.sold === true).map(r => normalizeHgrStock(r.stock)));
    const lockedStocks = new Set(existingRows.filter(r => r.subcategory_locked).map(r => normalizeHgrStock(r.stock)));
    const modelLockedStocks = new Set(existingRows.filter(r => r.model_locked).map(r => normalizeHgrStock(r.stock)));
    // dxLockedStocks is LOAD-BEARING: this sync writes its own legacy buildTorqueHubDX
    // output into `description`, the buyer-facing SSOT. ONLY generate-dx-background
    // guards on dx_locked (documented 2026-06-20), so without this set every nightly
    // run silently overwrites human-approved Canonical DX on locked rows — which is
    // exactly what erased 163 reviewed Overviews on 2026-08-31. Do not remove.
    const dxLockedStocks = new Set(existingRows.filter(r => r.dx_locked).map(r => normalizeHgrStock(r.stock)));
    const feedStocks = new Set(feedItems.map(i => i.stock));
    const toDelete = [...existingStocks].filter(s => !feedStocks.has(s) && !soldStocks.has(s));

    const markSoldSafe = !(feedStocks.size < existingStocks.size * 0.5 && existingStocks.size >= 10);
    if (!markSoldSafe) {
      console.error('ABORT mark-sold: feed has ' + feedStocks.size + ' stocks vs ' + existingStocks.size + ' existing (<50%, existing>=10). Skipping ' + toDelete.length + ' deletes to protect against partial-scrape failure.');
    }
    // 2026-09-04 INVENTORY AUTHORITY FREEZE. HGR is in the freeze set: the XML
    // feed at unitinventory_univ.xml is the correct MECHANISM (dealer-hosted) but
    // its COMPLETENESS versus the dealer website has not been authenticated.
    // Do not let feed absence set sold_type='feed_removed' until the XML has been
    // shown to contain every unit the dealer website advertises. Remove this
    // constant only after that authentication is on file.
    const FREEZE_MARK_SOLD = true;
    let markedSoldCount = 0, errors = 0;
    if (FREEZE_MARK_SOLD) {
      console.warn('FREEZE ' + DEALER + ': mark-sold loop skipped entirely (0 units mark-sold this run). ' + toDelete.length + ' rows would have been mark-sold.');
    } else if (markSoldSafe) {
      for (const stock of toDelete) {
        const r = await supabaseFetch(
          '/rest/v1/inventory?stock=eq.' + encodeURIComponent(stock) + '&dealer=eq.' + encodeURIComponent(DEALER),
          'PATCH',
          { sold: true, sold_date: new Date().toISOString().split('T')[0], sold_type: 'feed_removed' }
        );
        if (r.status >= 400) { console.error('mark-sold error', r.status, r.body.slice(0, 200)); errors++; } else markedSoldCount++;
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    let inserted = 0, updated = 0;
    const insertedStocks = [];
    for (const item of feedItems) {
      // Description generation skipped — too slow for 60s scheduled timeout (140 items × ~1s/call)
      // if (apiKey) {
      //   try {
      //     const desc = await generateDescription(item, DEALER_INFO, apiKey);
      //     if (desc) {
      //       item.description = desc;
      //       item.torque_hub_dx = desc;
      //     }
      //   } catch (err) {
      //     console.error('Description generation failed for', item.stock, ':', err.message);
      //   }
      // }
      if (existingStocks.has(item.stock)) {
        let patchPayload = item;
        if (lockedStocks.has(item.stock) || modelLockedStocks.has(item.stock) || dxLockedStocks.has(item.stock)) {
          patchPayload = Object.assign({}, item);
          if (lockedStocks.has(item.stock)) {
            delete patchPayload.subcategory;
            delete patchPayload.trim;
            delete patchPayload.category;
          }
          if (modelLockedStocks.has(item.stock)) {
            delete patchPayload.make;
            delete patchPayload.model;
          }
          if (dxLockedStocks.has(item.stock)) {
            // REDUNDANT since 2026-09-13: the unconditional DX ownership strip below
            // removes these fields for EVERY existing row, locked or not.
            // Kept only as defence in depth. dx_locked is NOT the governing
            // protection for DX and must not be treated as the ownership boundary.
            delete patchPayload.description;
            delete patchPayload.description_source;
          }
        }
        // 2026-09-13 DX FIELD OWNERSHIP. The feed owns evidence and facts;
        // the Canonical DX pipeline owns the buyer-facing description.
        // buildTorqueHubDX legacy output is written into description and
        // torque_hub_dx at parse (~221). On the measured 2026-09-13 locked
        // buyer-live population, all 174 rows had longer Canonical
        // descriptions (~1405 chars) while torque_hub_dx held shorter legacy
        // output (~571 chars). dx_locked previously guarded only the first
        // two fields and only on locked rows, which is why torque_hub_dx had
        // degraded on 174/174 and why the 2026-08-31 event erased 163
        // reviewed Overviews. Ownership is now structural, not per-row.
        // raw_description is Evidence Layer and MUST keep flowing.
        // The INSERT path below is separately draft-then-canonicalize
        // (2026-09-14). New rows land as status='draft' with description
        // and description_source NULL; a post-loop chained invocation of
        // site generate-dx-background canonicalizes them and promotes
        // status to 'published' on success. Legacy buildTorqueHubDX is
        // retired for HGR.
        patchPayload = Object.assign({}, patchPayload);
        delete patchPayload.description;
        delete patchPayload.description_source;
        delete patchPayload.torque_hub_dx;
        // 2026-09-13 FREEZE SYMMETRY (RC-1c). While FREEZE_MARK_SOLD is
        // active the mark-sold loop cannot BURY a row — but this PATCH path
        // could still RESURRECT one. existingStocks (~356) is built with no
        // sold filter, and every feed item carries sold:false (~207), so a
        // sold row whose stock reappeared in the XML was flipped live here
        // with sold_type and sold_date left intact. 67 buyer-live rows carry
        // that signature. Lifecycle is ONE UNIT: under the freeze this writer
        // touches none of it. Content fields are unaffected.
        if (FREEZE_MARK_SOLD) {
          patchPayload = Object.assign({}, patchPayload);
          delete patchPayload.sold;
          delete patchPayload.sold_type;
          delete patchPayload.sold_date;
        }
        const r = await supabaseFetch('/rest/v1/inventory?stock=eq.' + encodeURIComponent(item.stock) + '&dealer=eq.' + encodeURIComponent(DEALER), 'PATCH', patchPayload);
        if (r.status >= 400) { console.error('PATCH error', r.status, r.body.slice(0,200)); errors++; } else updated++;
      } else {
        // Fresh HGR rows land as drafts. status='draft' set on INSERT only
        // (not on UPDATE — a copy is made so the shared item object is not
        // mutated for any subsequent code that reads it).
        const draftItem = Object.assign({}, item, { status: 'draft' });
        const r = await supabaseFetch('/rest/v1/inventory', 'POST', [draftItem]);
        if (r.status >= 400) {
          console.error('POST error', r.status, r.body.slice(0,200));
          errors++;
        } else {
          inserted++;
          insertedStocks.push(item.stock);
        }
      }
    }

    // 2026-09-14 CANONICALIZATION TRIGGER. Chain to the site's canonical
    // DX generator for newly-inserted HGR drafts. generate-dx-background is
    // a Netlify BACKGROUND function (filename ends -background): the fetch
    // returns 202 empty and the work runs asynchronously — do NOT try to
    // read a response body.
    //
    // ★ BANKED CONSTRAINT — ?stocks= bypasses the D6 VIN bounded-wait
    //   (generate-dx-background.js:80, by design per its comment at 76-77).
    //   Safe HERE only because HGR carries no VINs: 174/174 live HGR rows
    //   have no VIN column value and VIN enrichment is not part of HGR's
    //   intake contract. This ?stocks= trigger pattern must NOT be copied
    //   for VIN-bearing dealers without a different D6 story.
    if (insertedStocks.length > 0) {
      const stocksParam = insertedStocks.map(encodeURIComponent).join(',');
      const url = 'https://hub.torquedma.com/.netlify/functions/generate-dx-background?stocks=' + stocksParam;
      console.log('[HGR-DX-TRIGGER] chaining canonicalization for ' + insertedStocks.length + ' fresh draft(s): ' + insertedStocks.join(', '));
      try {
        const trigRes = await fetch(url);
        console.log('[HGR-DX-TRIGGER] response status: ' + trigRes.status + ' (background function; body is empty by design)');
      } catch (err) {
        console.error('[HGR-DX-TRIGGER] fetch failed: ' + err.message + ' — drafts persist for the recovery sweep to pick up');
      }
    }

    const result = { success: true, inserted, updated, deleted: markedSoldCount, errors, total: feedItems.length, dx_triggered_for: insertedStocks };
    console.log('Done:', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
