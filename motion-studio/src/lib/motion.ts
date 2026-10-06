// Motion helpers. Everything is a pure function of time in seconds, so any frame renders on its own.
import { Easing } from "remotion";

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

/** Design-system ease.out: fast start, long calm settle, no overshoot (MOTION-STUDY.md). */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
/** Design-system ease.inOut for cross-fades. */
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 between `start` and `start + dur` seconds, eased. */
export const ramp = (t: number, start: number, dur: number, ease: (x: number) => number = easeOut) =>
  ease(clamp((t - start) / dur));

/** Linear map of t from [a, b] into [c, d], clamped. */
export const map = (t: number, a: number, b: number, c: number, d: number) => c + (d - c) * clamp((t - a) / (b - a));

export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/**
 * Closed-form damped spring, 0 → 1 (k stiffness, d damping). Pure function of time, so values that change
 * target several times are a sum of one spring per change (see `track`).
 */
export function spring(t: number, k = 170, d = 26): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k);
  const z = d / (2 * w0);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** keys: [[time, value], ...] sorted by time. Continuous motion through every retarget. */
export function track(t: number, keys: [number, number][], k = 170, d = 26): number {
  let v = keys[0]![1];
  for (let i = 1; i < keys.length; i++) v += (keys[i]![1] - keys[i - 1]![1]) * spring(t - keys[i]![0], k, d);
  return v;
}

/** Seeded PRNG (mulberry32). Never Math.random: renders must be identical every run. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
