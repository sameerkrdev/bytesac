# Bytesac visual assets

Generated with the Runware MCP on 2026-10-04 for the web redesign (Spec 17). One material family: frosted glass in ice
white, pale sky blue and deep navy, on soft diffuse studio light, plus calm sky plates. **No UI is baked into any image**
— product UI is always real code layered on top. Phone screens are left blank so the Expo app's real screens can
replace them in phase 15 of the brief.

Sources (full resolution, pre-crop) live in `apps/web/visuals-src/` and are not served. Optimised files here were
cropped to the object's alpha bounds (+4% padding) and encoded as WebP with ffmpeg (`libwebp`, quality 80–84).

| File (widths) | Contains | Used on | Model · task |
|---|---|---|---|
| `atmosphere/sky-day-{2560,1440,800}.webp` | Pale blue morning sky, luminous cumulus along the lower third, empty upper two thirds for type | Landing hero and closing CTA (light theme), sign-in, 404 | FLUX 3 Image `bfl:flux@3-image` · text-to-image 3136×1344 · task `68700e20-a6ad-4991-b5ff-f15af0a9e7da` |
| `atmosphere/sky-night-{2560,1440,800}.webp` | Deep navy high-altitude dusk sky, moonlit cloud deck low | Same places in the dark theme | FLUX 3 Image · text-to-image 3136×1344 · task `5468c5a6-e8da-40b2-a4c3-a36a660540e3` |
| `devices/hand-phone-empty-{880,520}.webp` | Transparent cut-out: a hand holding a front-facing phone with a frosted-silver frame and a **blank** off-white screen | Landing hero device (real UI is layered into the screen rectangle, see below) | FLUX 3 Image text-to-image 1776×2368 (task `c06cfd8f-dfa4-49f6-8a1f-96bd8d26af03`) → FLUX 3 edit to a flat background at 1K (task `b6dacef8-dd6d-47dc-9478-8d8b8ec153f8`) → Bria RMBG v2.0 `bria:2@1` cut-out (task `bb5a7d4b-897d-40cb-96ec-c606d40fdcfd`) |
| `objects/glass-allocation-ring-{1200,640}.webp` | Transparent cut-out: a frosted-glass torus split into five tinted segments — the "allocation ring" | Strategy/allocation storytelling (landing "strategy" section, basket research hero) | FLUX 3 Image · 2048² (task `c73ecfe9-f2aa-48fb-b7a4-0ae9f088f62c`) → BiRefNet Matting `runware:112@9` (task `5877ae37-73eb-4b78-b521-aac991e41c20`) |
| `objects/glass-wallet-{1200,640}.webp` | Transparent cut-out: two stacked glass cards over a navy layer — the user's wallet | Self-custody section ("Your wallet, your signature"), `/self-custody` | FLUX 3 Image · 2048² (task `0fcbfd96-4192-45bf-9f22-4e83917263e1`) → BiRefNet Matting (task `095e1fd4-8f83-436b-ad1c-bf72c20b168e`) |
| `objects/glass-network-nodes-{1200,640}.webp` | Transparent cut-out: glass spheres joined by thin glass rods around a central sphere — the multi-chain network | Multi-chain section, `/how-it-works` | FLUX 3 Image · 2048² (task `99ed59d3-81d7-41d3-b985-06fd558f973e`) → BiRefNet Matting (task `bebdb172-5b3a-4d8e-a62e-b7b80766ebd2`) |
| `objects/glass-portfolio-prism-{1000,560}.webp` | Transparent cut-out: four stacked glass layers from ice white to navy — a portfolio built from layers | Portfolio storytelling, for-managers page, empty states | FLUX 3 Image · 2048² (task `4a3b80e9-cddf-4508-b474-b9b9ededc23e`) → BiRefNet Matting (task `7a6b74bc-892b-486a-8ef6-fd0493ba58ba`) |
| `devices/iphone-front-{900,480}.webp` | Transparent: a modern front-facing phone (titanium frame, thin bezels, Dynamic Island). The screen is **punched out to transparent**, so real UI sits behind the frame | `Phone` in `components/visual/scenery.tsx` | GPT Image 2.5 Sunburst `openai:gpt-image@2.5-sunburst`, native transparent background, 1024×2048 · task `dc321e78-f178-4bd7-88cd-298754bdfaa2` |
| `devices/hand-iphone-{1000,560}.webp` | Transparent: a hand holding the same phone; screen punched out | Landing hero and closing CTA (`HandPhone`) | GPT Image 2.5 Sunburst, transparent, 1536×2048 · task `a262fbdb-d2e6-4dbe-b083-b23183121558` |
| `atmosphere/clouds-bank-{2560,1600}.webp` | Transparent: a bank of soft white cumulus (no sky) | Drifting low cloud layers in `Sky` | GPT Image 2.5 Sunburst, transparent, 3072×1024 · task `9d53844c-6c00-49c0-8ebc-8f1efa8fbf49` |
| `atmosphere/clouds-wisps-{2560,1600}.webp` | Transparent: thin high wisps | Slow high cloud layer in `Sky` | GPT Image 2.5 Sunburst, transparent, 3072×1024 · task `2bcabfa1-ba07-4f43-bcc6-2ec070d36e0e` |

## Phone screen rectangles

Round 2 devices are generated with a native transparent background (no cut-out, so no dulling) and the blank screen is
flood-filled to alpha 0 with sharp. UI is placed **behind** the frame, so the bezel and Dynamic Island overlap it.

- `iphone-front-*` (892×1860): screen left 5.0%, top 1.8%, width 90.0%, height 96.3% (slot is drawn ~0.4% larger).
- `hand-iphone-*` (1353×1915): screen left 36.3%, top 1.7%, width 51.4%, height 78.0%.

The sky is a CSS gradient (`sky-field` utility) with the transparent cloud strips drifting over it (`bx-drift`,
mirror-tiled so the loop has no seam). `atmosphere/sky-{day,night}-*` and `devices/hand-phone-empty-*` were removed (see git history); their rows
above are kept for provenance.

## Rules

- Generate only after checking this list; reuse before generating.
- Keep the family: frosted glass, ice white / pale sky / navy tints, soft top-left studio light, no logos, no text, no
  third-party marks in generated art. (Round 2, user decision: real crypto logos are shown in the UI from the vendored
  CC0 `public/crypto` set or a logo uploaded to the registry — never baked into generated images.)
- Never generate product UI or screenshots as images.
- Add a row here for every new asset: file, contents, where it is used, model, task UUID.
