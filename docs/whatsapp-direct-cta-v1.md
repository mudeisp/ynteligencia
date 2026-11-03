# WhatsApp Direct CTA V1

Base: `main` at `6e15e2f1bc52ab9a8d4184f08af32b69d772532f`.
Work branch: the existing `whatsapp-direct-cta-v1`.

## Previous behavior

- Classic app: `openPropertySpecialist(p)` sent `property_whatsapp_click` to GA4 and `events`, then called `openLeadCapture(p)`. That function sent `specialist_cta_opened` to the ads lane and required the form before `/api/lead`, `lead_created`, and WhatsApp.
- ES/SP portal: `[data-contact]` opened `contact-dialog` and sent `specialist_cta_opened`. Submitting used `/api/portal/lead` (the existing portal adapter to the lead handler), then `lead_created`. The continuation link sent the legacy `property_whatsapp_click`.
- Property-detail human contact, floating contact and the Match IA property handoff shared `openPropertySpecialist`. The separate Agent conversation action remains available.

## New behavior

`Falar pelo WhatsApp` calls the shared `YntWhatsAppContact.open` directly. It does not open a form, call a lead endpoint, emit `specialist_cta_opened`, or emit `lead_created`. The message contains the property/development name, without technical IDs or attribution. `Prefiro deixar meus dados` opens the original form and preserves its submission/conversion behavior.

The shared helper owns the existing destination number `5511992976368`. The existing form continuation URLs use that helper too; their message and lead logic remain unchanged. ES and SP share server-rendered `contactActions` and the browser helper. An aggregate development contact includes its development token/name, without fabricating a selected unit. A typology contact includes its real external ID and database UUID.

## Persistence and attribution

Both requests start synchronously on click, before navigation:

1. `yntAdsTrack` / portal `adsTrack` posts `whatsapp_cta_clicked` to `/api/ads?action=event`. Existing `handleAdsEvent` -> `AdsIntelligence.recordAdsEvent` inserts into `public.ads_events`. The only server contract change is accepting this new client event name. Existing deduplication still applies.
2. `supabaseTrack` / portal `track` posts the same event type to the existing `public.events` REST endpoint. Its existing session, visitor, journey, campaign intent, attribution, first/current/previous touch enrichment remains in use. UUID association remains in `events.property_id`; external identity remains in metadata.

The ads adapter adds metadata for this event only: property context, URL/path/time, existing `first_touch`/`current_touch` snapshots, and portal acquisition context when present. The existing attribution helper supplies all Google click IDs and UTMs. Available campaign IDs/channel information inside those snapshots are retained. No attribution is rebuilt.

Both requests use `keepalive`. Navigation waits for both attempts or a 700 ms timeout, whichever finishes first. Rejection, HTTP failure, synchronous tracking error, missing tracking, and timeout do not prevent contact. Rapid taps share one pending attempt; a short post-navigation guard prevents another redirect. Delivery is best effort: offline clients or requests rejected by the server cannot be guaranteed persisted. No new tracking infrastructure, schema, policy or remote configuration is introduced.

Example ads request (synthetic identifiers, no contact PII):

```json
{
  "product": "ynteligencia",
  "event_name": "whatsapp_cta_clicked",
  "visitor_id": "11111111-1111-4111-8111-111111111111",
  "session_id": "22222222-2222-4222-8222-222222222222",
  "gclid": "example-click",
  "gbraid": "",
  "wbraid": "",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "example-campaign",
  "utm_term": "example-term",
  "utm_content": "example-ad",
  "intent": {"development": "Mandarim The Legend", "inventory_source": "todos"},
  "property": {
    "property_id": "orulo:46939:1",
    "external_id": "orulo:46939:1",
    "db_id": "33333333-3333-4333-8333-333333333333",
    "name": "Mandarim The Legend",
    "development": "Mandarim The Legend",
    "city": "São Paulo",
    "neighborhood": "Brooklin",
    "price": 950000,
    "inventory_source": "novos"
  },
  "metadata": {
    "development_name": "Mandarim The Legend",
    "city": "São Paulo",
    "page": "/sp/sao-paulo/empreendimento/example",
    "url": "https://app.yincorp.com.br/sp/sao-paulo/empreendimento/example",
    "timestamp": "2026-11-03T12:00:00.000Z",
    "first_touch": {"gclid": "example-click", "utm_source": "google", "utm_medium": "cpc"},
    "current_touch": {"gclid": "example-click", "utm_source": "google", "utm_medium": "cpc"},
    "acquisition": {"channel": "google_ads", "source": "google", "medium": "cpc"}
  }
}
```

