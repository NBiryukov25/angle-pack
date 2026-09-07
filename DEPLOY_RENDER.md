# Two repositories, one tool

joyce-photos-gallery/portrait.html → Render ANGLE PACK API → fal.ai.

The Joyce page has a native ANGLE PACK card in its Tools hub. A custom element with a shadow root isolates its styles and IDs without an iframe. Existing navigation, Three Faces and Transcribe remain. assets/angle-pack/config.js is the only public backend URL setting. Loopback pages automatically use http://127.0.0.1:3210.

Use the numbered deployment steps in [README.md](README.md). Render uses a standard Web Service with npm ci --omit=dev, npm start, /healthz, and no persistent disk. Keep one service instance: sessions, login tokens and job coordination belong to that instance. Hosted files live in the operating system temporary directory. A sleeping service can take time to wake; the UI explains connection failures and offers reconnect.

## Authentication and CORS

APP_PASSWORD is required in production (12–256 characters). The user enters it at runtime into the in-page sign-in form. The backend returns a random opaque bearer token, valid for eight hours, kept only in browser memory. Refreshing requires signing in again; generating or switching between Tools does not. Logout invalidates the token. Restart invalidates all tokens. The existing same-origin cookie login remains available for the developer UI.

The Pages client uses credentials: omit, Authorization: Bearer … and X-Angle-Pack-Token for mutations. It does not rely on third-party cookies, browser password popups, or credentials embedded in URLs. Downloads are fetched through the authenticated API and exposed as temporary browser blob links.

Production cross-origin access is limited to **https://nbiryukov25.github.io** in server/app.js. Same-origin backend requests are also supported for the retained developer interface. Development additionally permits http://localhost:<port> and http://127.0.0.1:<port>; these are rejected in production. No wildcard CORS. Allowed methods: GET, POST, OPTIONS. Allowed request headers: Content-Type, Authorization, X-Angle-Pack-Token. Exposed response header: Content-Disposition. Origin is echoed only when allowed; Vary: Origin is set. No Access-Control-Allow-Credentials is needed.

## Existing API routes

| Method / route | Purpose |
|---|---|
| GET /healthz | Public process health |
| POST /api/auth/login | JSON password → bearer token |
| POST /api/auth/logout | Invalidate sign-in |
| GET /api/config | Safe configuration for authenticated clients |
| POST /api/jobs | Multipart: 1–5 references files plus JSON string spec |
| GET /api/sessions | Saved session summaries |
| GET /api/sessions/:id | Manifest and generation progress |
| POST /api/sessions/:id/outputs/:index/regenerate | JSON { output, execution }; only this output |
| GET /api/sessions/:id/reference/:index | Authenticated reference image |
| GET /api/sessions/:id/file/:filename | Authenticated result/manifest; ?download=1 for attachment |

All /api/ routes except login require authentication in production. A missing session/file can mean temporary storage expired. Polling never submits generation requests.

## fal.ai implementation

server/config.js centrally selects FAL_IMAGE_MODEL, FAL_IMAGE_SIZE (default 1024x1536), and server-only FAL_KEY. server/fal.js handles file uploads with @fal-ai/client, one raw queue submission per output, status polling, result download, PNG normalization and sanitized failures. Queue submission has no automatic retries. Interrupted jobs are not resubmitted on restart. Tests inject fake upload/queue/download transports; mock mode bypasses the provider entirely.

Supported model adapters:

- Default fal-ai/flux-2/edit: prompt, image_urls, image_size, num_images=1, output_format=png, enable_safety_checker=true.
- Optional fal-ai/flux-2-pro/edit: the same supported fields, excluding num_images (not documented for this endpoint).

FLUX.2 dev accepts four inputs. When more are needed, the first three remain separate and the remaining views are combined into a labeled evidence contact sheet. All five references are represented; the manifest records the mapping. Outpaint adds a source canvas first, then packs excess reference views. Contact-sheet panels have reduced resolution, which can limit detail preservation.

These endpoints do not expose a native mask field. Outpaint is prompt-guided canvas extension: the backend supplies neutral margins and original reference evidence, while saving local canvas/mask artifacts. It does not send unsupported mask parameters or promise exact original-pixel preservation. Crop mode remains an exact local Sharp crop with zero model calls. Generative Angle explicitly requests a new camera viewpoint; it remains a plausible AI reconstruction.

Manifests retain references, hashes, settings, prompts, timestamps, revisions, provider request IDs, returned seed and generation parameters. They support repeating settings, not guaranteed identical images. No provider credentials are written into manifests or browser assets. A Render key must never be copied into the Joyce repo. Uploads and generated results also pass through fal.ai storage when LIVE is explicitly requested.

Documentation checked: [FLUX.2 edit](https://fal.ai/models/fal-ai/flux-2/edit/api), [FLUX.2 pro edit](https://fal.ai/models/fal-ai/flux-2-pro/edit/api), [Render Node deployment](https://render.com/docs/deploy-node-express-app), [Render Node version](https://render.com/docs/node-version).
