const SUPABASE_URL = 'https://bxsikkmqasydosmblzov.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4c2lra21xYXN5ZG9zbWJsem92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTc1OTksImV4cCI6MjA5MDQ3MzU5OX0.JMEI7cx2tddmbvfqm_qxiIWp7f5Phuk5l0Y487DUSZg';
const DEALER = "HGR's Truck and Trailer";

exports.handler = async () => {
  try {
    let all = [];
    let from = 0;
    while (true) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/inventory?dealer=eq.${encodeURIComponent(DEALER)}&sold=eq.false&select=*&offset=${from}&limit=1000`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const page = await res.json();
      if (!page.length) break;
      all = all.concat(page);
      if (page.length < 1000) break;
      from += 1000;
    }

    const inventory = all.map(u => ({
      year: u.year,
      make: u.make,
      model: u.model,
      condition: u.condition,
      price: u.price,
      stock: u.stock,
      days: u.days,
      fuel: u.fuel || null,
      vin: u.vin || null,
      description: u.description || null,
      color: u.color || null,
      mileage: u.mileage || null,
      engine: u.engine || null,
      transmission: u.transmission || null,
      drivetrain: u.drivetrain || null,
      engine_description: u.engine_description || null,
      transmission_description: u.transmission_description || null,
      photos: u.photos || [],
      siteTag: u.category || null,
      subcategory: u.subcategory || null,
      featured: u.featured || 0,
      video_url: u.video_url || null,
      sold: u.sold || false
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(inventory)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
