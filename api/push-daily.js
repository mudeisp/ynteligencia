import crypto from "node:crypto";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SECRET_KEY,
  ONESIGNAL_APP_ID,
  ONESIGNAL_REST_API_KEY,
  CRON_SECRET
} = process.env;

const SUPABASE_SERVER_KEY =
  SUPABASE_SERVICE_ROLE_KEY ||
  SUPABASE_SECRET_KEY ||
  "";

function clean(value) {
  return String(value ?? "").trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function headersSupabase() {
  return {
    apikey: SUPABASE_SERVER_KEY,
    Authorization: `Bearer ${SUPABASE_SERVER_KEY}`,
    "Content-Type": "application/json"
  };
}

async function supabaseGet(path, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    url.searchParams.set(
      key,
      String(value)
    );
  }

  const response = await fetch(url, {
    headers: headersSupabase()
  });

  const data = await response
    .json()
    .catch(() => []);

  if (!response.ok) {
    throw new Error(
      `Supabase GET ${response.status}: ${JSON.stringify(data).slice(0, 800)}`
    );
  }

  return data;
}

async function supabaseInsert(path, row) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: "POST",

      headers: {
        ...headersSupabase(),
        Prefer: "return=minimal"
      },

      body: JSON.stringify(row)
    }
  );

  if (!response.ok) {
    const detail = await response
      .text()
      .catch(() => "");

    console.warn(
      "PUSH_LOG_INSERT_FAILED",
      response.status,
      detail.slice(0, 800)
    );
  }
}

function latestStateByVisitor(rows) {
  const map = new Map();

  for (const row of rows) {
    const visitorId =
      clean(
        row?.metadata?.visitor_id
      );

    if (!visitorId) {
      continue;
    }

    if (!map.has(visitorId)) {
      map.set(visitorId, row);
    }
  }

  return map;
}

function propertyExternalId(property) {
  return clean(
    property?.external_id ||
    ""
  );
}

function propertyUuid(property) {
  const candidate =
    clean(
      property?.id ||
      ""
    );

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(candidate)
      ? candidate
      : "";
}

function propertyIdentity(property) {
  return (
    propertyExternalId(property) ||
    propertyUuid(property)
  );
}

function titleOf(property) {
  return clean(
    property?.development_name ||
    property?.title ||
    "Imóvel"
  );
}

function makePropertyQuery(profile) {
  const params = {
    select:
      "id,external_id,source,title,development_name,neighborhood,city,state,price,bedrooms,bathrooms,parking_spaces,area,image_url,active,updated_at",

    active:
      "eq.true",

    limit:
      "100",

    order:
      "updated_at.desc"
  };

  if (clean(profile.city)) {
    params.city =
      `ilike.${clean(profile.city)}`;
  }

  if (clean(profile.state)) {
    params.state =
      `ilike.${clean(profile.state)}`;
  }

  if (clean(profile.neighborhood)) {
    params.neighborhood =
      `ilike.${clean(profile.neighborhood)}`;
  }

  if (
    clean(profile.source) &&
    clean(profile.source) !== "todos"
  ) {
    params.source =
      `eq.${clean(profile.source)}`;
  }

  if (
    num(profile.bedrooms) > 0
  ) {
    params.bedrooms =
      `gte.${num(profile.bedrooms)}`;
  }

  if (
    num(profile.min_price) > 0
  ) {
    params.price =
      `gte.${num(profile.min_price)}`;
  }

  if (
    num(profile.max_price) > 0
  ) {
    const clauses = [];

    if (
      num(profile.min_price) > 0
    ) {
      clauses.push(
        `price.gte.${num(profile.min_price)}`
      );

      delete params.price;
    }

    clauses.push(
      `price.lte.${num(profile.max_price)}`
    );

    params.and =
      `(${clauses.join(",")})`;
  }

  return params;
}

async function visitorHistory(visitorId) {
  return supabaseGet(
    "events",
    {
      select:
        "created_at,event_type,property_id,metadata",

      "metadata->>visitor_id":
        `eq.${visitorId}`,

      event_type:
        "in.(property_view,push_sent)",

      order:
        "created_at.desc",

      limit:
        "1000"
    }
  );
}

