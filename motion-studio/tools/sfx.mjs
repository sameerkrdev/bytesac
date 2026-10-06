// node tools/sfx.mjs cues.json out.wav [duration]   cues: [{ "t": 0.5, "type": "tick", "gain": 1, "len": 2 }, ...]
// Synthesized sound design, deterministic (seeded noise). 48 kHz stereo 16-bit WAV.
import { readFileSync, writeFileSync } from "node:fs";

const SR = 48000;
const cues = JSON.parse(readFileSync(process.argv[2], "utf8"));
const dur = Number(process.argv[4] ?? Math.max(...cues.map((c) => c.t + (c.len ?? 1))) + 1);
const L = new Float32Array(Math.ceil(dur * SR));
const R = new Float32Array(L.length);

let seed = 42;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2147483648 - 1);
const TAU = Math.PI * 2;

// One-pole low-pass state per voice, so noise can be swept.
function lp() {
  let y = 0;
  return (x, cutoff) => {
    const a = 1 - Math.exp((-TAU * cutoff) / SR);
    y += a * (x - y);
    return y;
  };
}

/** Each voice returns [left, right] for local time t (s) and total length len. */
const VOICES = {
  // Rising filtered-noise swell (the line of light being drawn).
  rise(len) {
    const f = lp(), g = lp();
    return (t) => {
      const p = t / len;
      const env = Math.pow(p, 1.6) * (1 - Math.pow(Math.max(0, p - 0.92) / 0.08, 2));
      const cut = 200 + 5200 * p * p;
      const n = noise();
      return [f(n, cut) * env * 0.5, g(n * 0.9 + noise() * 0.1, cut * 1.05) * env * 0.5];
    };
  },
  // Airy high shimmer.
  shimmer(len) {
    return (t) => {
      const env = Math.exp(-t * 2.2) * Math.min(1, t / 0.02);
      const s = [2093, 3136, 4186].reduce((a, f, i) => a + Math.sin(TAU * f * t + i) * (0.5 / (i + 1)), 0);
      const trem = 0.8 + 0.2 * Math.sin(TAU * 7 * t);
      return [s * env * trem * 0.12, s * env * (1.8 - trem) * 0.12];
    };
  },
  // Soft sub drop / impact.
  thump(len) {
    return (t) => {
      const env = Math.exp(-t * 4.5) * Math.min(1, t / 0.004);
      const s = Math.sin(TAU * (48 + 70 * Math.exp(-t * 18)) * t);
      return [s * env * 0.75, s * env * 0.75];
    };
  },
  // Glass "tink": inharmonic partials, fast attack, ringing tail.
  tink(len) {
    const parts = [[2350, 1], [3720, 0.55], [5480, 0.35], [7960, 0.18]];
    return (t) => {
      const env = Math.min(1, t / 0.0015);
      const s = parts.reduce((a, [f, g], i) => a + Math.sin(TAU * f * t + i) * g * Math.exp(-t * (5 + i * 4)), 0);
      return [s * env * 0.18, s * env * 0.16];
    };
  },
  // Soft air whoosh (statement changes), panned left to right.
  whoosh(len) {
    const f = lp();
    return (t) => {
      const p = t / len;
      const env = Math.sin(Math.PI * Math.min(1, p)) ** 2;
      const n = f(noise(), 600 + 2600 * Math.sin(Math.PI * p));
      return [n * env * (1 - p) * 0.55, n * env * p * 0.55];
    };
  },
  // Tiny UI tick (typing).
  tick(len) {
    return (t) => {
      const env = Math.exp(-t * 160) * Math.min(1, t / 0.0005);
      const s = Math.sin(TAU * 3200 * t) * 0.6 + noise() * 0.4;
      return [s * env * 0.1, s * env * 0.1];
    };
  },
};

for (const c of cues) {
  const len = c.len ?? 1.2;
  const voice = VOICES[c.type](len);
  const start = Math.floor(c.t * SR);
  const n = Math.floor(len * SR);
  const gain = c.gain ?? 1;
  for (let i = 0; i < n && start + i < L.length; i++) {
    if (start + i < 0) continue;
    const [l, r] = voice(i / SR);
    L[start + i] += l * gain;
    R[start + i] += r * gain;
  }
}

const frames = L.length;
const buf = Buffer.alloc(44 + frames * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + frames * 4, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(frames * 4, 40);
const q = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
for (let i = 0; i < frames; i++) { buf.writeInt16LE(q(L[i]), 44 + i * 4); buf.writeInt16LE(q(R[i]), 46 + i * 4); }
writeFileSync(process.argv[3], buf);
console.log(`sfx: ${cues.length} cues, ${dur.toFixed(2)} s → ${process.argv[3]}`);
