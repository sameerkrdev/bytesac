# Video 1 — Brand film (no reference)

- **Format:** 1920×1080 and 1080×1920 from one timeline (re-laid out, not cropped), 60 fps, 29.8 s (retimed to the generated track; see As built).
- **Idea in one line:** two pieces of glass find each other and become Bytesac. Calm, institutional,
  sky to dusk; the brand's own design-system character (atmosphere as bookends, one focal object at a
  time, nothing loud).
- **Grid:** a Lyria track at ~100 BPM, measured. One idea per bar; a new thing on screen every 2–3 s.
- **Banned:** centred title on a gradient as the whole idea, everything fading in, particles, glows,
  corner labels.

| # | Time | Shot | Motion | Copy |
|---|---|---|---|---|
| 1 | 0.0–2.0 | Hook: night navy `#070D18`. A single hairline of blue light draws across the frame, left to right | Stroke draw, slight light bloom at its head; a soft low hit when it completes | — |
| 2 | 2.0–4.5 | The line becomes a horizon: dusk sky blooms up from it (night → deep blue → pale sky), transparent cloud strips drift at three depths | Gradient grows from the line; parallax clouds | — |
| 3 | 4.5–7.5 | Two frosted-glass slabs (Runware renders, transparent) descend from above on different depths, out of focus, then sharpen as they settle | Blur → sharp, long ease-out; the second slab lands on the first on the downbeat, with a soft glass "tink" | — |
| 4 | 7.5–10.5 | Kinetic statement, Geist 300 at hero size, masked line rise (one line per beat) next to the glass object | Line by line, 120 ms stagger; the glass turns slowly (2.5D parallax between its layers) | **Invest in strategies,** / **not individual trades.** |
| 5 | 10.5–13.5 | Second statement replaces the first (old words blur out L→R, new ones rise) | Same grammar, quicker | **Built by managers.** / **Approved by you.** |
| 6 | 13.5–16.0 | The glass object flattens and its colours resolve into the flat Bytesac mark (blue top slab, navy bottom) | Cross-morph: glass refraction fades, edges sharpen, scale down into lockup position | — |
| 7 | 16.0–18.0 | Wordmark "Bytesac" types in beside the mark per character; full logo lockup | Per-character blur type-on | — |
| 8 | 18.0–20.0 | Lockup holds on pale sky; a mono eyebrow line underneath; final resolving hit | Eyebrow fades up; sky drift continues; clean end frame (poster) | **INVESTMENT BASKETS · SETTLED IN USDC ON SOLANA** |

## Assets

- Runware: 2 frosted-glass slab renders (blue-tinted top, ice/navy-core bottom), transparent PNG,
  1536 px; 2–3 transparent cloud strips (or reuse `apps/web/public/visuals/atmosphere` if they fit).
  The test render already in `tests/runware-0.png` shows the look works. Budget: ~6 images at ~$0.01.
- Logo SVGs and Geist fonts from the repo.

## Sound

Lyria: "calm, confident brand sting, ~100 BPM, felt piano, warm analog pulse, sub swell into a clean
resolving hit at 16 s, instrumental". Glass tink, line whoosh and sub-drop are synthesized in code.
Mix −14 LUFS.

## As built (v1, 2026-10-06)

- Track: `lyria-3-clip-preview`, 29.8 s, 99.4 BPM; near-silent until the music enters at 4.02 s, peak 21.5–23.5 s.
  Shots are placed on its measured bars (`src/brand/beats.json`): line 0.25–3.2 s (horizon charges until the drop),
  sky opens 3.8 s, slabs land 8.78 s, statements 11.18 s and 15.98 s, glass → flat mark 18.38 s, wordmark 20.78 s,
  eyebrow 23.17 s, hold to the end.
- Glass slabs are drawn in code (backdrop blur, tint, rim light, caustic edge), not Runware renders: the Runware
  account was out of credit, and code-drawn glass morphs exactly into the flat logo.
- Clouds reuse `apps/web/public/visuals/atmosphere` (no new generated art).
- Mix −13.9 LUFS, −1.0 dBTP.
