const https = require('https');

const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4c2lra21xYXN5ZG9zbWJsem92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTc1OTksImV4cCI6MjA5MDQ3MzU5OX0.JMEI7cx2tddmbvfqm_qxiIWp7f5Phuk5l0Y487DUSZg';
const DEALER = "HGR's Truck and Trailer";
const FEED_URL = 'https://www.hgrstrailer.com/unitinventory_univ.xml';

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
    const stock = get('stocknumber');
    if (!stock) continue;
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
    if (modelType.includes('truck')) category = 'Trucks';
    else if (modelType.includes('equipment') || modelType.includes('construction')) category = 'Construction';
    else if (modelType.includes('farm') || modelType.includes('agri')) category = 'Farm';
    const rawDesc = get('description').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
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
        if (type) parts.push(type);
        return parts.length ? parts.join(' ') : modelName.split(/\s+/).slice(0,3).join(' ');
      })(),

      price,
      condition,
      vin: get('vin') || null,
      raw_description: rawDesc,
      description: null, // set below
      torque_hub_dx: null, // set below
      description_source: 'torque_hub_dx',
      category,
      subcategory: get('model_type') || null,
      fuel: null,
      dealer: DEALER,
      sold: false,
      featured: 0,
      photos
    });
    // Generate Torque Hub DX after item is built
    const lastItem = items[items.length - 1];
    const thDX = buildTorqueHubDX(lastItem, rawDesc);
    lastItem.torque_hub_dx = thDX;
    lastItem.description = thDX;
  }
  return items;
}

