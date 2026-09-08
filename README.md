# ANGLE PACK — Render backend

Production frontend: **joyce-photos-gallery / portrait.html**, hosted by GitHub Pages. This repository supplies the separate Render API. The retained public/ interface is for local development, not the production website.

1. Test locally (no provider key needed):
   ```powershell
   npm ci
   npm test
   npm run check
   node scripts/preview-pages.js "C:/Users/rcrom/OneDrive/02_DOCUMENTS_RECORDS/Joyce-photos-gallery"
   ```
   Open http://127.0.0.1:8080/portrait.html → **ANGLE PACK**, sign in with `local-preview-password`, upload a photo, and press **GENERATE 1 IMAGE**. This preview ignores .env and forces mock mode. Stop with Ctrl+C.
2. Commit the files listed in [COMMIT_FILES.md](COMMIT_FILES.md) to their respective repositories. Push when ready; nothing has been pushed automatically.
3. Render → **New → Web Service** → connect the **ANGLE PACK backend repository**. Language **Node**, branch **main**, root directory blank, build **`npm ci --omit=dev`**, start **`npm start`**, health check **`/healthz`**. No disk or Blueprint.
4. Enter these Render environment variables:

   | Name | Value |
   |---|---|
   | NODE_ENV | production |
   | NODE_VERSION | 24.15.0 |
   | FAL_KEY | Your fal.ai API key, entered only in Render |
   | FAL_IMAGE_MODEL | fal-ai/flux-2/edit (the default; any model in [DEPLOY_RENDER.md](DEPLOY_RENDER.md) works, and a session can pick another at run time) |
   | ANGLE_PACK_MOCK | false (use true for a mock-only deployment) |
   | APP_PASSWORD | Your own unique password, 12–256 characters |

5. Deploy the backend. In the **Joyce repository**, edit **assets/angle-pack/config.js** and replace `https://YOUR-RENDER-SERVICE.onrender.com` with the Render service URL. Commit/push the Joyce changes through its existing GitHub Pages publishing workflow.
6. On iPhone, open https://nbiryukov25.github.io/joyce-photos-gallery/portrait.html → **ANGLE PACK**. Sign in. First leave **Generation mode = MOCK**, generate one image, regenerate it, and download the PNG. Then select **LIVE**, **Generative Angle**, **1 output**, an angle and framing, and explicitly press **GENERATE 1 IMAGE** for your first paid test. Only the default FLUX.2 model has been exercised against the paid API; give any other model its own single deliberate LIVE request before relying on it.

Download results and the manifest promptly: server files and sign-in sessions can disappear on restart/redeploy. Real image quality has not been tested with paid calls.

For normal backend-only local use: copy .env.example to .env, enter local values there, and run `npm start`; or run `npm run mock` to force mock mode. Never commit .env. No OpenAI key is required.

Seven operations are available: Crop Zoom, Outpaint Zoom, Generative Angle, Multi-Reference, Combined Images, Attribute Combine and Model Comparison. The still-image model selector offers FLUX, Qwen, WAN and PhotoMaker endpoints, per session or per individual output. Two of them are text-to-image and never receive your reference photographs; the selector says so.

Details: [API, authentication and model notes](DEPLOY_RENDER.md), [validation](VALIDATION.md).
