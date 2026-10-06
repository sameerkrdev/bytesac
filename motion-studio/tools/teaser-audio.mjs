// node tools/teaser-audio.mjs — SFX on the teaser's bars (mirrors src/teaser/TeaserFilm.tsx), mixed with the Lyria
// track (assets/audio/teaser-0.mp3) to -14 LUFS, -1 dBTP, faded with the picture → public/audio/teaser-mix.wav
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const BAR = 1.9504;
const bar = (n) => 0.117 + n * BAR;
const DUR = bar(25.5);
const seq = (t0, n, step, type, gain, len = 0.06) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * step, type, gain, len }));
const cues = [
  { t: bar(2), type: "whoosh", len: 0.7, gain: 0.35 },
  { t: bar(4), type: "thump", len: 0.7, gain: 0.5 }, { t: bar(4), type: "whoosh", len: 0.6, gain: 0.4 },
  { t: bar(5.5), type: "whoosh", len: 0.8, gain: 0.35 },
  ...seq(bar(7) + 0.1, 21, 1 / 24, "tick", 0.55, 0.05),
  { t: bar(8), type: "thump", len: 1.4, gain: 0.65 }, { t: bar(8) + 0.05, type: "shimmer", len: 2.6, gain: 0.6 },
  { t: bar(10), type: "whoosh", len: 0.8, gain: 0.35 }, { t: bar(11.5), type: "tink", len: 1.6, gain: 0.6 },
  { t: bar(12), type: "whoosh", len: 0.8, gain: 0.35 }, { t: bar(14), type: "whoosh", len: 0.8, gain: 0.4 },
  { t: bar(16), type: "whoosh", len: 0.8, gain: 0.35 }, { t: bar(16) + 1.2, type: "tink", len: 1.2, gain: 0.45 },
  { t: bar(18), type: "thump", len: 0.5, gain: 0.35 }, { t: bar(19), type: "whoosh", len: 0.8, gain: 0.3 },
  { t: bar(21), type: "thump", len: 0.6, gain: 0.4 },
  { t: bar(23), type: "rise", len: 1.05, gain: 0.45 }, { t: bar(23) + 0.45, type: "shimmer", len: 3.2, gain: 0.7 },
  ...seq(bar(23) + 0.85, 7, 0.07, "tick", 0.7), ...seq(bar(23) + 1.7, 11, 1 / 16, "tick", 0.45, 0.05),
  { t: bar(23) + 1.0, type: "thump", len: 1.6, gain: 0.5 },
];
writeFileSync("assets/audio/teaser-cues.json", JSON.stringify(cues, null, 1));
execFileSync("node", ["tools/sfx.mjs", "assets/audio/teaser-cues.json", "assets/audio/teaser-sfx.wav", String(DUR)], { stdio: "inherit" });
if (!existsSync("assets/audio/teaser-0.wav")) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", "assets/audio/teaser-0.mp3", "assets/audio/teaser-0.wav"]);
const graph = `[0:a]atrim=0:${DUR},asetpts=N/SR/TB,afade=t=out:st=${DUR - 1.6}:d=1.6[m];[1:a]volume=0.85[s];[m][s]amix=inputs=2:normalize=0`;
const inputs = ["-hide_banner", "-i", "assets/audio/teaser-0.wav", "-i", "assets/audio/teaser-sfx.wav"];
const pass1 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const norm = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const pass2 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},${norm},aresample=48000`, "-c:a", "pcm_s16le", "-y", "public/audio/teaser-mix.wav"], { encoding: "utf8" });
if (pass2.status !== 0) throw new Error(pass2.stderr.slice(-800));
const check = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", "public/audio/teaser-mix.wav", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
console.log("mix →", check.stderr.split("\n").filter((l) => / I:| Peak:|LRA:/.test(l)).map((l) => l.trim()).join("  "));