function pushedToday(history) {
  const lastPush =
    history.find(
      row =>
        row?.event_type ===
        "push_sent"
    );

  if (
    !lastPush?.created_at
  ) {
    return false;
  }

  const ageMs =
    Date.now() -
    new Date(
      lastPush.created_at
    ).getTime();

  return (
    ageMs <
    20 * 60 * 60 * 1000
  );
}

async function sendOneSignal({
  visitorId,
  property,
  profile
}) {
  const id =
    propertyIdentity(
      property
    );

  const propertyDbUuid =
    propertyUuid(
      property
    );

  const name =
    titleOf(
      property
    );

  const neighborhood =
    clean(
      property?.neighborhood
    );

  const price =
    num(
      property?.price
    );

  const url =
    `https://app.yincorp.com.br/?imovel=${encodeURIComponent(id)}` +
    `&push=1&visitor=${encodeURIComponent(visitorId)}`;

  const body = {
    app_id:
      ONESIGNAL_APP_ID,

    target_channel:
      "push",

    include_aliases: {
      external_id: [
        visitorId
      ]
    },

    idempotency_key:
      crypto.randomUUID(),

    headings: {
      en:
        neighborhood
          ? `Mais uma opção em ${neighborhood}`
          : "Mais uma opção para você"
    },

    contents: {
      en:
        `${name}` +
        (
          price > 0
            ? ` · ${price.toLocaleString(
                "pt-BR",
                {
                  style:
                    "currency",

                  currency:
                    "BRL",

                  maximumFractionDigits:
                    0
                }
              )}`
            : ""
        )
    },

    url,

    data: {
      property_id:
        id,

      property_uuid:
        propertyDbUuid,

      visitor_id:
        visitorId,

      neighborhood,

      push_type:
        "daily_property"
    }
  };

  if (
    clean(
      property?.image_url
    )
  ) {
    body.chrome_web_image =
      clean(
        property.image_url
      );
  }

  const response =
    await fetch(
      "https://api.onesignal.com/notifications",
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Key ${ONESIGNAL_REST_API_KEY}`,

          "Content-Type":
            "application/json; charset=utf-8"
        },

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (
    !response.ok ||
    !data?.id
  ) {
    throw new Error(
      `OneSignal ${response.status}: ${JSON.stringify(data).slice(0, 900)}`
    );
  }

  return {
    notificationId:
      data.id,

    url
  };
}

export default async function handler(
  req,
  res
) {
  if (
    ![
      "GET",
      "POST"
    ].includes(
      req.method
    )
  ) {
    return res
      .status(405)
      .json({
        success: false,
        error: "Method not allowed"
      });
  }

  if (CRON_SECRET) {
    const authorization =
      clean(
        req.headers.authorization
      );

    if (
      authorization !==
      `Bearer ${CRON_SECRET}`
    ) {
      return res
        .status(401)
        .json({
          success: false,
          error: "Unauthorized"
        });
    }
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVER_KEY ||
    !ONESIGNAL_APP_ID ||
    !ONESIGNAL_REST_API_KEY
  ) {
    return res
      .status(500)
      .json({
        success: false,

        error:
          "Configure SUPABASE_URL, SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY), ONESIGNAL_APP_ID e ONESIGNAL_REST_API_KEY."
      });
  }

  try {
    const subscriptionEvents =
      await supabaseGet(
        "events",
        {
          select:
            "created_at,event_type,metadata",

          event_type:
            "in.(push_subscribed,push_unsubscribed)",

          order:
            "created_at.desc",

          limit:
            "5000"
        }
      );

    const states =
      latestStateByVisitor(
        subscriptionEvents
      );

    const summary = {
      subscribers_considered: 0,
      sent: 0,
      skipped_today: 0,
      skipped_unsubscribed: 0,
      skipped_no_profile: 0,
      skipped_no_inventory: 0,
      skipped_exhausted: 0,
      errors: 0
    };

    for (
      const [
        visitorId,
        stateRow
      ] of states
    ) {
      if (
        stateRow?.event_type !==
        "push_subscribed"
      ) {
        summary
          .skipped_unsubscribed++;

        continue;
      }

      const profile =
        stateRow
          ?.metadata
          ?.push_profile ||
        {};

      if (
        !clean(
          profile.neighborhood
        ) &&
        !clean(
          profile.region
        ) &&
        !clean(
          profile.type
        ) &&
        num(
          profile.bedrooms
        ) <= 0 &&
        num(
          profile.min_price
        ) <= 0 &&
        num(
          profile.max_price
        ) <= 0
      ) {
        summary
          .skipped_no_profile++;

        continue;
      }

      summary
        .subscribers_considered++;

      try {
        const history =
          await visitorHistory(
            visitorId
          );

        if (
          pushedToday(
            history
          )
        ) {
          summary
            .skipped_today++;

          continue;
        }

        const seen =
          new Set(
            history
              .filter(
                row =>
                  row?.event_type ===
                  "property_view"
              )
              .map(
                row =>
                  clean(
                    row?.metadata?.property_id ||
                    row?.metadata?.property?.id ||
                    row?.property_id
                  )
              )
              .filter(Boolean)
          );

        const alreadyPushed =
          new Set(
            history
              .filter(
                row =>
                  row?.event_type ===
                  "push_sent"
              )
              .map(
                row =>
                  clean(
                    row?.metadata?.property_id ||
                    row?.metadata?.property?.id ||
                    row?.property_id
                  )
              )
              .filter(Boolean)
          );

        const maxPushes =
          Math.max(
            1,
            Math.min(
              30,
              num(
                stateRow
                  ?.metadata
                  ?.push
                  ?.max_pushes
              ) || 30
            )
          );

        if (
          alreadyPushed.size >=
          maxPushes
        ) {
          summary
            .skipped_exhausted++;

          continue;
        }

        const properties =
          await supabaseGet(
            "properties",
            makePropertyQuery(
              profile
            )
          );

        if (
          !Array.isArray(
            properties
          ) ||
          !properties.length
        ) {
          summary
            .skipped_no_inventory++;

          continue;
        }

        const nextProperty =
          properties.find(
            property => {
              const id =
                propertyIdentity(
                  property
                );

              return (
                id &&
                !seen.has(id) &&
                !alreadyPushed.has(id)
              );
            }
          );

        if (
          !nextProperty
        ) {
          summary
            .skipped_exhausted++;

          continue;
        }

        const sent =
          await sendOneSignal({
            visitorId,
            property:
              nextProperty,
            profile
          });

        const nextPropertyUuid =
          propertyUuid(
            nextProperty
          );

        const nextPropertyExternalId =
          propertyIdentity(
            nextProperty
          );

        await supabaseInsert(
          "events",
          {
            property_id:
              nextPropertyUuid || null,

            event_type:
              "push_sent",

            metadata: {
              visitor_id:
                visitorId,

              property_id:
                nextPropertyExternalId,

              property_uuid:
                nextPropertyUuid,

              push: {
                provider:
                  "onesignal",

                cadence:
                  "daily",

                notification_id:
                  sent.notificationId,

                sent_at:
                  new Date()
                    .toISOString(),

                sequence:
                  alreadyPushed.size + 1,

                max_pushes:
                  maxPushes
              },

              push_profile:
                profile,

              property: {
                id:
                  nextPropertyExternalId,

                db_id:
                  nextPropertyUuid,

                name:
                  titleOf(
                    nextProperty
                  ),

                neighborhood:
                  clean(
                    nextProperty?.neighborhood
                  ),

                value:
                  num(
                    nextProperty?.price
                  ),

                bedrooms:
                  num(
                    nextProperty?.bedrooms
                  ),

                area:
                  num(
                    nextProperty?.area
                  ),

                source:
                  clean(
                    nextProperty?.source
                  )
              },

              launch_url:
                sent.url
            }
          }
        );

        summary.sent++;

      } catch (
        error
      ) {
        summary.errors++;

        console.error(
          "PUSH_DAILY_VISITOR_ERROR",
          visitorId,
          error
        );
      }
    }

    return res
      .status(200)
      .json({
        success: true,
        summary
      });

  } catch (
    error
  ) {
    console.error(
      "PUSH_DAILY_FATAL",
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        error:
          String(
            error?.message ||
            error
          )
      });
  }
}
