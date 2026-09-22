export default async function handler(req, res) {

  const allowedOrigins = new Set([
    "https://www.yincorp.com.br",
    "https://yincorp.com.br",
    "https://app.yincorp.com.br"
  ]);

  const origin = req.headers.origin || "";

  if (allowedOrigins.has(origin)) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );
  }

  res.setHeader(
    "Vary",
    "Origin"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  if (req.method === "OPTIONS") {

    return res
      .status(204)
      .end();

  }


  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  }


  try {

    const SUPABASE_URL =
      process.env.SUPABASE_URL;

    const SUPABASE_SECRET_KEY =
      process.env.SUPABASE_SECRET_KEY;


    if (
      !SUPABASE_URL ||
      !SUPABASE_SECRET_KEY
    ) {

      return res.status(500).json({
        success: false,
        error:
          "Supabase environment variables are not configured"
      });

    }


    const body =

      typeof req.body === "string"

        ? JSON.parse(req.body)

        : (req.body || {});


    const {

      event_name,
      session_id,
      event_time,

      page_path,
      page_location,
      page_title,
      referrer,

      property_name,

      gclid,
      gbraid,
      wbraid,

      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,

      ...event_data

    } = body;


    if (
      !event_name ||
      !session_id
    ) {

      return res.status(400).json({
        success: false,
        error:
          "event_name and session_id are required"
      });

    }


    const row = {

      event_name:
        String(event_name)
          .slice(0, 120),

      session_id:
        String(session_id)
          .slice(0, 120),

      event_time:
        event_time ||
        new Date().toISOString(),

      page_path:
        page_path || "",

      page_location:
        page_location || "",

      page_title:
        page_title || "",

      referrer:
        referrer || "",

      property_name:
        property_name || "",

      gclid:
        gclid || "",

      gbraid:
        gbraid || "",

      wbraid:
        wbraid || "",

      utm_source:
        utm_source || "",

      utm_medium:
        utm_medium || "",

      utm_campaign:
        utm_campaign || "",

      utm_content:
        utm_content || "",

      utm_term:
        utm_term || "",

      event_data

    };


    const response =
      await fetch(

        `${SUPABASE_URL}/rest/v1/behavior_events`,

        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "apikey":
              SUPABASE_SECRET_KEY,

            "Authorization":
              `Bearer ${SUPABASE_SECRET_KEY}`,

            "Prefer":
              "return=minimal"

          },

          body:
            JSON.stringify(row)

        }

      );


    if (!response.ok) {

      const detail =
        await response
          .text()
          .catch(() => "");


      console.error(
        "Supabase telemetry insert failed:",
        {
          status:
            response.status,

          detail
        }
      );


      return res.status(502).json({

        success: false,

        supabase: false,

        error:
          "Supabase telemetry insert failed"

      });

    }


    return res.status(200).json({

      success: true,

      supabase: true

    });


  } catch (error) {


    console.error(
      "Telemetry API error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        "Internal telemetry error"

    });

  }

}
