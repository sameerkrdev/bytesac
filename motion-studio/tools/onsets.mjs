// node tools/onsets.mjs <audio> — kick onsets (low band energy flux) + tempo estimate, no deps.
import { spawnSync } from 'node:child_process';
const SR = 11025, HOP = 128;
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', process.argv[2], '-ac', '1', '-ar', String(SR),
  '-af', process.argv[3] ?? 'lowpass=f=150', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 }).stdout;
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const env = [];
for (let i = 0; i + HOP <= x.length; i += HOP) { let s = 0; for (let j = 0; j < HOP; j++) s += x[i + j] ** 2; env.push(Math.sqrt(s / HOP)); }
const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
const max = Math.max(...flux), dt = HOP / SR, onsets = [];
for (let i = 2; i < flux.length - 2; i++) {
  if (flux[i] > 0.25 * max && flux[i] === Math.max(...flux.slice(i - 8, i + 9)) &&
      (!onsets.length || i * dt - onsets.at(-1) > 0.15)) onsets.push(+(i * dt).toFixed(3));
}
const iv = onsets.slice(1).map((t, i) => +(t - onsets[i]).toFixed(3));
console.log('onsets', onsets.length, JSON.stringify(onsets));
console.log('intervals', JSON.stringify(iv));
// tempo: autocorrelation of the flux envelope between 60 and 180 BPM
let best = [0, 0];
for (let bpm = 60; bpm <= 180; bpm += 0.25) {
  const lag = 60 / bpm / dt; let s = 0;
  for (let i = 0; i + lag + 1 < flux.length; i++) { const l = Math.floor(i + lag), f = i + lag - l; s += flux[i] * (flux[l] * (1 - f) + flux[l + 1] * f); }
  if (s > best[1]) best = [bpm, s];
}
console.log('bpm (autocorr)', best[0]);
