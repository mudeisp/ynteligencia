# Portal Yincorp: Espírito Santo

## Architecture

The existing HTML/JavaScript application, Vercel project, Supabase inventory, supplier sync, lead endpoint and media integration remain in place. The portal adds server-rendered public pages at `/es`. Existing root/campaign URLs are retained, with links to the portal added to the current desktop and side navigation.

`api/development.js` dispatches only requests with `portalPath` to `portal/handler.js`. Its existing JSON GET/POST behavior remains unchanged. Three scoped Vercel rewrites use this same function; the API function count stays at 12 and the existing daily cron remains unchanged.

No database schema, index, policy, credential, supplier subscription, domain or production deployment was changed by this implementation.

## URLs and information architecture

- `/es`: state inventory, grouped by development.
- `/es/vila-velha`: city page.
- `/es/vila-velha/praia-da-costa`: neighborhood page.
- `/es/vila-velha/empreendimento/arti-design-living--orulo-61639`: development page.
- Development path + `/tipologia/{properties UUID}`: individual catalog configuration, selected in the contact form.
- `/sitemap-portal.xml`: state, city, neighborhood, development and listing pagination URLs.

Names come from inventory. Unsupported locations return 404. Cariacica is not advertised as stocked: none was returned in the inspected active inventory. Routes support every Brazilian UF through the same implementation; the initial sitemap scope is ES. `PORTAL_SITEMAP_STATES=ES,SP` can expand discovery after performance/content verification. No new secret is required.

Development URLs contain a supplier identifier, so changes to the name can redirect to the current canonical path. Identical names do not authorize grouping. Records without a known supplier building ID remain separate, with a stable hash of their external identifier/UUID. Unit/configuration links retain the actual database UUID; commercial tracking uses the existing external ID, for example `orulo:61639:123456`.

## Reading the existing inventory

`portal/data.js` uses the existing `ads-store.js` REST helper and environment variables. It selects public listing fields plus explicit public JSON attributes, never the complete raw supplier object. Commercial contacts, restricted attachments and secret keys are not serialized into HTML.

All pages are based on active inventory. Each state is read in ordered batches of 500, including responses beyond the default REST limit. Failures return 503; partial data is not presented as a complete catalog. There is a 20-second request budget, a 50,000-record safety ceiling and a 60-second optional per-instance cache. The cache is only an optimization, never durable state. Shared HTML can be cached by the CDN for 60 seconds with a 120-second stale revalidation window.

The initial ES catalog is small enough for aggregation in the existing server function. Large states should be load-tested before rollout; for high volume, move aggregation/pagination behind an indexed query or read model in the same database. That optimization was not silently introduced as a schema change here. No national-scale performance claim is made.

Read-only verification on 27 October 2026, using the new REST query and the existing publishable configuration: 566 active rows, 172 supplier-identified developments, 10 cities. Vila Velha: 93 developments; Vitória: 46; Serra: 19; Guarapari: 5; Aracruz, Linhares and Viana: 2 each; Fundão, Ibiraçu and Santa Teresa: 1 each. These are inventory records/developments, not confirmed individually available units.

## Catalog and visual design

State/city/neighborhood pages present cards immediately, without a wizard. Primary filters: city, neighborhood, maximum price and minimum bedrooms. Name search and sort are expandable. Cards contain supplier photography, name, developer, geography, valid price minimum, area/bedroom/parking range and status when provided.

Filters are applied jointly to each configuration before the matching development is aggregated. A low price on one configuration cannot be combined with a bedroom count available only on a different, more expensive configuration.

The visual system uses deep teal, warm neutral backgrounds, generous spacing and a custom abstract coastal graphic. It does not use Zap code, assets or identity. It uses DM Sans/Manrope with system-font fallbacks. Cards and gallery reserve image space to reduce layout shifts. Images after the initial cards are lazy loaded. Responsive CSS covers one-, two- and three-column layouts; manual browser inspection was performed at the available narrow viewport, not on physical devices.

