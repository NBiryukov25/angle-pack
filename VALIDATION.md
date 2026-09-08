# Validation — fal.ai / GitHub Pages architecture

Validated locally on 2026-09-06 with Node 24.15.0. No paid fal.ai requests, provider uploads, pushes or deployments were made.

- Original application baseline: 19 tests passed before migration.
- Updated `npm test`: 25 test-runner entries passed, zero failures (24 named tests plus the fake transport helper module).
- `npm run check`: all backend/developer-UI/test JavaScript syntax checks passed.
- `node scripts/check-pages.js "C:/Users/rcrom/OneDrive/02_DOCUMENTS_RECORDS/Joyce-photos-gallery"`: passed. Verifies frontend module and original inline-script syntax, production/local API-base selection, multipart upload helper usage, absence of provider secrets/SDK in frontend assets, shared copies, original tool anchors, and exact preservation of original portrait.html content after removing the integration-specific additions.
- Automated coverage includes production GitHub Pages CORS, rejection of other origins and production localhost, development localhost, bearer sign-in/logout, authenticated uploads/downloads, mock generation, individual regeneration, expired storage/auth and unavailable-backend errors, exact crop pixels, outpaint canvas preparation, all-reference contact-sheet mapping, fal queue contract with fake transport, cost bounds and no automatic retries.
- Browser verification before the environment resumed: native Tools card, password sign-in across ports, synthetic reference upload, one-image MOCK generation, CHANGE ANGLE to Rear, revision 2, loaded output image and authenticated blob download links. The narrow viewport was set to 390×844; rendered content width and scroll width were both 375 pixels (no horizontal overflow). Controls and mobile screenshot were inspected.
- A later browser recheck after the session's sandbox change could not reach the local preview. Earlier successful browser checks remain valid; subsequent changes (manifest refresh, expired-session polling stop, upload helper) passed source/API tests. Physical iPhone Safari and deployed Render/GitHub Pages have not been tested.
- Existing Joyce scripts and markup were preserved by automated comparison with Git HEAD. External paid services used by unrelated Joyce tools were not invoked.


## Model selector, new modes and Model Comparison — 2026-09-08, Node v22.22.2

No paid fal.ai request, provider upload or LIVE submission was made for this work.

- `npm test`: 64 tests passed, zero failures (39 before this work began, all still passing).
- `npm run check` and `node scripts/check-pages.js` against the checked-out joyce-photos-gallery: passed.
- New automated coverage: every registry entry builds a payload matching its documented schema and cites its own API documentation URL; the default FLUX.2 payload is asserted field-for-field against the pre-existing behaviour; single-input endpoints receive one contact sheet holding every reference; text-to-image endpoints upload nothing; WAN's single-image result shape; PhotoMaker's ZIP archive is written, listed and integrity-tested with `unzip`; prompt trimming on paragraph boundaries; contact-sheet packing at every input cap without losing a view; per-session and per-output model choice reaching the right endpoint with distinct filenames; regeneration switching models; unknown models and text-only outpaint refused; each new mode's prompt, its reference and attribute rules, and identical prompts across a comparison; a failing model in a comparison leaving the others intact.
- Cross-copy coverage: every element id the app addresses exists in its own markup, the two frontend copies expose the same ids and functions, and the browser's rule checks mirror the server's.
- Browser verification in Chromium against the real page served by `scripts/preview-pages.js`: signed in, uploaded two references, walked all seven modes and recorded each mode note, cost line and validation state, confirmed Combined Images and Attribute Combine block submission until their rules are met and unblock afterwards, confirmed the model picker lists all ten entries grouped by family, confirmed Model Comparison prefills one model per family, and generated a three-output MOCK comparison whose results are each labelled with the model that produced them. Zero page errors.
- Two defects were found and fixed during this work: `condense` charged a paragraph separator for the final paragraph and over-trimmed prompts, and the upload change handler read `event.target` after an `await`, by which point it is null, so the file input was never cleared and re-picking the same photograph did nothing. The second predates this work and affected both frontends.
- `scripts/check-pages.js` was repaired. Its "unrelated portrait.html content preserved" check stripped the ANGLE PACK markup from the page and compared the remainder against Git HEAD; that became unsatisfiable once the integration was committed, because HEAD contains it. It now asserts that backend work leaves portrait.html byte-identical to HEAD.

## Repeat

```powershell
npm ci
npm test
npm run check
node scripts/check-pages.js "C:/Users/rcrom/OneDrive/02_DOCUMENTS_RECORDS/Joyce-photos-gallery"
node scripts/preview-pages.js "C:/Users/rcrom/OneDrive/02_DOCUMENTS_RECORDS/Joyce-photos-gallery"
```

Open http://127.0.0.1:8080/portrait.html → ANGLE PACK. Sign in with local-preview-password. Generate and regenerate in MOCK. The preview does not read .env and cannot upload to fal.ai. Stop with Ctrl+C.

## Limits still requiring a real deployment/test

The production Render URL is intentionally a placeholder in the frontend config. Provider access, credit balance and generated-image quality require your explicit first LIVE test. Four-input FLUX.2 packing reduces detail in combined panels, and the same applies more strongly to single-input endpoints, which receive every reference as one sheet.

Only the default fal-ai/flux-2/edit path has ever been exercised against the paid API. The eight other models are verified against their published input schemas and against fake transports; image quality, credit cost, latency and provider access for each remain unproven until you make one deliberate LIVE request per model. PhotoMaker's ZIP archive is checked with `unzip` locally but has not been accepted by the provider. The text-to-image endpoints (fal-ai/qwen-image and the WAN text-to-image model) never receive your reference photographs; they are offered for comparison and prompt-only work, not for identity preservation. Outpaint uses prompt-guided canvas extension, not a native mask API. Download results before temporary storage disappears. No claim of mathematically exact reconstruction or deterministic image reproduction is made.