function buildTorqueHubDX(item, rawDesc) {
  const lines = [];
  const title = [item.year, item.make, item.model].filter(Boolean).join(' ');
  if (title) lines.push(title);
  lines.push('');

  if (item.price && item.price !== 'Call') lines.push('Price: ' + item.price);
  lines.push('');

  // Parse raw description for specs not in XML fields
  function parseSpec(pattern) {
    if (!rawDesc) return '';
    const m = rawDesc.match(pattern);
    return m ? m[1].trim() : '';
  }

  const specs = [];
  // Try XML attributes first, fall back to parsing raw description
  const length = parseSpec(/(?:length|long)[:\s-]*([0-9.]+\s*(?:ft|'|feet)?)/i) ||
                 parseSpec(/([0-9.]+)\s*(?:ft|')\s*(?:long|length)/i);
  const width = parseSpec(/(?:width|wide)[:\s-]*([0-9."]+\s*(?:in|inches|ft|')?)/i) ||
                parseSpec(/([0-9.]+)\s*(?:wide|width)/i);
  const height = parseSpec(/(?:interior\s*height|inside\s*height|int\.\s*height)[:\s-]*([0-9."]+\s*(?:in|inches|ft|')?)/i);
  const gvwr = parseSpec(/gvwr[:\s-]*([0-9,]+\s*(?:lb|lbs|#)?)/i);
  const axles = parseSpec(/([0-9]+)\s*axle/i);
  const axleWeight = parseSpec(/([0-9,]+)\s*(?:lb|lbs|#)\s*axle/i);
  const ramp = parseSpec(/((?:rear\s*)?(?:ramp|gate|door)[^.,]{0,60})/i);
  const electrical = parseSpec(/((?:[0-9]+)\s*amp[^.,]{0,60})/i);

  if (length) specs.push('Length: ' + length);
  if (width) specs.push('Width: ' + width);
  if (axles) specs.push('Axles: ' + axles + (axleWeight ? ' x ' + axleWeight + ' lb' : ''));
  if (gvwr) specs.push('GVWR: ' + gvwr);
  if (height) specs.push('Interior Height: ' + height);
  if (ramp) specs.push('Door/Ramp: ' + ramp.replace(/\s+/g,' ').trim());
  if (electrical) specs.push('Electrical: ' + electrical.replace(/\s+/g,' ').trim());
  if (item.vin) specs.push('VIN: ' + item.vin);
  specs.push('Stock #: ' + item.stock);

  if (specs.length) {
    lines.push('Key Specs:');
    specs.forEach(s => lines.push(s));
    lines.push('');
  }

  // Highlights — parse bullet points from raw description
  const highlights = [];
  if (rawDesc) {
    const bullets = rawDesc.split(/\n/).filter(l => l.match(/^[-*]|^-[A-Z]/)).slice(0, 5);
    bullets.forEach(b => {
      const clean = b.replace(/^[-*\s]+/,'').replace(/<[^>]+>/g,'').trim();
      if (clean.length > 10 && clean.length < 120) highlights.push(clean);
    });
  }
  if (highlights.length) {
    lines.push('Highlights:');
    highlights.forEach(h => lines.push(h));
    lines.push('');
  }

  // Best For — infer from trailer type
  const modelType = (item.subcategory || '').toLowerCase();
  const bestFor = [];
  if (modelType.includes('car') || modelType.includes('racing') || modelType.includes('enclosed')) {
    bestFor.push('Race teams and motorsports hauling');
    bestFor.push('Show cars and high-end enclosed transport');
    bestFor.push('Car dealers and auction transport');
  } else if (modelType.includes('dump')) {
    bestFor.push('Contractors and landscapers');
    bestFor.push('Debris removal and material hauling');
    bestFor.push('Farm and property cleanup');
  } else if (modelType.includes('equipment') || modelType.includes('utility')) {
    bestFor.push('Contractors and equipment haulers');
    bestFor.push('Landscapers and farm use');
    bestFor.push('Heavy equipment transport');
  } else if (modelType.includes('cargo')) {
    bestFor.push('Mobile businesses and contractors');
    bestFor.push('Tool and equipment storage');
    bestFor.push('Enclosed commercial hauling');
  } else if (modelType.includes('vending') || modelType.includes('concession')) {
    bestFor.push('Food vendors and mobile businesses');
    bestFor.push('Event concessions and markets');
    bestFor.push('Mobile retail and service units');
  } else {
    bestFor.push('Commercial and farm use');
    bestFor.push('General hauling and transport');
  }
  if (bestFor.length) {
    lines.push('Best For:');
    bestFor.forEach(b => lines.push(b));
    lines.push('');
  }

  lines.push('Location:');
  lines.push("HGR's Truck & Trailer Sales");
  lines.push('4519 Marracco Dr, Hope Mills, NC 28348');
  lines.push('');
  lines.push('Call: 910-425-6104');

  return lines.join('\n');
}

exports.handler = async (event) => {
  console.log('HGR sync started');
  try {
    const xml = await fetchUrl(FEED_URL);
    const feedItems = parseXml(xml);
    console.log('Parsed ' + feedItems.length + ' items');
    if (!feedItems.length) return { statusCode: 200, body: JSON.stringify({ error: 'No items parsed' }) };

    const existing = await supabaseFetch('/rest/v1/inventory?dealer=eq.' + encodeURIComponent(DEALER) + '&select=stock', 'GET');
    const existingStocks = new Set(JSON.parse(existing.body).map(r => r.stock));
    const feedStocks = new Set(feedItems.map(i => i.stock));
    const toDelete = [...existingStocks].filter(s => !feedStocks.has(s));

    for (const stock of toDelete) {
      await supabaseFetch('/rest/v1/inventory?stock=eq.' + encodeURIComponent(stock) + '&dealer=eq.' + encodeURIComponent(DEALER), 'DELETE');
    }

    let inserted = 0, updated = 0, errors = 0;
    for (const item of feedItems) {
      if (existingStocks.has(item.stock)) {
        const r = await supabaseFetch('/rest/v1/inventory?stock=eq.' + encodeURIComponent(item.stock) + '&dealer=eq.' + encodeURIComponent(DEALER), 'PATCH', item);
        if (r.status >= 400) { console.error('PATCH error', r.status, r.body.slice(0,200)); errors++; } else updated++;
      } else {
        const r = await supabaseFetch('/rest/v1/inventory', 'POST', [item]);
        if (r.status >= 400) { console.error('POST error', r.status, r.body.slice(0,200)); errors++; } else inserted++;
      }
    }

    const result = { success: true, inserted, updated, deleted: toDelete.length, errors, total: feedItems.length };
    console.log('Done:', result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
