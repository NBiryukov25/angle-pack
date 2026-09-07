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

The production Render URL is intentionally a placeholder in the frontend config. Provider access, credit balance and generated-image quality require your explicit first LIVE test. Four-input FLUX.2 packing reduces detail in combined panels. Outpaint uses prompt-guided canvas extension, not a native mask API. Download results before temporary storage disappears. No claim of mathematically exact reconstruction or deterministic image reproduction is made.
