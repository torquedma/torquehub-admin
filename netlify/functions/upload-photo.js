exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "vehicle_photos";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing Supabase environment variables" })
      };
    }

    const { imageUrl, dealerSlug, stockNum, index } = JSON.parse(event.body || "{}");

    if (!imageUrl || !dealerSlug || !stockNum) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields" })
      };
    }

    const safeDealer = String(dealerSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const safeStock = String(stockNum).replace(/[^a-z0-9-]/gi, "-");
    const safeIndex = Number.isFinite(Number(index)) ? Number(index) : 0;

    let contentType = "image/jpeg";
    let ext = "jpg";
    let bodyBytes;

    if (imageUrl.startsWith("data:")) {
      const match = imageUrl.match(/^data:(.*?);base64,(.*)$/);
      if (!match) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid data URL" })
        };
      }

      contentType = match[1] || "image/jpeg";
      const base64Data = match[2];

      if (contentType.includes("png")) ext = "png";
      else if (contentType.includes("webp")) ext = "webp";
      else if (contentType.includes("gif")) ext = "gif";
      else ext = "jpg";

      bodyBytes = Buffer.from(base64Data, "base64");
    } else {
      if (imageUrl.includes(".supabase.co/storage/")) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: imageUrl, skipped: true })
        };
      }

      const imageResp = await fetch(imageUrl);
      if (!imageResp.ok) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: `Failed to fetch source image: ${imageResp.status}` })
        };
      }

      contentType = imageResp.headers.get("content-type") || "image/jpeg";

      if (contentType.includes("png")) ext = "png";
      else if (contentType.includes("webp")) ext = "webp";
      else if (contentType.includes("gif")) ext = "gif";
      else ext = "jpg";

      const arrayBuffer = await imageResp.arrayBuffer();
      bodyBytes = Buffer.from(arrayBuffer);
    }

    const path = `${safeDealer}/${safeStock}/${safeIndex}.${ext}`;

    const uploadResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": contentType,
          "x-upsert": "true"
        },
        body: bodyBytes
      }
    );

    if (!uploadResp.ok) {
      const errorText = await uploadResp.text();
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Supabase upload failed: ${errorText}` })
      };
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${path}`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: publicUrl, path })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Unknown error" })
    };
  }
};
