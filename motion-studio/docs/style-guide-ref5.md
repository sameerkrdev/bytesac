# Style guide — ref5 (grammar only)

Source: "Zenflow | Promo Video" by Anyway Studio (Vimeo 1161257229), saved as `refs/ref5.mp4` (git-ignored), 1920×1080,
30 fps, 53.7 s, AAC. Studied at 15 fps (`refs/ref5/f15-*.png`, 60 frames = 4 s per sheet), plus spectrum, scene cuts and
per-frame motion (`tools/motion.mjs refs/ref5/motion.txt 0.12 15`). We take the grammar: structure, pacing, type
behaviour, transitions, UI-demo technique and sound shape. Never its brand, copy, archival photos, UI or colours.

## Structure: "why" montage → thesis in single words → the chaos → logo → product demo → logo

| Time (s) | Beat | Motion |
|---|---|---|
| 0–4 | **Stacking photo cards** on black | A tiny card grows from the centre (a historic image); the next card slides in from the left and overlaps it, slightly offset; each card holds about 1 s. A small caption tag sits in each card's top-left corner. |
| 4–5 | Thesis, word 1 | A huge bold word sits at the top, layered **in front of** the card stack (type over image); the second word fades in below. |
| 5–6.5 | Word sequence | One word per beat, alternating small (top-left) and huge (bleeding off the frame), each on black or over a photo. |
| 6.5–8.5 | **Letter-by-letter reveal over a photo** | A word types on at full-frame size over a black-and-white photo; letters then wobble slightly in place. |
| 8.5–10 | **Echo grid** | The last word repeats in a 6×10 grid of tiny copies, which then clear column by column to leave a three-word line in tiny type ("it requires a …"). |
| 10–14 | Huge final word over **swapping images** | The key word sits huge and still; the image behind it swaps every 0.3–0.5 s and small image tiles pop in at the corners (a rapid collage). |
| 14–16 | **Icon** | A glossy 4-point star scales up from a dot, tilts and settles; a small trailing sparkle follows it. |
| 16–22 | **Prompt field** | A rounded input with an animated gradient border; placeholder text, then the camera pushes in and requests are typed one after another (each replaces the last): 6 requests in about 5 s, with a blinking cursor. |
| 22–24 | Chaos | Blurry, skewed screen content scrolls past diagonally (out of focus). |
| 24–30 | **Hype headline collage** | Condensed and serif headline fragments in white and one hot accent colour pile up, each sliding in from a different edge; a giant word ("REVOLUTION") slides along the bottom. |
| 30–34 | **Single words on black** | Small centred words (about 2% of frame height), one every 0.6 s, then the last word jumps to huge. Silence-like pause. |
| 34–38 | **Logo build** | The brand mark's pieces fly in and spin together from out of focus, then the wordmark types on beside the mark. |
| 38–42 | Product: new task | The logo blurs away; a "New task" field types a request; an accent **glowing button** appears; a cursor clicks it (the button presses, then glows). |
| 42–46 | Product UI in **3D tilt** over a dark misty landscape | The app window flies in tilted, the camera pans across; a list of steps fills in one by one with an accent bar travelling down the left edge. |
| 46–50 | **Zoomed UI moments** | The camera pushes into one panel (long text answer), a cursor clicks a button with a glow; a review card writes itself. |
| 50–52 | Kanban | The board tilts; a cursor drags a card across columns and drops it; the target column glows. |
| 52–53 | Second task | The new-task field types a second request, then the UI again with a different tilt. |
| 53–58 | Logo end card | Mark builds again, the wordmark types, then a tagline types under it. Holds. |

## Look

- Near-black canvas `#0B0B0C` with **one hot accent** (orange) used only for: the logo, glowing buttons, progress bars,
  highlighted headline words. Everything else is white or grey.
- Type: a bold geometric sans for huge words (≈ 20–30% of frame height), the same family small for single words.
- UI: a dark app window with a soft glow, in perspective over a desaturated misty mountain plate.
- Cursor: a white hand pointer, always doing a real action (click, drag).

## Motion

- Cuts on the beat (sharp scene cuts at 4.8–9.1 s); after 16 s mostly continuous camera moves.
- Measured: mean motion 6.0, **frozen time 3%** (only the "never ships" pause).

## Sound

- −24.7 LUFS integrated (quiet master), LRA 3.9 LU. A sparse, punchy intro with stops (0–21 s) under the thesis words,
  then a constant driving groove from about 21 s to the end; the beat tracker reads about 165 BPM (82.7 half-time).

## Bytesac translation

| ref5 | Bytesac |
|---|---|
| Orange accent | Bytesac blue (`#8AA6FF` on dark, `#3D63D9` fills), white |
| Historic photo cards | Generated "history of investing" photos (no real people, no text, no logos) |
| Thesis words | "Wealth doesn't just happen. It requires a strategy." |
| AI prompt field | The DIY investor's to-do list typed and replaced (swap, bridge, rebalance, track, read) |
| Hype headlines | Generic crypto hype fragments (no real outlets, no real tokens) |
| "never ships" words | "Investing without a system never compounds." |
| Spinning logo pieces | The two Bytesac slabs spinning in |
| New task → Create & Run | Invest amount → **Get preview** (real invest wizard) |
| Steps with progress bar | The real investment legs, each "Signed by you" |
| Review / kanban drag | Review update → apply; drift → Rebalance to target |
| Tagline | "Invest in strategies, not individual trades." |
