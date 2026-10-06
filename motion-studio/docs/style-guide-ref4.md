# Style guide — ref4 (grammar only)

Source: `refs/ref4.mp4`, 1336×734, 60 fps, 92.3 s, AAC stereo. Studied at 2 fps (overview) and 20 fps
(`refs/ref4/f20-*.png`, 96 frames = 4.8 s per sheet), plus spectrum, beat and per-frame motion analysis
(`tools/motion.mjs refs/ref4/motion.txt 0.12 20`). We take its grammar — structure, pacing, transitions, type
behaviour, sound shape. Never its brand, copy, UI, data or people.

## Structure (problem → tease → reveal → feature tour → social proof → CTA → logo bookend)

| Time (s) | Beat | Motion |
|---|---|---|
| 0–4.5 | Logo on black | A thin particle line crosses near the bottom; the arrow mark appears, the name types on per character; a **floor light** (soft white glow under the logo, like a stage light) grows below it. |
| 4.5–8.3 | Question over a texture | A small sentence centred over a **field of tiny dashes**; the dashes rotate in a wave and become vertical bars forming a rising chart; an arrow travels up the chart. |
| 8.3–9.5 | Second half of the sentence | "…" line with a small arrow glyph that drifts. |
| 9.5–14.4 | **Hard cut to white**, giant type | Two words fill the frame and **scroll right-to-left** (camera pan across huge type), a big outlined arrow sweeps diagonally. |
| 14.4–16.5 | Black, typewriter | Small text types with a blinking bar cursor. |
| 16.5–21 | White panel wipes up | A stacked list repeats one phrase; then **dark glass cards in a horizontal carousel** (one highlighted card is larger, with an arrow badge), the camera tracks right. |
| 21–26 | **Word slot machine** on white | One phrase sharp in the centre, faded phrases above and below; the list steps every ~0.9 s. |
| 26–29 | Dark UI on a **3D curved carousel** | Several dashboards on a cylinder, rotating slowly. |
| 29–35 | Word-by-word build, fade white → black | "Prove / your / skills" → "To" → big "Unlock" → a **thin circle ring** with one word inside. |
| 35–40 | **Concentric rounded rings** on white | A black pill grows in the centre; its label swaps, a number **counts up**, the label swaps again. |
| 40–43 | Pill grows to full-bleed black | "Want to know how?" Music **drops out**. |
| 43–45 | **Horizon arc** of light | "Introducing ↗ Platform" over a planet-edge glow; music **drops back in**. |
| 45–56 | Product UI on 3D tilts | Dark cards tilt in perspective; a hand-off from card to full dashboard; a caption word types beside it. |
| 56–60 | Sidebar tour | The UI stays, a label on the left names each feature as the matching icon lights (Live Data → Leaderboard → Verified Investments). |
| 60–73 | "All combined with" + feature cards | A swoosh line; stacked calendar cards fly in and tilt; a **donut** with leader lines and labels; a glass card turns into an analytics chart; a grid of small charts. |
| 73–75 | **Light wedge** sweeps (rotating cone of light) | "And that's not all". |
| 75–79 | Table UI | Rows highlight one by one. |
| 79–82 | **Orbit** | A ring with a phrase inside, avatars orbiting on outer rings. |
| 82–84 | Floating testimonial cards | Small cards around a centre line. |
| 84–88 | CTA | "Access the Platform" → "Join us" repeated in a fading grid (echo). |
| 88–92 | URL type-on, then logo + floor light | Bookend mirrors 0–4.5 s. |

## Look

- **Monochrome dark** (near black `#050505`–`#1A1A1A`) with **white light** as the only accent; light sources are
  diegetic: floor glow, horizon arc, light wedge, rim light on glass cards.
- Brief **white interludes** (giant type, word slot machine, concentric rings) punctuate the dark — about 1 in 4 beats.
- One geometric sans, mostly small (≈ 2–3% of frame height) for captions; occasionally huge (≈ 25%) for impact words.
- UI is shown dark, in perspective, with soft depth of field; never flat and static.

## Motion rules

- Per-character and per-word type-on with a soft blur; captions change every 1–2 s.
- Camera is always moving: pans across huge type, slow pushes on UI, carousel rotation.
- Transitions: hard cut on the beat (white ↔ black), wipe-up panels, pill growing to full-bleed, light wedge.
- Measured: mean motion 4.6, **frozen time 7%** (only the music drop and the end card hold still).

## Sound

- −14.4 LUFS, LRA 4.1 LU, ~140 BPM electronic with a constant sub; **dropout at 40–43 s** before the reveal,
  **drop at 43 s** on "Introducing", fade out from 85 s, short sting on the logo.
- Bytesac version: same shape, but **calm-exciting** (user brief): warm pads and soft pulses for the problem act,
  a hopeful lift into the reveal, a confident groove (not aggressive) for the feature tour.

## Bytesac translation

| ref4 | Bytesac |
|---|---|
| Black + white light | Night navy `#070D18` + sky/accent light (`#8AA6FF`, white); dark theme tokens |
| Arrow mark | The two-slab Bytesac mark |
| Floor light under the logo | Blue-white floor light (bookend, start and end) |
| Dash field → rising chart | Dash field → jagged chart (the problem: chaos) |
| Giant scrolling words | The problem in giant words |
| Glass card carousel | The alternatives today, each card with its cons |
| Word slot machine | The pain points |
| "Want to know how?" → horizon arc | Same beat, accent-blue horizon, "Introducing Bytesac" |
| Product UI tour on tilts | Real Bytesac UI (dark theme, mock API fixtures) |
| Donut | A real basket's target allocation |
| Orbit of traders | The user's wallet in the centre, their assets orbiting |
| Testimonial cards | The self-custody "what if" cards (the funny part) |
