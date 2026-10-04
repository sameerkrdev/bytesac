# Motion study — reference videos → Bytesac

Source videos live outside the repo (`ui-ref/` in the main checkout, untracked). Frames were pulled with FFmpeg
(1 fps contact sheets, 3–6 fps on key moments). FFmpeg scene detection (`select='gt(scene,0.2)'`) found **no hard
cuts** in any video: every reference is one continuous scroll or one continuous intro, so all motion below is
either load choreography or scroll-linked.

We take the principle, never the artwork, copy, brand or layout.

| Video | Size | Length | What it is |
|---|---|---|---|
| primary | 1600×1200 @ 60 fps | 28.0 s | Full scroll of a pale-sky fintech landing page, then its hero intro replayed |
| secondary | 1440×1080 @ 60 fps | 4.4 s | One hero intro: page dissolves to sky, then nav, lede, device, card and headline arrive |
| tertiary | 1600×1200 @ 29.97 fps | 37.1 s | Full scroll of a warm-grey wealth platform with photographic natural objects |

## Primary (28 s scroll)

| Time | Scene | Motion observed | Principle |
|---|---|---|---|
| 0–2 s | Sky hero, hand + phone, glass chips | Static after load; page scrolls with a slight easing lag | Hero holds still; atmosphere is the hero, not motion |
| 2–6 s | Orb + 3-line centred statement | Lines reveal **one at a time** as they enter (~0.3 s apart): rise ~12 px, opacity 0→1, slight blur → sharp. Orb drifts upward slower than the text (parallax ~0.6×) | Statement text reveals line by line on scroll; one soft object moves at a different depth |
| 6–9 s | Phone card left, heading + 2×2 tiles right | Card fades up first, then heading, then paragraph, then tiles stagger in (~80 ms apart) | Focal object first, then words, then supporting detail |
| 9–13 s | 2×2 bento of UI cards | Section heading is mid-reveal (half-rendered, blurred) while the grid is already visible: heading reveal is masked, bottom-up | Headings use a masked rise (clip, translate 100%→0) |
| 13–15 s | Accordion list + phone | Active row's divider fills like a progress line; phone card is still | Progress line communicates "active step" |
| 15–19 s | Pricing, testimonials | Middle card already elevated; quote row bleeds off the edges | Elevation, not motion, marks the recommended option |
| 19–22 s | Closing sky CTA, hand + phone | Phone rises from below the fold as the section scrolls in; chips appear after the phone | Bookend mirrors the hero |
| 22–24 s | Footer, giant cropped wordmark | Wordmark slides up under the footer content | Brand sign-off as a typographic object |
| 24–28 s | Hero intro replay (6 fps) | ① white → sky cross-fade ~0.5 s ② headline line 1 masked-rise, line 2 ~0.3 s later ③ phone + hand rise from below the viewport, ~0.9 s, strong ease-out (no overshoot) ④ glass chips fade + scale 0.96→1 last, staggered ⑤ lede and CTA top-right fade last | **Load choreography: atmosphere → words → object → data chips** |

## Secondary (4.4 s intro)

| Time | Motion observed |
|---|---|
| 0–1.0 s | Previous page dissolves to a blank, brightening sky (cross-fade, ~0.8 s) |
| 1.0–2.0 s | Sky saturates slightly; nav fades in (logo, links, then CTA) |
| 2.0–2.5 s | Short lede fades in at the right |
| 2.5–3.6 s | Phone + hand rise from below **while going from ghosted (≈30% opacity, blurred) to solid**; a dark floating card slides in from the left behind it |
| 3.6–4.4 s | Headline arrives last, then the two CTAs |

Principle: depth arrives by focus — objects sharpen as they settle. Order is context → device → message → action.

## Tertiary (37 s scroll)

| Time | Scene | Motion observed | Principle |
|---|---|---|---|
| 0–5 s | Product dashboard sitting between photographic rocks | Dashboard numbers tick (counter) and a chart bar highlights; rocks stay fixed while the UI scrolls behind them (foreground occlusion parallax) | Real product UI framed by physical objects in front of it |
| 5–10 s | Two-tone heading ("light grey line / dark line"), 3 numbered columns, image cards | Heading words blur-in left to right; columns fade; image cards fade from blurred colour fields to sharp | Blur → sharp word reveal; numbered `[1] [2] [3]` mono labels |
| 10–16 s | Floating glass card on a natural branch, chips orbiting | Pinned scene: the card stays centred while chips appear around it and the object rotates slightly with scroll | Pinned "object + chips" storytelling |
| 16–21 s | Node network diagram | Lines draw between nodes, centre node pulses once; labels fade after their line | Network drawn by stroke-dashoffset, labels follow |
| 21–25 s | "Connected" centre pill with an arc of integration icons | Icons fan out along an arc from the centre pill | Ecosystem shown as an orbit around one core |
| 25–29 s | Comparison table floating over a landscape | Highlighted column (the product) is lifted and lighter than the others | One column elevated to show the recommended path |
| 29–33 s | Closing statement, two-tone, with small image pills inline in the headline | Inline image pills scale in after the words | Imagery as punctuation inside typography |
| 33–37 s | "Live activity" ticker row, contact footer over rocks | Row items fade in sequentially like an event feed | Activity as a calm, sequential feed |

