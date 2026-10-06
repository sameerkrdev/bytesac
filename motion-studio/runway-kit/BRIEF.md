# Runway brief — Bytesac teaser (video 4)

Eight clips, one per start frame in `frames/`. Generate them in the Runway app, then save each MP4 into `clips/` with the
same name (`A1.mp4`, `A2.mp4`, …). I'll grade, retime and cut them into the film.

## Settings (every clip)

- Tool: **Image to Video**, model **Gen-4 Turbo**
- Start frame: the file named in the table (drag it from `frames/`)
- Ratio **16:9 (1280×720)**, duration **5 s**
- Leave the seed random, and don't change the camera presets (the prompt describes the camera move)

## Credit plan (650 available)

Gen-4 Turbo usually costs **5 credits per second, so 25 per 5 s clip**. The app shows the exact cost before you generate,
so check it once on the first clip.

| | Clips | Credits |
|---|---|---|
| First pass | 8 × 5 s | ~200 |
| Retakes, only for clips that fail the checks below | up to 6 | ~150 |
| **Stop here** | | **~350** (≈300 left in reserve) |

Generate **A1 first** and send it to me before doing the rest. If the look is right, do the other seven. Don't use Gen-4
(non-Turbo) or 10 s clips: they cost more than twice as much, and the film only uses 3–4 s of each shot.

## The clips

| Name | Start frame | Prompt (paste exactly) |
|---|---|---|
| **A1** | `frames/A1.jpg` | Slow push-in toward the person. They keep scrolling the phone with their thumb, the city lights behind the window flicker and drift softly out of focus. Subtle natural movement, calm handheld feel. |
| **A2** | `frames/A2.jpg` | The glowing threads of light slowly twist, tangle and pulse between the floating glass spheres, the spheres drift gently, the camera slowly rotates around the tangle. Restless but smooth motion. |
| **A3** | `frames/A3.jpg` | The hand lets go of the phone and slowly withdraws out of frame. The lamp light softens. The camera slowly pushes in toward the phone lying still on the table. Very calm. |
| **B4** | `frames/B4.jpg` | The thin arc of dawn light slowly brightens and spreads along the planet's horizon, the glow rising gently into the dark sky, the camera drifts slowly upward. Majestic, slow, smooth. |
| **B1** | `frames/B1.jpg` | The two glass slabs drift slowly toward each other and gently settle together, light refracting through the glass, the floor light below brightens slightly. Camera locked off, very slow motion. |
| **B2** | `frames/B2.jpg` | The glass network slowly rotates, thin threads of light travel along the glass rods from the central sphere out to the smaller spheres, the floor light pulses softly. Slow orbiting camera. |
| **B3** | `frames/B3.jpg` | A soft band of light slowly sweeps across the glass wallet from left to right, the glass glints, the camera slowly pushes in. Still, premium product-film feel. |
| **B5** | `frames/B5.jpg` | The person takes a slow sip of coffee and looks out at the sunrise, the morning haze glows brighter, birds far away. The camera drifts slowly forward over their shoulder. Peaceful. |

## Check each clip before keeping it (retake only if it fails)

- No text, letters, numbers or logos appear anywhere
- Hands, faces and the phone keep their shape (no melting or extra fingers)
- The glass objects keep their shape (B1 must stay two rounded slabs)
- The motion is slow and smooth, with no sudden jumps or cuts

If a clip fails, retake it once with the same prompt. If it fails twice, skip it and tell me: I'll animate the start frame
in code instead, so no credits are wasted.
