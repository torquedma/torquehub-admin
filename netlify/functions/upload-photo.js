exports.handler = async function (event) {
  try {
    // 1. Method gate
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    // 2. Service-role key early check (needed for token verify below)
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!svcKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Server misconfiguration" })
      };
    }

    // 3. Extract bearer token
    const authHeader = (event.headers && event.headers["authorization"]) || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing Authorization header" })
      };
    }

    // 4. Verify token with Supabase
    let userEmail;
    try {
      const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          "apikey": svcKey,
          "Authorization": "Bearer " + token,
        },
      });
      if (!userRes.ok) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid or expired session" })
        };
      }
      const userData = await userRes.json();
      if (!userData || !userData.email) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid or expired session" })
        };
      }
      userEmail = userData.email.toLowerCase().trim();
    } catch (err) {
      console.log("[upload-photo] Auth check failed:", err.message);
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Auth check failed" })
      };
    }

    // 5. ADMIN_EMAILS allowlist — fail closed
    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.toLowerCase().trim()).filter(Boolean);
    if (adminEmails.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" })
      };
    }
    if (!adminEmails.includes(userEmail)) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" })
      };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "vehicle-photos";

    console.log("ENV CHECK — URL:", SUPABASE_URL ? "set" : "MISSING");
    console.log("ENV CHECK — KEY:", SUPABASE_SERVICE_ROLE_KEY ? "set (ends in " + SUPABASE_SERVICE_ROLE_KEY.slice(-4) + ")" : "MISSING");
    console.log("ENV CHECK — BUCKET:", SUPABASE_BUCKET);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing Supabase environment variables" })
      };
    }

    const { imageUrl, dealerSlug, stockNum, index, filename, upsert } = JSON.parse(event.body || "{}");

    console.log("REQUEST — dealerSlug:", dealerSlug, "stockNum:", stockNum, "index:", index, "filename:", filename, "upsert:", upsert === true);
    console.log("REQUEST — imageUrl starts with:", imageUrl ? imageUrl.substring(0, 60) : "MISSING");

    if (!imageUrl || !dealerSlug || !stockNum) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields" })
      };
    }

    const safeDealer = String(dealerSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const safeStock = String(stockNum).replace(/[^a-z0-9-]/gi, "-");
    // Prefer collision-proof client-generated `filename` base (sanitized). Falls back to
    // legacy numeric `index` slot only for browser tabs open at deploy time — new callers
    // pass `filename` and never `index`.
    let safeFilename = "";
    if (filename !== undefined && filename !== null) {
      safeFilename = String(filename).replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
      if (!safeFilename) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "filename empty after sanitization" })
        };
      }
    }
    const safeIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
    const pathBase = safeFilename || String(safeIndex);

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
      console.log("SOURCE — data URL, contentType:", contentType, "bytes:", bodyBytes.length);
    } else {
      if (imageUrl.includes(".supabase.co/storage/")) {
        console.log("SOURCE — already in Supabase, skipping");
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: imageUrl, skipped: true })
        };
      }

      console.log("SOURCE — fetching external URL");
      const imageResp = await fetch(imageUrl);
      console.log("FETCH STATUS:", imageResp.status, imageResp.statusText);

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
      console.log("FETCH — contentType:", contentType, "bytes:", bodyBytes.length);
    }

    const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB — compressed uploads (1200px/0.82 JPEG) are well under this
    if (bodyBytes.length > MAX_UPLOAD_BYTES) {
      return {
        statusCode: 413,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Image too large (${(bodyBytes.length / 1024 / 1024).toFixed(1)} MB). Images must be compressed before upload (max 2 MB).`
        })
      };
    }

    const path = `${safeDealer}/${safeStock}/${pathBase}.${ext}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${path}`;
    console.log("UPLOAD — path:", path);
    console.log("UPLOAD — url:", uploadUrl);

    // x-upsert is opt-in: caller must set body { upsert: true }. Default is fail-fast on
    // collision so a naming bug can never silently overwrite existing bytes.
    const uploadHeaders = {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": contentType
    };
    if (upsert === true) uploadHeaders["x-upsert"] = "true";

    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: uploadHeaders,
      body: bodyBytes
    });

    console.log("SUPABASE RESPONSE STATUS:", uploadResp.status, uploadResp.statusText);
    const errorText = await uploadResp.text();
    console.log("SUPABASE RESPONSE BODY:", errorText);

    if (!uploadResp.ok) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Supabase upload failed: ${errorText}` })
      };
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${path}`;
    console.log("SUCCESS — publicUrl:", publicUrl);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: publicUrl, path })
    };
  } catch (err) {
    console.log("CAUGHT ERROR:", err.message, err.stack);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Unknown error" })
    };
  }
};
