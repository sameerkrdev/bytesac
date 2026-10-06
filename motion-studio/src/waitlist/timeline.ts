// Waitlist film timing. ref1's events are re-anchored to our own measured bar hits: an event that happened
// x seconds after ref1's hit n happens x seconds after our hit n. That keeps ref1's pacing on our beat.
import grid from "./grid.json";

/** ref1 bar hits (s), measured from its soundtrack (docs/style-guide-ref1.md). */
const REF = [0.209, 1.95, 3.692, 5.422, 7.163, 8.905, 10.646, 12.388, 14.118, 15.859, 17.601, 19.342, 21.072, 22.814,
  24.555, 26.297, 28.038, 29.78, 31.509, 33.25, 34.99, 36.73, 38.47, 40.2];
const OURS = grid.hits;

export const WAITLIST_DURATION = 43.8;

/** Film time for a moment of ref1. */
export function rt(refT: number): number {
  let n = 0;
  for (let i = 0; i < REF.length; i++) if (REF[i]! <= refT) n = i;
  return OURS[n]! + (refT - REF[n]!);
}

/** Every timed event of the film, in film seconds (shot numbers follow docs/shotlist-02-waitlist.md). */
export const W = {
  // 1–3 hero cluster, focus pull, pill → full-bleed navy
  pullStart: rt(0.7), pullEnd: rt(2.0),
  pillFill: rt(2.27), pillExpand: rt(2.47), dark: rt(2.73),
  // 4–5 dark logo, slab merge, wipe through the wordmark, hard cut
  merge: rt(3.47), wipe: rt(3.9), cut: rt(4.4),
  // 6–8 headline, phone, statement two
  type1: rt(4.45), type2: rt(5.42), shrink: rt(5.8), aside: rt(6.67), phoneUp: rt(6.73), count: rt(7.16),
  textOut: rt(9.6), phoneCentre: rt(10.0), phoneAway: rt(10.6), s2: rt(11.07), s2b: rt(12.0), s2Up: rt(12.67),
  // 9 isometric basket
  // (explodes a bar earlier than ref1, so the asset chips can be read)
  stackUp: rt(13.0), beam: rt(13.4), explode: rt(14.12), travel: rt(16.0),
  // 10 outline → fill
  draw: rt(16.6), nest: rt(17.6), drawBottom: rt(18.2), fill: rt(19.34),
  // 11 exit, wait, collide
  // (the small slab appears as the big mark leaves, so there is no empty frame)
  exit: rt(20.0), grey: rt(20.62), fly: rt(22.6), collide: rt(22.81),
  // 12 wordmark, smear
  word: rt(24.0), stretch: rt(24.67), smear: rt(25.33),
  // 13 bars
  bar: rt(26.0), bars: rt(26.67),
  // 14 wipe
  wipe2: rt(29.0),
  // 15–17 ghost phone: holdings, review, wallet
  ghost: rt(30.3), holdOut: rt(32.4), review: rt(32.7), reviewOut: rt(34.0), wallet: rt(34.3), walletOut: rt(36.6),
  // 18–19 real phone, CTA
  real: rt(37.0), aside2: rt(38.47), cta: rt(38.6), ctaOut: rt(40.9), fly2: rt(41.05),
  // 20 hero reassembles (loop)
  rebuild: rt(41.35),
};