## SEO

Initial HTML includes content, project cards, titles, descriptions, canonical URL, real anchor links and JSON-LD BreadcrumbList/WebPage/ItemList. It does not depend on client-side rendering or hash routes for discovery. Each pagination page has its own URL and self-canonical.

Arbitrary search/facet combinations are `noindex,follow`. Tracking identifiers are omitted from canonicals. Configuration pages are `noindex,follow` and canonicalize to their development to avoid thin duplicate pages. Old names redirect with HTTP 308. Invalid paths and pagination return 404; inventory failures return 503 with Retry-After. HTML escaping and safe JSON serialization are applied to supplier content.

`robots.txt` advertises the portal sitemap on the current app origin. `PORTAL_CANONICAL_ORIGIN` can select another existing Yincorp origin, but a domain migration must coordinate robots/sitemap/canonical and redirects; no domain migration is part of this change. Vercel preview deployments are noindex and disable operational forms/tracking. The local snapshot also marks itself as a preview.

References: [Google URL structure](https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [breadcrumbs](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb). Indexability does not guarantee rankings, rich results or traffic.

## Contact, identity and measurement

The user explicitly authorized the existing `/api/lead` destination and WhatsApp +55 11 99297-6368 in this chat. Name and WhatsApp are required, email is optional. The selected configuration is retained. After the API confirms `success=true` and `supabase=true`, a WhatsApp continuation link is offered. An email-only success is insufficient. A failed request retains the form and does not present a successful conversion or WhatsApp continuation.

`assets/js/portal-session.js` is generated by `scripts/build-portal-session.mjs` from the current legacy helper functions. It reuses canonical visitor/session keys, shared `vid` rules, attribution touches, lead correlation ID and existing Supabase/Ads telemetry implementations. The legacy source and its boot order are not rewritten. Regenerate the adapter when the source helpers change.

Development views use `development_view` in existing product telemetry. A `property_view` is recorded only for an actual configuration page, never a fabricated representative unit. This deliberately distinguishes a project-level browse from a unit view. Existing media optimization rules are not reconfigured; reporting should account for this new project-level step. `lead_created` is sent to the existing Ads authority after operational persistence. Google conversion uses the existing destination, amount/currency and confirmed event ID. WhatsApp click measurement is emitted when the continuation is actually clicked, not when the form opens.

No real form, email or WhatsApp was submitted during verification. Existing discrepancies between historical lead events and operational rows were not claimed to be fixed. Webhook database timeouts are also outside this implementation.

## Validation

- `node scripts/build-portal-session.mjs`: generated adapter from existing helpers.
- `node --test portal.test.mjs build-info.test.js`: 23/23 pass (17 portal tests + 6 deployment identity tests).
- Full suite after changes: 398 tests, 288 pass, 110 fail.
- Unmodified baseline at commit `33fe720de8b32db1a58a19740b7ecfcefdef0afd`: 381 tests, 271 pass, 110 fail. Normalized failing test names match; no added failures. The one outdated assertion that prohibited all rewrites was updated to verify the scoped portal configuration and preserved cron/API function count.
- Baseline failures include unavailable local `psql` and existing source-contract tests; they were not hidden or fixed by unrelated changes.
- New tests cover grouping, homonyms, joint filters, SSR, canonical/redirects, pagination, malformed routes, preview/error handling, sitemap, multiple REST pages, persistence confirmation and identity/touch continuity.
- Read-only query using the new REST projection: 566 records / 172 developments / 10 cities.
- Manual browser flow: state → Serra → Manguinhos → Iliah → configuration-specific contact modal. Correct configuration and optional email confirmed.
- No physical-device sweep, production-form submission or Search Console indexing validation performed.

## Release boundary

Review the feature branch/patch before production. Root campaign URLs, API contracts, domains, database and supplier integration stay in place. No merge or production promotion is performed by this change. A local preview uses a dated public inventory snapshot with descriptions shortened and only primary photos; production reads the existing live inventory projection.