## Round 2: 15 fps re-study of the primary reference (2026-10-04)

Frames were extracted at 15 fps (`ffmpeg -vf fps=15`) and tiled into contact sheets to read the scroll mechanics
frame by frame rather than at 2 fps.

- **Hero holds still; the sky moves.** Headline, device and chips are static while the cloud layer drifts sideways
  very slowly (a few pixels per second). Depth comes from layers moving at different speeds, not from scroll.
- **Page swap.** From about 1.6 s the next section, an opaque surface with rounded top corners and a soft upper
  shadow, slides up from the bottom *over* the pinned hero. The hero recedes slightly (rises a little, shrinks, dims)
  as it is covered. Every chapter change repeats this move.
- **Mid sections scroll normally** with the usual reveals; only chapter boundaries swap.
- **Closing bookend.** The sky fades back in behind the headline, lines resolve from blur one at a time, and the
  hand-held phone rises into frame as the section arrives.

Implemented as `SwapStack`/`SwapPanel` (`components/motion/page-swap.tsx`): each chapter pins once its *end* meets
the viewport's end (so tall chapters are read in full first), the next slides over it, and the covered one scales to
0.94, rises 4% and dims to 40%. The sky is a CSS gradient with mirror-tiled transparent cloud strips drifting at
190 s, 300 s and 420 s per loop (`bx-drift`). Frame-by-frame QA: `e2e/scroll-frames.mjs` and `e2e/time-frames.mjs`.

**Glass assembly (round 2).** The allocation ring and the layer stack are real-time three.js scenes that assemble one
piece after another, outer frame first: each piece flies in from in front of the object, scales up and lands on the
layer before it (1.1 s each, 160 ms apart, ease-out quart), then the object idles with a slow drift and a little
pointer tilt.

## Extracted principles → Bytesac

| # | Principle | Bytesac use |
|---|---|---|
| 1 | Load order: atmosphere → words → object → data chips → action | Homepage hero: sky/mist fades in, "Invest in strategies, not individual trades." masked-rises line by line, the empty phone rises from below, then glass chips (a basket's target allocation, "You sign every transaction", a chain row) settle in, then CTAs |
| 2 | Objects sharpen as they settle (blur → sharp, 0.96 → 1) | All floating chips and the hero device; the allocation ring on basket pages |
| 3 | Line-by-line statement reveal on scroll | The "strategies, not trades" statement and the self-custody statement ("Your assets. Your wallet. Your authorization. Your decision.") — one line per beat |
| 4 | Focal object first, then words, then detail (80 ms stagger) | Every feature section; basket research sections |
| 5 | Pinned object + orbiting chips | Self-custody section: a pinned wallet object; as you scroll, steps appear around it — *Your wallet → Review the plan → You sign → On-chain execution → Reconciled* |
| 6 | Network drawn by stroke | Multi-chain section: Solana hub (USDC settlement) with lines drawing to Ethereum, Base, BNB Chain, Arbitrum, Bitcoin; labels follow the line |
| 7 | One column elevated | Rebalance demo: the "New version" column is lifted; Skip and Participate are equal-weight choices (no dark pattern) |
| 8 | Progress line on the active row | Investment flow stepper and the operation/leg stepper |
| 9 | Counter tick on numbers | Only on figures that are real at render time (basket minimums, weights). Never on invented stats |
| 10 | Typographic sign-off | Footer: oversized cropped "bytesac" wordmark rising under the footer |
| 11 | Inline image pills in headlines | Sparingly on the homepage closing CTA (small glass object pill inside the line) |

## Timing and easing tokens (derived)

| Token | Value | Used for |
|---|---|---|
| `ease.out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Rises, reveals, device entrances — fast start, long calm settle, no overshoot |
| `ease.inOut` | `cubic-bezier(0.65, 0, 0.35, 1)` | Cross-fades, theme and page transitions |
| `duration.fast` | 160 ms | Hover, press, focus |
| `duration.base` | 320 ms | Dialogs, sheets, tabs, chips |
| `duration.slow` | 700 ms | Section reveals, line reveals |
| `duration.hero` | 1100 ms | Device rise in the hero |
| `stagger.line` | 120 ms | Headline lines |
| `stagger.item` | 80 ms | Grid/list items |
| `distance.rise` | 16 px (text), 64 px (devices) | Reveal travel |
| `blur.in` | 8 px → 0 | Blur → sharp settle |

## Rules

- Motion explains a state change or guides attention. The only endless loops are a pending-transaction indicator and
  ambient atmosphere (drifting clouds, the idle glass objects): very slow, decorative, paused off screen and stopped
  under reduced motion.
- `prefers-reduced-motion: reduce` → no transforms, no blur, no parallax, no smooth scroll; content renders in its final state.
- Smooth scrolling (Lenis) only on marketing routes, never in the app or in forms.
- WebGL scenes are progressive enhancement: lazy-loaded, with a static image fallback, and skipped when WebGL is unavailable or reduced motion is set.
- No scroll-jacking: the page swap uses CSS `position: sticky` only (no wheel interception); a pinned chapter is
  covered within one viewport of scrolling and never traps the keyboard or screen reader.
