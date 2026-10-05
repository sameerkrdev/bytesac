# Style guide — ref1 (grammar only)

Source: `refs/ref1.mp4`, 1920×1080, 60 fps, 43.8 s, AAC stereo. Studied at 1, 4 and 15 fps
(`refs/ref1/f15-*.png`, 60 frames = 4 s per sheet) plus waveform, spectrogram and onset analysis
(`tools/onsets.mjs`). We take the grammar — pacing, transitions, camera, type behaviour, sound
structure. Never its brand, copy, numbers, icons or UI.

## The one rule that makes it feel expensive

**Every scene change lands on a hit, and the hits are a fixed grid: one every 1.741 s**
(= one bar at ~137.9 BPM, felt as half-time). 24 hits in 41.8 s. Checked against the frames:

| Hit (s) | What changes on screen |
|---|---|
| 3.69 | logo mark starts morphing into the next shape |
| 5.42 | second line of the headline blurs in |
| 7.16 | phone rises, number starts counting |
| 10.65 | phone recentres, next statement begins |
| 15.86 | isometric object explodes into layers |
| 17.60 | outline shape closes |
| 19.34 | outlines fill solid |
| 21.07 | shapes leave, background changes |
| 22.81 | shapes collide and morph into the logo |
| 24.56 | wordmark types in |
| 26.30 | logo smear becomes a bar |
| 29.78 | gradient wipe |
| 34.99 | security icon pops |
| 36.73 | icon collapses, phone empties |
| 38.47 | ghost phone becomes a real phone |
| 40.20 | final phone exits, hero reassembles |

## Look

- **Canvas:** near-white `#F7F7F7`–`#FFFFFF` with one soft brand-tinted gradient bloom, usually from
  a corner, drifting slowly. Exactly one dark moment (full-screen black, ~1.7 s) early on.
- **One accent colour** does all the work: logo, outline strokes, filled shapes, bars, chips.
  Everything else is ink black/grey on white.
- **Type:** one geometric sans, semibold, tight tracking, ink colour; 2–3 short lines, centred or
  left of a device. Never more than ~8 words on screen.
- **UI:** real-looking white cards, hairline borders, very soft shadows; a phone with a black
  bezel; a "ghost" phone (white, 6% outline) used as a transitional container.
- **No** frames, corner labels, particles for decoration, glows on UI, or text over busy imagery.

## Motion vocabulary (in order of appearance)

1. **Depth-of-field focus pull** (0.7–2.0 s): the whole hero blurs out (~12 px) except one element
   (logo pill), which drifts to centre and grows slightly. Camera pushes in ~6%.
2. **Pill → fill → full-bleed** (2.27–2.73 s): the pill's fill goes white → grey → black over
   ~0.25 s, then the pill scales into a rounded rect and out past the frame edges in ~0.45 s.
3. **Logo morph + wipe** (3.47–4.33 s): the mark morphs into a simple geometric shape, which slides
   right *through* the wordmark, erasing it as a mask. Hard cut to white at 4.40 s.
4. **Per-character blur type-on** (4.4–5.2 s): letters arrive one per frame-ish (~60 ms),
   each from ~8 px blur + 0 opacity. Subsequent lines blur in as whole words (~120 ms stagger).
5. **Zoom-out settle** (5.8–6.2 s): the finished text block scales from ~1.6× to 1×.
6. **Push aside + device rise** (6.7–7.4 s): text slides left; phone rises from below the frame
   bottom-right with a long ease-out, no overshoot. The headline figure **counts up** (~1 s).
7. **Device-into-text dissolve** (10.6–12.6 s): device centres, blurs and shrinks while the next
   statement words blur in *over* it; device vanishes into the text.
8. **Isometric object + light beam** (13.0–16.6 s): an isometric stack rises from the bottom with
   a vertical accent beam; on a hit the layers separate vertically (exploded view); then
   everything travels up and leaves only the beam.
9. **Line → outline → nested outlines → solid** (16.6–19.6 s): the beam becomes a stroke that
   draws the outline of a shape; camera pulls back to reveal 2–3 nested strokes; copies draw in
   beside it; on a hit all outlines fill solid (pale → full accent in ~0.3 s).
10. **Exit + wait + collide + morph** (20.0–23.6 s): shapes slide off right; background shifts to
    light grey; one small piece waits; two pieces fly in, collide, and the blob morphs (with a
    slight rotation) into the logo mark.
11. **Wordmark type-on + second morph + smear** (24.0–26.0 s): wordmark types in beside the mark;
    the mark morphs again, then smears right with heavy motion blur, erasing the wordmark.
12. **Smear → bar → bar chart** (26.0–29.0 s): the smear becomes a horizontal bar growing from the
    left edge; camera pulls back; two more bars grow below it; labels fade in after their bar.
13. **Diagonal gradient wipe** (29.0–30.2 s): a saturated accent gradient sweeps diagonally across
    and clears to the next scene.
14. **Ghost card + count-up** (30.3–32.6 s): a ghost card fills with a figure counting up; the
    caption blurs in word by word below it.
15. **In-container swap** (32.6–37.8 s): the same ghost card/phone stays put while its contents
    swap: UI fades out piece by piece (a button collapses to a line), a hero icon pops from a dot,
    a few network dots/lines animate around it. Caption swaps word by word on each change.
16. **Ghost → real device** (37.8–38.6 s): the ghost phone tilts slightly in 3D and resolves into a
    real phone with a chart that draws itself.
17. **CTA beside device** (38.4–40.4 s): device moves left; "Try X today" blurs in to its right.
18. **Loop close** (40.4–43.8 s): phone scrolls its screen, then flies up out of frame; the opening
    hero cluster reassembles piece by piece (pill, main card, side cards) and holds. The last
    frame equals the first.

Exits mirror entrances: words leave by blurring out left to right; containers empty before they
move.

## Easing and timing

- Entrances: long ease-out, effectively `cubic-bezier(0.22, 1, 0.36, 1)` (matches the Bytesac token),
  0.4–0.9 s. **No overshoot anywhere** except the logo blob morph.
- Blur is the transition currency: 0 → 8–14 px on exits, 8 px → 0 on entrances.
- Holds: 1–3 hits per idea. Nothing new happens for more than ~2 hits.

## Sound (measured)

- Integrated −18.9 LUFS, LRA 1.8 LU (very compressed), stereo, music ends at 41.85 s, 2 s tail.
- Constant sub-bass bed (20–100 Hz) for the whole piece, ducking (side-chain pump) on every hit.
- Wideband impact on every hit (to 18 kHz), often doubled by a flam 0.151 s later.
- Mid-range pad/chord layer and short ticks between hits; no vocals.
- Autocorrelation peaks at ~92 BPM (the off-grid ticks); the structural grid is 1.741 s.

## Bytesac translation

| ref1 | Bytesac |
|---|---|
| Mint/green accent | Bytesac blue `#3D63D9` (accent), navy ink `#0F1E3A`, sky `sky1–3` blooms |
| Black full-screen moment | Night navy `#070D18` with a low blue dusk glow |
| Generic sans | Geist 300/500 (display at 300, −0.035em, per design system) |
| Green filled shapes | The two Bytesac slabs (blue top, navy bottom) |
| Green beam | Blue accent beam |
| Crypto wallet UI | Real Bytesac UI from the mock fixtures (baskets, allocation ring, rebalance review) |
| Yield comparison chart | Example basket target weights (no returns, no "x faster") |
| Lock-in-shield icon | Wallet + signature check (self-custody, user authorizes) |
