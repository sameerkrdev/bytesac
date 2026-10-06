// Investor film timing (docs/script-03-investor.md). Every shot starts on a bar of the measured Lyria track
// (assets/audio/investor-grid.json: 126.05 BPM, bar 1.904 s, first downbeat 0.26 s). Sections of the track:
// soft intro to bar 12, full beat from bar 12 (23.1 s), dropout 40.6–42.4 s, riser, groove from bar 26 (49.8 s),
// breaks at bars 33, 41 and 48, music ends 103.9 s.
import grid from "./grid.json";

/** Film time of bar n. */
export const bar = (n: number): number => grid.hits[n] ?? grid.hits[0]! + n * grid.bar;
export const BAR = grid.bar;
export const BEAT = grid.bar / 4;

export const INVESTOR_DURATION = 108;

/** Shot start times (s). A shot runs until the next one starts (plus its own exit overlap). */
export const S = {
  logo: 0,
  dashes: bar(3),
  job: bar(5),
  giant: bar(6),
  shortcut: bar(9),
  trust: bar(11),
  cards: bar(12),
  slot: bar(16),
  whatIf: bar(19),
  keys: bar(20),
  rings: bar(21),
  want: bar(24),
  intro: bar(26),
  managers: bar(28),
  tour: bar(30),
  chains: bar(33),
  legs: bar(35),
  donut: bar(37),
  plan: bar(39),
  notAll: bar(41),
  rebalance: bar(42),
  drift: bar(44),
  repair: bar(45),
  notify: bar(46),
  orbit: bar(48),
  funny: bar(50),
  cta: bar(52) + grid.bar / 2,
  outro: bar(54),
  end: INVESTOR_DURATION,
} as const;

export type ShotKey = keyof typeof S;
const ORDER = Object.keys(S) as ShotKey[];

/** End of a shot = start of the next. */
export function shotEnd(k: ShotKey): number {
  const i = ORDER.indexOf(k);
  return S[ORDER[i + 1] ?? "end"];
}
