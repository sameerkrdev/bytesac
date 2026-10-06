# Video 2 — Waitlist film (after ref1)

- **Format:** 1920×1080, 60 fps, 43.8 s, loops (last frame = first frame). 9:16 cut-down later from
  the same timeline, re-laid out rather than cropped.
- **Grid:** 24 hits, one every 1.741 s (or the measured downbeats of our own track — see Sound).
  Every shot change below lands on a hit (H#).
- **Structure:** ref1 shot for shot (see `style-guide-ref1.md`). Content is Bytesac's own.
- **Data:** example data only, from the mock fixtures (`apps/web/e2e/mock-api`): *Core Crypto Index*
  by the fictional *Meridian*, weights BTC 35 / ETH 30 / SOL 20 / LINK 8 / BNB 7, v3 rebalance BTC 30→35,
  ETH 35→30. Any performance line carries a "Simulated" label. No returns, yields or "x faster" claims.

| # | Time | Hit | ref1 move | Bytesac shot | On-screen copy |
|---|---|---|---|---|---|
| 1 | 0.0–0.7 | — | Hero cluster holds | Bytesac hero cluster on the canvas with a sky bloom: logo pill top; centre *Portfolio* card (USDC value); left *Baskets* list (3 rows); right *Core Crypto Index* card with allocation ring; bottom asset row (BTC, ETH, SOL logos) | (UI only) |
| 2 | 0.7–2.3 | H1 | Focus pull to pill | Everything blurs except the logo pill, which drifts to centre; 6% push-in | — |
| 3 | 2.3–2.7 | — | Pill fills dark, expands to full-bleed | Pill fills navy `#0F1E3A`, grows past the edges | — |
| 4 | 2.7–3.7 | H2 | Dark moment | Night navy `#070D18`, blue dusk glow low; white Bytesac logo | — |
| 5 | 3.7–4.4 | H3 | Mark morphs, wipes the wordmark | The two slabs slide apart; the blue slab sweeps right through "Bytesac", erasing it. Hard cut to white at 4.40 | — |
| 6 | 4.4–6.6 | H4 | Per-character blur type-on, zoom-out | Line 1 per character, lines 2–3 per word on H4; block settles from 1.6× to 1× | **Invest in strategies, / not individual / trades.** |
| 7 | 6.7–10.6 | H5–H6 | Text left, phone rises, count-up | Phone (real Bytesac Home screen, investor persona) rises bottom-right; portfolio value counts up to the fixture value | (headline stays) |
| 8 | 10.6–12.6 | H7 | Device dissolves into next statement | Phone centres, blurs, shrinks into the text | **Baskets built by verified managers, / rebalanced only when you approve.** |
| 9 | 13.0–16.6 | H8–H9 | Isometric stack + beam, explode | Isometric frosted-glass basket: 5 layers (BTC, ETH, SOL, LINK, BNB) on a USDC base, blue light beam up the middle; on H9 the layers separate (exploded view) | (statement stays, then rises out) |
| 10 | 16.6–19.6 | H10–H11 | Line draws outline → nested outlines → fill | The beam becomes a blue stroke drawing the **outline of the Bytesac top slab**; pull back to 3 nested strokes; the bottom slab draws in below; on H11 both fill (blue top, navy bottom) | — |
| 11 | 20.0–23.6 | H12–H13 | Exit, wait, collide, morph | Slabs slide out right; canvas shifts to `surface-muted`; one small slab waits right; two pieces fly in, collide on H13 and settle into the Bytesac mark | — |
| 12 | 24.0–26.0 | H14 | Wordmark types, smear | "Bytesac" types in beside the mark (per character); the blue slab smears right, erasing the wordmark | — |
| 13 | 26.0–29.0 | H15–H16 | Smear → bar → bar chart | The smear becomes the first bar; pull back; 4 more bars grow: **BTC 35% · ETH 30% · SOL 20% · LINK 8% · BNB 7%**; labels fade in after each bar | Eyebrow: **EXAMPLE BASKET · TARGET WEIGHTS** |
| 14 | 29.0–30.2 | H17 | Diagonal gradient wipe | Sky-blue diagonal gradient wipe (sky1→accent→sky1) | — |
| 15 | 30.3–32.6 | H18 | Ghost card + count-up | Ghost card: *Verified holdings* figure counts up; one asset row with a "Verified on-chain" check | **Every holding, / verified on-chain.** |
| 16 | 32.6–34.3 | H19 | In-card UI swap | Same card now shows the **rebalance review**: *v3 → BTC 30→35%, ETH 35→30%*, two equal buttons **Skip** / **Participate** | **Review every change. / Nothing moves without you.** |
| 17 | 34.3–36.7 | H20 | Icon pops from a dot | Card empties to a dot that pops into a **wallet with a signature check**; a few hairline dots/lines around it | **Your wallet. / Your signature.** |
| 18 | 36.7–38.5 | H21 | Icon collapses, ghost phone tilts | Card collapses into a ghost phone that tilts and resolves into a real phone: *Core Crypto Index* basket screen; the simulated performance line draws (with its "Simulated" tag) | — |
| 19 | 38.5–40.4 | H22 | CTA beside device | Phone moves left; CTA blurs in right | **Join the waitlist** / *(URL — TBC)* |
| 20 | 40.4–43.8 | H23–H24 | Phone exits up, hero reassembles | Phone screen scrolls, phone flies up; hero cluster from shot 1 reassembles (pill, centre card, side cards, asset row) and holds = frame 0 | — |

## Sound

Two layers, both on the grid:

1. **Music bed** generated with Lyria in the ref1 profile: ~138 BPM half-time, constant
   sub-bass bed with side-chain pump on each bar, airy mid pad, crisp tick percussion, instrumental, ends
   with a 2 s tail. We **measure** its downbeats (librosa) and retime the hits to them, rather than
   assuming 1.741 s.
2. **SFX synthesized in code** on the transitions: soft impact + flam (+151 ms) on scene hits; whoosh on
   wipes and smears; small UI ticks on the count-ups and the type-on.

Mix: −14 LUFS integrated (ref1 sits at −18.9; we're louder, matching the course rule), true peak
≤ −1 dBTP.

## Assets

- Logo SVGs: `apps/web/public/brand/` (mark, wordmark, white versions).
- Real UI: captured with Playwright from the web app on the mock API (investor persona), cropped into
  cards; live numbers (count-ups) are drawn on top in Geist.
- Crypto logos: `apps/web/public/crypto` (CC0).
- Isometric glass basket layers: drawn in code (crisp, animatable); Runware only for the soft sky bloom
  textures if needed.

## Open (need your answer)

- Waitlist URL or handle for shot 19.
- "For investors" — see the question in chat.

## As built (v1, 2026-10-06)

- Track: `lyria-3-pro-preview` (59 s, 139.7 BPM half-time, bar 1.718 s), cut from 13.6 s so its music ends at
  ~41.9 s like ref1. Each ref1 event is re-anchored to our nearest bar hit (`src/waitlist/timeline.ts`).
- Real UI captured from the web app on the mock API (`public/ui/`); the phone's portfolio figure is a live count-up
  set over the capture with the measured type metrics. Phone screens use the web app's mobile layout (Expo web was
  still bundling during capture).
- Copy on screen: "Invest in strategies, not individual trades." · "Baskets built by verified managers, rebalanced only
  when you approve." · "Every holding, verified on-chain." · "Review every change. Nothing moves without you." ·
  "Your wallet. Your signature." · chip "You sign every transaction" · "EARLY ACCESS / Join the waitlist".
- The basket page's "+66.31% simulated" figure is deliberately kept out of frame.
- No URL on the end card yet (open).
- Mix −14.0 LUFS, −1.7 dBTP.
