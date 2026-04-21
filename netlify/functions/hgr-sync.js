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
    items.push({
      stock,
      year: get('year') || null,
      make: get('manufacturer'),
      model: get('model_name'),
      price,
      condition,
      vin: get('vin') || null,
      description: desc,
      category,
      subcategory: get('model_type') || null,
      fuel: null,
      dealer: DEALER,
      sold: false,
      featured: 0,
      photos
    });
  }
  return items;
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
