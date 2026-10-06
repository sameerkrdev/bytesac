# Bytesac motion studio

Launch films rendered from code with [Remotion](https://www.remotion.dev) (React → frames → H.264). Every frame is a
pure function of time, so renders are identical every run and an edit is a re-render. This folder is a standalone npm
package, **not** part of the pnpm workspace.

Remotion licence: free for individuals and companies of up to 3 people; larger companies need a company licence.

## Films

| Composition | File | Length | Brief |
|---|---|---|---|
| `Brand` / `BrandVertical` | `src/brand/BrandFilm.tsx` | 29.8 s, 1920×1080 / 1080×1920 | `docs/shotlist-01-brand.md` (no reference) |
| `Waitlist` | `src/waitlist/WaitlistFilm.tsx` | 43.8 s, 1920×1080 | `docs/shotlist-02-waitlist.md`, grammar from ref1 (`docs/style-guide-ref1.md`) |

## Commands

```bash
npm install                                   # once (esbuild's install script is approved in package.json)
npm run studio                                # live timeline preview
node tools/stills.mjs Waitlist out/review/x every:1      # contact sheet, one frame per second
npx remotion render src/index.ts Brand out/bytesac-brand-16x9.mp4 --codec=h264 --crf=16
```

Renders use Playwright's headless Chromium (`tools/stills.mjs` exports the path) to avoid a second browser download;
pass `--browser-executable=<that path>` to `remotion render`.

## Pipeline

1. **Reference** → frames with ffmpeg (1, 4 and 15 fps contact sheets) and audio analysis (`tools/onsets.mjs`,
   spectrogram, loudness) → `docs/style-guide-*.md` → shot list → approval.
2. **Music**: Lyria via the Gemini API (`tools/gemini.mjs <model> <out> "<prompt>"`, key in `.env`).
   `lyria-3-clip-preview` gives ~30 s, `lyria-3-pro-preview` / `lyria-3.5` give full pieces to cut from.
   Beat grid: `tools/beats.py` (librosa) and `tools/bargrid.mjs` (downbeat phase on a fixed bar grid).
3. **Real UI**: `tools/capture-cards.mjs` screenshots the web app on the mock API (investor persona) into
   `public/ui/`. Start the servers with the `.claude/launch.json` configs `film-mock-api` (4100) and `film-web` (3100);
   they run the main checkout's binaries with `node` directly (running pnpm there triggers a reinstall check).
   In Git Bash set `MSYS_NO_PATHCONV=1`, or routes like `/home` become Windows paths.
4. **Sound** (WAVs are git-ignored; run `node tools/brand-audio.mjs` and `node tools/waitlist-audio.mjs` before rendering a fresh clone): `tools/sfx.mjs` synthesizes ticks, whooshes, glass tinks, risers and thumps from a cue sheet;
   `tools/brand-audio.mjs` / `tools/waitlist-audio.mjs` place cues on the film's timeline and mix with the music to
   −14 LUFS, −1 dBTP (two-pass loudnorm) → `public/audio/*-mix.wav`.
5. **Critique loop**: render stills, score hook / readability / motion / variety / brand / sync, fix the three worst,
   repeat; then full render and 15 fps strips around transitions.

## Rules

- No `Math.random`, timers or CSS transitions: use `src/lib/motion.ts` (`ramp`, `spring`, `track`, seeded `rng`).
- Brand values come from `packages/design-tokens` (logo geometry is imported, not copied).
- Real UI only (captured or rebuilt 1:1 from fixtures); no invented stats; performance is never shown as a claim.
- `refs/`, `out/`, `tests/`, `.env` and generated audio are git-ignored.
