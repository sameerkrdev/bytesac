// node tools/motion.mjs <yavg.txt> [deadThreshold] — per-frame motion energy (mean abs frame difference, 15 fps)
// Reports dead spans (no visible change for ≥ 0.4 s) and pops (single-frame spikes far above their neighbours).
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split(/\r?\n/);
const v = [];
for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("lavfi.signalstats.YAVG=")) v.push(Number(lines[i].split("=")[1]));
const fps = 15, dead = Number(process.argv[3] ?? 0.12);
const spans = [];
let start = -1;
for (let i = 0; i <= v.length; i++) {
  const quiet = i < v.length && v[i] < dead;
  if (quiet && start < 0) start = i;
  if (!quiet && start >= 0) { if ((i - start) / fps >= 0.4) spans.push([start / fps, i / fps]); start = -1; }
}
const pops = [];
for (let i = 2; i < v.length - 2; i++) {
  const around = (v[i - 2] + v[i - 1] + v[i + 1] + v[i + 2]) / 4;
  if (v[i] > 2.5 && v[i] > around * 4) pops.push([(i / fps).toFixed(2), v[i].toFixed(1)]);
}
const total = v.length / fps;
const deadTime = spans.reduce((a, [s, e]) => a + e - s, 0);
console.log(`frames ${v.length} (${total.toFixed(1)} s), mean motion ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`);
console.log(`dead spans (<${dead} for ≥0.4 s): ${spans.length}, ${deadTime.toFixed(1)} s = ${((deadTime / total) * 100).toFixed(0)}%`);
console.log(spans.map(([s, e]) => `${s.toFixed(2)}–${e.toFixed(2)} (${(e - s).toFixed(1)}s)`).join("  "));
console.log(`pops: ${pops.map(([t, y]) => `${t}s(${y})`).join(" ")}`);
// 1-second motion profile
const sec = [];
for (let s = 0; s < Math.ceil(total); s++) { const seg = v.slice(s * fps, (s + 1) * fps); sec.push((seg.reduce((a, b) => a + b, 0) / Math.max(1, seg.length)).toFixed(1)); }
console.log("per-second:", sec.join(" "));
