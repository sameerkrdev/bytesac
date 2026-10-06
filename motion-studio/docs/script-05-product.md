# Video 5 — Product film (ref5 grammar) · SCRIPT v1

- **Format:** 1920×1080, 60 fps, ~55 s. Bytesac theme, blue accent (see open question on light vs dark).
- **Story (ref5's shape):** a "why" montage (the history of investing) → the thesis in single words → the chaos of
  doing it yourself → logo → a real product demo (invest, sign each step, review an update, fix drift) → logo + tagline.
- **Imagery:** the montage photos are generated (Gemini), styled as archival photos of investing through history. No real
  people, no readable text, no logos. All UI is real Bytesac UI from the mock API, captured in the chosen theme.
- **Claims:** same checked wording as `script-03-investor.md`. No returns, no "safe", USDC-only funding, the user signs
  every step.

| # | Time | ref5 beat | Picture | On-screen copy |
|---|---|---|---|---|
| 1 | 0–4 | Stacking photo cards | Five generated "history of investing" cards stack from the centre: a 1900s trading floor, a ticker-tape machine, a handwritten ledger, 1980s trading screens (no text), a phone in a hand | Small tags: *1900 · 1920 · 1950 · 1990 · today* |
| 2 | 4–6.5 | Thesis words | Huge type over the stack, one word per beat | **Wealth** · isn't · **built** |
| 3 | 6.5–8.5 | Letter reveal over a photo | "overnight" types on, full frame | **overnight** |
| 4 | 8.5–10 | Echo grid → tiny line | 60 tiny "overnight"s clear to a line | it takes a… |
| 5 | 10–14 | Huge word, swapping images | "strategy" huge and still; images swap behind it (charts in history, a ledger, a coin, a globe of networks) | **strategy** |
| 6 | 14–16 | Icon | The Bytesac glass slab icon scales up from a dot and tilts, with a small blue sparkle trailing | — |
| 7 | 16–22 | Prompt field, requests typed and replaced | A rounded field with a blue gradient border: "What do you need to do today?" | Swap USDC to SOL · Bridge ETH to Base · Rebalance my portfolio · Check 6 wallets · Read 40 threads · Find the next big thing |
| 8 | 22–24 | Blurry chaos | Tilted, out-of-focus chart and exchange-like screens (generated, no text) | — |
| 9 | 24–30 | Hype headline collage | Generic hype fragments sliding in from every edge, one word in blue, a giant word along the bottom | *Next 100x token* · *Don't miss out* · *Top 10 coins this week* · *Last chance* · **HYPE** |
| 10 | 30–34 | Single words on black | One small word per beat, the last one huge | hype · is · not · a · **plan.** |
| 11 | 34–38 | Logo build | The two Bytesac slabs spin in from out of focus and lock; the wordmark types on | **Bytesac** |
| 12 | 38–42 | New task → glowing button | The real invest field types **500** USDC in *Core Crypto Index*; a cursor presses **Get preview** (blue glow) | — |
| 13 | 42–46 | UI in 3D tilt over a misty landscape | The real invest preview tilts in; the investment steps fill in one by one with a blue bar travelling down: fees · swap USDC→SOL · cross-chain USDC→BTC · USDC→ETH on Base · … each turning **Signed by you** | Every step, signed by you. |
| 14 | 46–50 | Zoom on UI | Camera pushes into the real **Review update** (the manager's reason); the cursor clicks **Create plan** | Managers publish. You decide. |
| 15 | 50–52 | Drag / action | The real portfolio: a *Drifted* card; the cursor clicks **Rebalance to target**; the card's state glows to *Aligned* | Drift? One click to realign. |
| 16 | 52–55 | Logo end card | Slabs build again, the wordmark types, the tagline types underneath | **Bytesac** · Invest in strategies, not individual trades. |

## Sound

Lyria: sparse, punchy intro with stops under the thesis words (0–21 s), then a constant, confident driving groove to
the end (about 85 BPM half-time, 170 felt), modern and clean. Code SFX: card whooshes, typing ticks, button clicks, the
logo lock. Master −14 LUFS (ref5 is −24.7; ours follows the house loudness).

## Open questions

1. Theme: **dark** (Bytesac night theme, matches ref5's mood) or **light** (Bytesac's default canvas)?
2. Approve the copy above (thesis line, the DIY to-do list, hype fragments, the closing line)?

## Decisions (2026-10-06)

- Theme: **dark** (user). Copy approved (user), then revised by Claude so it no longer mirrors ref5's own lines: the
  thesis is now "Wealth isn't built overnight. It takes a strategy." and the turn is "Hype is not a plan."
- Shot 15 says "Drifted? Rebalance to target, or keep it custom." and the badge reads "Rebalance plan ready to review":
  "Rebalance to target" creates a plan the user still reviews and signs, so "one click to realign" would overstate it.

## As built (v2, 2026-10-06)

- **Opening rebuilt from ref5 0–9 s:** ten fintech-history cards (1900 trading floors → 1920 ticker tape → 1950 charge
  cards → 1967 cash machines → 1971 electronic exchanges → 1995 online banking → 2007 mobile banking → 2009 Bitcoin →
  2020 DeFi → today, tokenized assets), each growing out of a small thumbnail at its own corner of the stack, faster
  and faster, with a year tag; images generated with Gemini and checked for readable text and third-party marks.
- **To-do list slowed:** five requests at about 1.5 s each, typed on the VO.
- **Voiceover:** Gemini TTS (`gemini-2.5-pro-preview-tts`, voice Iapetus, 1.1x), 12 lines in `public/vo/`, placed by
  `src/product/vo.json`; male, calm and confident, close-mic, voice forward with the music ducked (ref5's delivery,
  our own words). Film lengthened to 68 s; music extended on measured downbeats (drop 30.616 s, final hit 66.4 s).
- Mix −14.0 LUFS, frozen time 3% (ref5 3%).

### Known issue (open)

The current VO says "Byte-seek" and reads USDC as a word. A test with `gemini-3.8-flash-tts` and the spellings
"Byte sack" and "U, S, D, C" fixed both and sounded more human (8.5/10), but the Gemini prepaid credits ran out before
the 12 lines could be regenerated. Note: that model rejects a system instruction, so its direction must be a short
style prefix in the text (a long one gets read aloud). After a top-up: regenerate the lines, re-time `vo.json` and the
shot times to the new durations, rerun `node tools/product-audio.mjs`, re-render.
