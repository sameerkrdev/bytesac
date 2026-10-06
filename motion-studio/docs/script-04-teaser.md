# Video 4 — Cinematic teaser (ref4 grammar + Runway footage) · SCRIPT v1

- **Format:** 1920×1080, 60 fps, ~42 s. Runway clips are 1280×720 (Gen-4 Turbo, 16:9), upscaled and graded in the film.
- **Idea:** *Markets never sleep. You should.* The cost of doing it all yourself, then a calmer way: experts build the
  strategy, your assets stay in your wallet.
- **Look:** ref4's dark plates with white light (floor light, horizon arc), in Bytesac night navy and cool sky blue.
  Footage is graded to the same palette (navy shadows, cool highlights, light grain) so AI shots and code shots match.
- **Footage rules:** no readable text, no logos, no UI and no screens with content in any AI shot (AI garbles them; real
  UI is never invented). People seen from behind or in soft focus. Every glass object stays in the brand family
  (frosted glass, ice white, sky blue, navy).
- **Claims:** same checked wording as the investor film (`script-03-investor.md`): experienced managers verified by
  Bytesac, 7 chains, your assets stay in your wallet, you sign every step. No returns, no "safe".

| # | Time | Picture | Source | On-screen copy |
|---|---|---|---|---|
| 1 | 0–4 | Night apartment, a person scrolling a glowing phone, red/green city light streaks on the window | **Runway A1** | Markets never sleep. |
| 2 | 4–7.5 | Macro: glowing threads of light tangling between floating glass spheres, restless | **Runway A2** | …so neither do you. |
| 3 | 7.5–10.5 | White interlude, giant scrolling words (ref4) | code | Every chain. Every bridge. Every night. |
| 4 | 10.5–14.5 | The phone is turned face-down on a table; the room's light softens to calm blue | **Runway A3** | What if you could just… stop? |
| 5 | 14.5–17 | Black, typewriter with cursor | code | There's a calmer way. |
| 6 | 17–21.5 | Dawn breaks over a planet's edge, a thin arc of cool light rising | **Runway B4** | Introducing **Bytesac** |
| 7 | 21.5–25.5 | Two frosted-glass slabs (blue over navy) drift together and lock — match cut to the flat logo | **Runway B1** → code logo | Experts build the strategy. |
| 8 | 25.5–29.5 | A central glass sphere with light threads reaching six smaller spheres, slow orbit | **Runway B2** | One basket. Seven chains. |
| 9 | 29.5–33.5 | A frosted glass wallet on a dark pedestal, a band of light passing over it | **Runway B3** | Your assets stay in your wallet. You sign every step. |
| 10 | 33.5–37.5 | A person on a balcony at sunrise, from behind, coffee in hand, phone in pocket | **Runway B5** | Invest calmly. |
| 11 | 37.5–42 | Logo with floor light, URL type-on (ref4 bookend) | code | Invest in strategies, not individual trades. → **Bytesac** · bytesac.com |

## Sound

Lyria: calm-exciting, ~120 BPM, a soft night-time pulse for shots 1–4, a near-silent breath on shot 5, a warm lift on
"Introducing" (shot 6), confident and hopeful to the end. Code SFX: soft whooshes on cuts, a glass tink on the slab lock,
typewriter ticks, a resolving thump on the logo. −14 LUFS.

## As built (v1, 2026-10-06)

- No AI video: both Runway accounts (the API key and the connected developer project) have 0 credits, and the user's
  app plan doesn't include video generation. The user chose the free route: the eight Gemini start frames
  (`runway-kit/frames/`, made with the real logo and the repo's glass objects as references) are turned into "living
  stills" in code (`src/teaser/living.tsx`): window lights twinkling, phone glow, light pulses racing along the threads,
  dust in lamp light, a light running along the dawn arc, the top glass slab cut out and lowered onto the bottom one,
  spheres lighting in sequence, light sweeps across the glass, the sun flaring with drifting haze, plus a handheld
  camera on every shot.
- Runway clips can still be dropped in later: put them in `runway-kit/clips/` and run `node tools/teaser-clips.mjs`;
  any shot with a clip uses the footage instead of the living still.
- Track: `lyria-3-pro-preview`, 123.05 BPM; bars anchored on the drop at 15.72 s (bar = 1.9504 s). Film ends at bar 25.5
  (49.86 s) with the music faded. Mix −13.7 LUFS. Frozen time 6% (ref4: 7%).
