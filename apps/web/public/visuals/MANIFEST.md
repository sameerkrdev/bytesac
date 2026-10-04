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

## Phone screen rectangle

`hand-phone-empty-*.webp` is 880×1168 (aspect 0.7534). The blank screen occupies, as a percentage of the image:
left **34.4%**, top **21.6%**, width **31.0%**, height **51.2%**, corner radius ≈ 13% of the screen width.
`components/visual/hand-phone.tsx` positions real UI into that rectangle.

## Rules

- Generate only after checking this list; reuse before generating.
- Keep the family: frosted glass, ice white / pale sky / navy tints, soft top-left studio light, no logos, no text, no
  third-party marks (no official chain or token logos either — chains are shown as typographic badges in code).
- Never generate product UI or screenshots as images.
- Add a row here for every new asset: file, contents, where it is used, model, task UUID.
