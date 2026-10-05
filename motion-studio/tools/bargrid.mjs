// node tools/bargrid.mjs <audio> <bpm> <offset> <filmDur> <out.json>
// Finds the downbeat phase (max low-band onset energy on a fixed bar grid) and writes film-time bar hits.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const [file, bpm, offset, filmDur, out] = process.argv.slice(2);
const SR = 11025, HOP = 64;
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-af", "lowpass=f=120", "-f", "f32le", "-"], { maxBuffer: 1 << 30 }).stdout;
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const env = [];
for (let i = 0; i + HOP <= x.length; i += HOP) { let s = 0; for (let j = 0; j < HOP; j++) s += x[i + j] ** 2; env.push(Math.sqrt(s / HOP)); }
const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
const dt = HOP / SR, bar = (4 * 60) / Number(bpm), off = Number(offset), dur = Number(filmDur);
const at = (t) => { const i = Math.round(t / dt); let m = 0; for (let k = i - 3; k <= i + 3; k++) m = Math.max(m, flux[k] ?? 0); return m; };
let best = [0, -1];
for (let ph = 0; ph < bar; ph += 0.002) {
  let s = 0;
  for (let t = off + ph; t < off + dur; t += bar) s += at(t);
  if (s > best[1]) best = [ph, s];
}
const hits = [];
for (let t = best[0]; t < dur; t += bar) hits.push(+t.toFixed(3));
writeFileSync(out, JSON.stringify({ bpm: Number(bpm), bar: +bar.toFixed(4), sourceOffset: off, hits }, null, 1));
console.log(`phase ${best[0].toFixed(3)}s, bar ${bar.toFixed(4)}s, ${hits.length} hits: ${hits.join(" ")}`);
