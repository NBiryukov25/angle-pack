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

Supported model adapters live in server/models.js, one entry per endpoint,
each transcribed from that endpoint's own published API schema and citing the
documentation URL it came from. server/fal.js assembles no payload of its own.

| Model | Family | Image input | Output size |
|---|---|---|---|
| fal-ai/flux-2/edit (default) | FLUX | up to 4 image_urls | exact width/height |
| fal-ai/flux-2-pro/edit | FLUX | image_urls, no num_images field | exact width/height |
| fal-ai/flux-pro/kontext/max/multi | FLUX | image_urls | aspect ratio only |
| fal-ai/qwen-image-edit-plus | Qwen | image_urls | exact width/height |
| fal-ai/qwen-image-edit | Qwen | one image_url | exact width/height |
| fal-ai/qwen-image | Qwen | none (text to image) | exact width/height |
| fal-ai/wan/v2.2-a14b/image-to-image | WAN | one image_url | exact width/height |
| fal-ai/wan/v2.2-a14b/text-to-image | WAN | none (text to image) | exact width/height |
| fal-ai/photomaker | PhotoMaker | one ZIP archive URL | endpoint default |

FAL_IMAGE_MODEL sets the server default. A submitted session may name any model
in that table, and any single output may override it; the manifest records which
endpoint produced each file. Files from an overriding model carry the model in
their name, and in Model Comparison every file does.

Endpoints differ in ways the adapters absorb. WAN returns a single `image`
object rather than an `images` list, and takes `image_format` rather than
`output_format`. Kontext accepts `aspect_ratio` instead of pixel dimensions, so
the requested 1024x1536 becomes 2:3. PhotoMaker takes its references as one
uploaded ZIP archive (built by server/archive.js, stored not deflated), has no
output-size control, and needs its class-word trigger in the prompt, which the
adapter always supplies; its shorter prompt limit is applied by trimming on
paragraph boundaries. The two text-to-image endpoints accept no image input at
all: your references are never uploaded to them, the manifest records
usesReferences false, and the browser marks them accordingly. They are refused
for Outpaint Zoom, where discarding the expanded canvas would silently produce
an unrelated picture.

Each endpoint caps how many separate images it accepts. Views beyond that cap
are merged into one labelled contact sheet, so a single-input endpoint still
receives every reference photograph; the manifest records the mapping. Contact
sheet panels have reduced resolution, which can limit detail preservation.

Only the default FLUX.2 path has been exercised against the paid API. The other
adapters are verified against the documented schemas and fake transports;
confirm each with one deliberate LIVE request before relying on it.

## Operations

| Mode | Provider calls | Needs |
|---|---|---|
| Crop Zoom | none, local Sharp crop | 1 reference |
| Outpaint Zoom | 1 per output | 1 reference, a model that accepts image input |
| Generative Angle | 1 per output | 1 reference |
| Multi-Reference | 1 per output | 2 references |
| Combined Images | 1 per output | 2 references, a written direction per output |
| Attribute Combine | 1 per output | 2 references, 2+ attribute sources per output |
| Model Comparison | 1 per output | 2+ different models across the outputs |

public/presets.js holds that table, shared byte-for-byte with the frontend, and
the schema, the prompt builder and the browser controls all read it. Combined
Images and Attribute Combine drop the "same subject" preamble that would
otherwise tell the model to merge separate people into one face. Model
Comparison holds every other variable steady, so the prompt each output builds
is identical and the model is the only difference.

These endpoints do not expose a native mask field. Outpaint is prompt-guided canvas extension: the backend supplies neutral margins and original reference evidence, while saving local canvas/mask artifacts. It does not send unsupported mask parameters or promise exact original-pixel preservation. Crop mode remains an exact local Sharp crop with zero model calls. Generative Angle explicitly requests a new camera viewpoint; it remains a plausible AI reconstruction.

Manifests retain references, hashes, settings, prompts, timestamps, revisions, provider request IDs, returned seed and generation parameters. They support repeating settings, not guaranteed identical images. No provider credentials are written into manifests or browser assets. A Render key must never be copied into the Joyce repo. Uploads and generated results also pass through fal.ai storage when LIVE is explicitly requested.

Documentation checked: [FLUX.2 edit](https://fal.ai/models/fal-ai/flux-2/edit/api), [FLUX.2 pro edit](https://fal.ai/models/fal-ai/flux-2-pro/edit/api), [Render Node deployment](https://render.com/docs/deploy-node-express-app), [Render Node version](https://render.com/docs/node-version).
