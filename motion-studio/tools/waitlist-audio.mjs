// node tools/waitlist-audio.mjs — SFX cue sheet for the waitlist film (ref1 moments re-anchored to our bar grid, same
// rule as src/waitlist/timeline.ts), mixed with the Lyria track (cut from 13.6 s) to -14 LUFS → public/audio/waitlist-mix.wav
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const grid = JSON.parse(readFileSync("src/waitlist/grid.json", "utf8"));
const REF = [0.209, 1.95, 3.692, 5.422, 7.163, 8.905, 10.646, 12.388, 14.118, 15.859, 17.601, 19.342, 21.072, 22.814,
  24.555, 26.297, 28.038, 29.78, 31.509, 33.25, 34.99, 36.73, 38.47, 40.2];
const rt = (r) => { let n = 0; REF.forEach((v, i) => { if (v <= r) n = i; }); return grid.hits[n] + (r - REF[n]); };
// Decode the Lyria MP3 once (WAVs are git-ignored).
if (!existsSync("assets/audio/waitlist-0.wav")) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", "assets/audio/waitlist-0.mp3", "assets/audio/waitlist-0.wav"]);
const DUR = 43.8;

const cues = [
  { t: rt(0.7), type: "whoosh", len: 1.3, gain: 0.25 },                       // focus pull
  { t: rt(2.47), type: "whoosh", len: 0.5, gain: 0.55 },                      // pill expands
  { t: rt(3.9), type: "whoosh", len: 0.55, gain: 0.5 },                       // slab wipes the wordmark
  ...Array.from({ length: 21 }, (_, i) => ({ t: rt(4.45) + i * 0.045, type: "tick", len: 0.06, gain: 0.7 })), // type-on
  ...Array.from({ length: 16 }, (_, i) => ({ t: rt(7.16) + i * 0.065, type: "tick", len: 0.05, gain: 0.45 })), // count-up
  { t: rt(10.6), type: "whoosh", len: 1.2, gain: 0.3 },                       // phone dissolves
  { t: rt(13.0), type: "rise", len: 0.7, gain: 0.5 },                         // stack rises
  { t: rt(15.86), type: "tink", len: 1.4, gain: 0.6 },                        // explode
  { t: rt(16.0), type: "whoosh", len: 0.7, gain: 0.4 },                       // travel up
  { t: rt(16.6), type: "rise", len: 1.0, gain: 0.35 },                        // line draws
  { t: rt(19.34), type: "tink", len: 1.6, gain: 0.7 },                        // fill
  { t: rt(20.0), type: "whoosh", len: 0.9, gain: 0.5 },                       // exit right
  { t: rt(21.07), type: "tick", len: 0.06, gain: 1 },                         // small slab appears
  { t: rt(22.81), type: "thump", len: 0.8, gain: 0.5 },                       // collide
  { t: rt(22.81), type: "tink", len: 1.5, gain: 0.6 },
  ...Array.from({ length: 7 }, (_, i) => ({ t: rt(24.0) + i * 0.075, type: "tick", len: 0.06, gain: 0.8 })), // wordmark
  { t: rt(25.33), type: "whoosh", len: 0.7, gain: 0.6 },                      // smear
  { t: rt(29.0), type: "whoosh", len: 1.3, gain: 0.55 },                      // diagonal wipe
  ...Array.from({ length: 16 }, (_, i) => ({ t: rt(30.3) + i * 0.068, type: "tick", len: 0.05, gain: 0.4 })), // count-up
  { t: rt(34.4), type: "tink", len: 1.4, gain: 0.7 },                         // wallet pops
  { t: rt(37.0), type: "whoosh", len: 0.9, gain: 0.35 },                      // ghost → real phone
  { t: rt(40.6), type: "whoosh", len: 0.6, gain: 0.45 },                      // phone flies up
  { t: rt(41.0), type: "shimmer", len: 2.2, gain: 0.5 },                      // hero reassembles
];
writeFileSync("assets/audio/waitlist-cues.json", JSON.stringify(cues, null, 1));
execFileSync("node", ["tools/sfx.mjs", "assets/audio/waitlist-cues.json", "assets/audio/waitlist-sfx.wav", String(DUR)], { stdio: "inherit" });

const graph = `[0:a]atrim=${grid.sourceOffset}:${grid.sourceOffset + DUR},asetpts=N/SR/TB,afade=t=in:d=0.03,afade=t=out:st=${DUR - 1.5}:d=1.5[m];[1:a]volume=0.8[s];[m][s]amix=inputs=2:normalize=0`;
const inputs = ["-hide_banner", "-i", "assets/audio/waitlist-0.wav", "-i", "assets/audio/waitlist-sfx.wav"];
const pass1 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const norm = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const pass2 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},${norm},aresample=48000`, "-c:a", "pcm_s16le", "-y", "public/audio/waitlist-mix.wav"], { encoding: "utf8" });
if (pass2.status !== 0) throw new Error(pass2.stderr.slice(-800));
const check = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", "public/audio/waitlist-mix.wav", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
console.log("mix →", check.stderr.split("\n").filter((l) => / I:| Peak:|LRA:/.test(l)).map((l) => l.trim()).join("  "));
