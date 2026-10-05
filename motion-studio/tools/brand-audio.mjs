// node tools/brand-audio.mjs — cue sheet for the brand film (mirrors T in src/brand/BrandFilm.tsx),
// synthesizes the SFX and mixes them with the Lyria track to -14 LUFS, -1 dBTP → public/audio/brand-mix.wav
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const B = JSON.parse(readFileSync("src/brand/beats.json", "utf8")).beats;
const bar = (n) => B[n * 4];
const beatLen = B[1] - B[0];
const T = {
  lineStart: 0.25, lineEnd: 3.2, bloom: bar(0) - 0.25, bottomSlab: bar(0) + 0.9, topSlab: bar(1), land: bar(2),
  s1: bar(3), s1Out: bar(5) - 0.5, s2: bar(5), s2Out: bar(6) - 0.45, morph: bar(6), type: bar(7), eyebrow: bar(8),
};
// Decode the Lyria MP3 once (WAVs are git-ignored).
if (!existsSync("assets/audio/brandclip-0.wav")) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", "assets/audio/brandclip-0.mp3", "assets/audio/brandclip-0.wav"]);
const DUR = 29.8;

const cues = [
  { t: T.lineStart, type: "rise", len: T.bloom + 0.25 - T.lineStart, gain: 0.9 },
  { t: T.lineEnd - 0.05, type: "shimmer", len: 2.5, gain: 0.9 },
  { t: T.bloom + 0.25, type: "thump", len: 1.2, gain: 0.55 },
  { t: T.land - 0.7, type: "tink", len: 1.6, gain: 0.5 }, // bottom slab settles
  { t: T.land, type: "tink", len: 2.2, gain: 0.9 }, // top slab lands
  { t: T.s1 - 0.15, type: "whoosh", len: 0.9, gain: 0.45 },
  { t: T.s1Out, type: "whoosh", len: 0.8, gain: 0.35 },
  { t: T.s2 + beatLen, type: "whoosh", len: 0.6, gain: 0.25 },
  { t: T.morph + 0.3, type: "whoosh", len: 1.4, gain: 0.5 },
  { t: T.morph + 1.9, type: "shimmer", len: 2, gain: 0.5 },
  ...Array.from({ length: 7 }, (_, i) => ({ t: T.type + 0.25 + i * 0.075, type: "tick", len: 0.08, gain: 1 })),
  { t: T.eyebrow, type: "thump", len: 1.4, gain: 0.6 },
];
writeFileSync("assets/audio/brand-cues.json", JSON.stringify(cues, null, 1));
execFileSync("node", ["tools/sfx.mjs", "assets/audio/brand-cues.json", "assets/audio/brand-sfx.wav", String(DUR)], { stdio: "inherit" });

// Music + SFX, trimmed to the film, 1.2 s fade at the end, loudness-normalized (two-pass loudnorm).
const graph = `[0:a]atrim=0:${DUR},asetpts=N/SR/TB[m];[1:a]volume=0.9[s];[m][s]amix=inputs=2:normalize=0,afade=t=out:st=${DUR - 1.2}:d=1.2`;
const inputs = ["-hide_banner", "-i", "assets/audio/brandclip-0.wav", "-i", "assets/audio/brand-sfx.wav"];
const pass1 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const norm = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const pass2 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},${norm},aresample=48000`, "-c:a", "pcm_s16le", "-y", "public/audio/brand-mix.wav"], { encoding: "utf8" });
if (pass2.status !== 0) throw new Error(pass2.stderr.slice(-800));
const check = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", "public/audio/brand-mix.wav", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
console.log("mix →", check.stderr.split("\n").filter((l) => / I:| Peak:|LRA:/.test(l)).map((l) => l.trim()).join("  "));
