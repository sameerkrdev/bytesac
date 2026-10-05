// Bytesac logo geometry and colours. The geometry comes from the design-tokens package (single source of truth).
import { brandMark, brandWordmark } from "../../../packages/design-tokens/src/brand";

export const color = {
  night: "#070D18",
  navy: "#0F1E3A",
  accent: "#3D63D9",
  accentDark: "#8AA6FF",
  ink: "#0F1E3A",
  inkMuted: "#56627A",
  canvas: "#F6F8FB",
  skyTop: "#78ADE2",
  skyMid: "#A9CBEC",
  skyLow: "#DCEAF7",
  duskTop: "#040A15",
  duskMid: "#0B1931",
  duskLow: "#1A2E52",
} as const;

const markBox = brandMark.viewBox.split(" ").map(Number) as [number, number, number, number];
/** Mark viewBox: x, y, width, height. */
export const MARK = { x: markBox[0], y: markBox[1], w: markBox[2], h: markBox[3] };
export const markTop = brandMark.paths[0];
export const markBottom = brandMark.paths[1];

/**
 * Rewrites an absolute M/L/C/Z path (as used by the logo) into a box of the given size, for CSS `clip-path: path()`,
 * which takes pixels in the element's own coordinates.
 */
export function fitPath(d: string, scale: number, dx = -MARK.x, dy = -MARK.y): string {
  let i = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (n) => {
    const v = Number(n);
    const out = i % 2 === 0 ? (v + dx) * scale : (v + dy) * scale;
    i++;
    return out.toFixed(2);
  });
}

const wmBox = brandWordmark.viewBox.split(" ").map(Number) as [number, number, number, number];
export const WORDMARK = { x: wmBox[0], y: wmBox[1], w: wmBox[2], h: wmBox[3] };

/** Letter x-ranges of the outlined "Bytesac" wordmark, so it can be typed on letter by letter. */
const LETTER_STARTS = [0, 660, 1240, 1620, 2160, 2680, 3240];

/** The wordmark split into its 7 letters (each letter keeps its counters, e.g. the holes in B, e and a). */
export const wordmarkLetters: string[] = (() => {
  const subpaths = brandWordmark.path.match(/M[^M]*/g) ?? [];
  const letters: string[] = LETTER_STARTS.map(() => "");
  for (const sp of subpaths) {
    const x = Number(sp.slice(1).match(/-?\d+(\.\d+)?/)![0]);
    let idx = 0;
    for (let i = 0; i < LETTER_STARTS.length; i++) if (x >= LETTER_STARTS[i]!) idx = i;
    letters[idx] += sp;
  }
  return letters;
})();
