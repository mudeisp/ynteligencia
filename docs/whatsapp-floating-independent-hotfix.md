# Independent WhatsApp floating contact hotfix

Branch: `hotfix/whatsapp-floating-independent`.
Base: current `main`, `137061e812ec88b185bf599c4d23aa54714cf3fe`.

The root-level `ynt-whatsapp-float` button is a separate 56 px green circle with the project's existing white WhatsApp SVG and `aria-label="Falar pelo WhatsApp"`. It is appended directly to `document.body`, outside transformed/scrolling property containers. CSS fixes it 16 px from the right and `16px + env(safe-area-inset-bottom)` from the bottom. Existing availability controls have a separate space beside it to prevent overlap. Mounting again reuses the same element and listener and refreshes its context resolver. Opening and closing the existing form, gallery or plan overlays hides/restores the icon through a mutation observer.

Two independent paths:

- **Consultar disponibilidade** uses the existing contact/form handler: `specialist_cta_opened` → existing lead endpoint → `lead_created`. No form fields, submission handlers or downstream services were changed.
- **Circular WhatsApp icon** calls `YntWhatsAppContact.open` directly. It never calls the form or a lead endpoint. Its only contact event is `whatsapp_cta_clicked` in the existing ads and telemetry lanes, with the same identity, attribution, keepalive, timeout and redirect deduplication behavior. No tracking contract or infrastructure changed.

Source inspection found that current main still bound the availability button to direct contact from PR #73. The hotfix changes only that binding back to the existing form to implement the two-path behavior explicitly requested; its label and visual styling remain. Other in-page contact actions remain available. The existing portal `/api/portal/lead` adapter and classic `/api/lead` flow are untouched internally.

ES and SP use the same mount and adapters. Selected typologies resolve their actual external/database IDs. General development pages use the development's token, name, city and neighborhood without choosing the first unit. The classic property-detail context is resolved at click time from the open property. No technical IDs are inserted into the customer message.

Validation:

- `node whatsapp-direct-cta.test.js`: 21 tests pass, including form versus independent icon, both states, both context types, attribution, no form/lead from icon, single redirect, repeated mounting, modal close/reappearance and fixed/safe-area styling.
- `node --test --test-reporter=tap portal.test.mjs sp-portal.test.mjs portal-editorial.test.mjs portal-composition.test.mjs portal-performance.test.mjs portal-semantics.test.mjs portal-v3.test.mjs investment-conversion.test.mjs agent-property-handoff.test.js whatsapp-direct-cta.test.js`: 10 files pass.
- `node --check` passes for the seven modified JavaScript/test files.
- `node scripts/build-portal-session.mjs` passes; generated adapter is byte-for-byte unchanged.
- Live browser/mobile visual verification is not claimed; the executor's local-server limitation documented in PR #73 remains.

No Supabase/Vercel changes, deployment, or merge.