Existing normalization stores property columns and preserves metadata; city and external ID are also retained in telemetry metadata.

## Legacy event decision

The misleading `property_whatsapp_click` is replaced on the classic primary contact path, without emitting a second alias for the same click. Its historical records remain unchanged. The existing portal post-form continuation still emits that legacy event for compatibility. Count direct contacts with `whatsapp_cta_clicked`, separately from `specialist_cta_opened` and `lead_created`; the two storage lanes represent the same interaction and must not be summed. Dashboards using the former classic primary-contact event need to adopt the new canonical name. No Google Ads/Meta conversion rule or lead scoring rule was changed to count WhatsApp as a lead.

## Validation

- `node whatsapp-direct-cta.test.js`: 12 tests pass, covering both states, generated CTAs, real client tracking functions, association, attribution, message, direct navigation, tracking failures/timeout, duplicate taps and original form submission.
- Relevant existing portal, handoff, investment and new contact test files were run together.
- Full `node --test --test-reporter=tap`: base has 23 passing / 19 failing files; implementation has 24 passing / the same 19 failing files. Individual pre-existing failures were also compared with the base; differences were only absolute checkout paths. Examples: absent `psql`, old tests expecting inline app functions in `index.html`, and existing architectural assertions. No remote database was contacted by these validations.
- `node --check` on all 13 changed JavaScript/test files passes.
- `node scripts/build-portal-session.mjs` passes and regenerates the adapter from the existing helpers.
- `npm run lint`, `npm run typecheck`, `npm run build` cannot run: this base has no `package.json`, lint/typecheck configuration or general build command. No replacement toolchain was invented.
- Browser verification was attempted, but the executor denied binding the local HTTP server (`listen EPERM`). The additional network-permission attempt did not complete. Real-browser/mobile visual verification remains pending.

No Supabase/Vercel configuration or data changes, deployment, or merge were performed.

## PR #73 follow-up: persistent availability CTA

The persistent action now reads **Consultar disponibilidade** and uses exactly the same `YntWhatsAppContact.open` binding and `whatsapp_cta_clicked` event. On ES/SP development and typology pages it remains fixed from the start of navigation, rather than waiting until the availability section enters the viewport. Mobile has 12 px side margins, a 56 px touch target and a bottom offset including `safe-area-inset-bottom`; desktop uses a compact 320 px panel. Content has bottom clearance. Open form/gallery/plan dialogs hide the persistent contact action.

The selected typology ID stays on `data-whatsapp`; aggregate development pages keep it empty and send only the existing development context. No unit is inferred. Internal page CTAs and the secondary form remain available. The classic property detail likewise has one fixed availability action; its form and Agent conversation actions remain in the page. The general floating contact uses the same availability label.

Validation: `node whatsapp-direct-cta.test.js` passes **16/16** tests, including both states, selected-unit and aggregate context, canonical tracking, no form/lead on direct contact, rapid taps, secondary form submission, fixed/safe-area styling and overlay suppression. The relevant 10 test files and `node --check` were rerun. `portal-session.js` regeneration remains unchanged; no tracking/attribution helper was modified by this follow-up. Browser/mobile visual verification remains subject to the executor limitation documented above.
