// node tools/product-audio.mjs — product film soundtrack (v2, with voiceover).
// 1. Music: the Lyria track (assets/audio/product-0.mp3) extended on measured downbeats: three intro bars
//    ([3.019, 11.297) copied after 11.297) and one groove bar ([33.367, 36.13) copied after 36.13), so the drop lands at
//    30.616 s and the final hit at about 66.4 s.
// 2. Voiceover: Gemini TTS lines (public/vo/L01–L12.wav, voice "Iapetus", 1.1x) placed at src/product/vo.json.
// 3. SFX from a cue sheet (tools/sfx.mjs), on the film's events (src/product/ProductFilm.tsx T).
// 4. Music ducked under the voice (sidechain), voice in front like the reference; master -14 LUFS, -1 dBTP.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const DUR = 68;
const ff = (args) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr.slice(-800)); };
if (!existsSync("assets/audio/product-0.wav")) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", "assets/audio/product-0.mp3", "assets/audio/product-0.wav"]);

// ---- 1. extended music (5 ms fades at every splice to avoid clicks)
const SEG = [[0, 11.297], [3.019, 11.297], [11.297, 36.13], [33.367, 36.13], [36.13, 60.44]];
const parts = SEG.map(([a, z], i) => `[0:a]atrim=${a}:${z},asetpts=N/SR/TB,afade=t=in:d=0.005,afade=t=out:st=${(z - a - 0.005).toFixed(3)}:d=0.005[s${i}]`).join(";");
ff(["-i", "assets/audio/product-0.wav", "-filter_complex", `${parts};${SEG.map((_, i) => `[s${i}]`).join("")}concat=n=${SEG.length}:v=0:a=1,atrim=0:${DUR},afade=t=out:st=${DUR - 1.4}:d=1.4[m]`, "-map", "[m]", "-ar", "48000", "-ac", "2", "assets/audio/product-music-ext.wav"]);

// ---- 2. voiceover track
const VO = JSON.parse(readFileSync("src/product/vo.json", "utf8"));
const keys = Object.keys(VO);
const voIn = keys.flatMap((k) => ["-i", `public/vo/${k}.wav`]);
const voGraph = keys.map((k, i) => `[${i}:a]adelay=${Math.round(VO[k] * 1000)}:all=1,aresample=48000[v${i}]`).join(";") + ";" + keys.map((_, i) => `[v${i}]`).join("") + `amix=inputs=${keys.length}:normalize=0,apad=whole_dur=${DUR},atrim=0:${DUR}[vo]`;
ff([...voIn, "-filter_complex", voGraph, "-map", "[vo]", "-ac", "1", "assets/audio/product-vo.wav"]);

// ---- 3. SFX (times mirror T in ProductFilm.tsx)
const T = { wealth: 9.3, built: 10.1, overnight: 10.5, echo: 11.25, strategy: 12.45, icon: 14.9, prompt: 15.7, chaos: 24.3, hype: 25.2, words: 27.4,
  logo: 30.616, baskets: 33.6, task: 39.2, legs: 41.8, review: 47.1, drift: 51.6, tokenized: 56.0, end: 60.6 };
const CARD_AT = [0.25, 1.7, 3.35, 3.85, 4.5, 4.95, 5.8, 7.05, 7.55, 8.1];
const TODO = [[0.9, 16], [2.5, 18], [4.0, 22], [5.55, 15], [7.1, 15]];
const WORD_AT = [0.2, 1.0, 1.22, 1.45, 1.7];
const seq = (t0, n, step, type, gain, len = 0.05) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * step, type, gain, len }));
const cues = [
  ...CARD_AT.map((a, i) => ({ t: a, type: i === 0 ? "rise" : "whoosh", len: i === 0 ? 0.7 : 0.32, gain: i === 0 ? 0.3 : 0.18 })),
  { t: T.wealth, type: "thump", len: 0.4, gain: 0.35 }, { t: T.built, type: "thump", len: 0.4, gain: 0.35 },
  ...seq(T.overnight, 9, 0.07, "tick", 0.5), { t: T.echo + 0.25, type: "whoosh", len: 0.6, gain: 0.2 },
  ...seq(T.strategy, 8, 0.3, "tick", 0.35, 0.05), { t: T.icon, type: "shimmer", len: 1.2, gain: 0.4 },
  ...TODO.flatMap(([a, n]) => seq(T.prompt + a, n, 1 / 20, "tick", 0.3, 0.04)),
  { t: T.chaos, type: "whoosh", len: 0.8, gain: 0.35 }, ...seq(T.hype, 6, 0.35, "whoosh", 0.2, 0.4),
  ...WORD_AT.map((a) => ({ t: T.words + a, type: "tick", len: 0.07, gain: 0.7 })),
  { t: T.logo, type: "thump", len: 1.2, gain: 0.6 }, { t: T.logo + 0.05, type: "tink", len: 1.4, gain: 0.5 }, ...seq(T.logo + 0.95, 7, 0.07, "tick", 0.45),
  { t: T.baskets, type: "whoosh", len: 0.8, gain: 0.3 }, ...seq(T.baskets + 3.3, 3, 0.15, "tink", 0.3, 0.7),
  ...seq(T.task + 0.5, 3, 1 / 9, "tick", 0.6), { t: T.task + 2.35, type: "tick", len: 0.08, gain: 1.1 }, { t: T.task + 2.4, type: "shimmer", len: 1.2, gain: 0.35 },
  { t: T.legs, type: "whoosh", len: 0.9, gain: 0.35 }, ...seq(T.legs + 1.22, 5, 0.62, "tink", 0.25, 0.6),
  { t: T.review, type: "whoosh", len: 0.8, gain: 0.3 }, { t: T.review + 2.6, type: "tick", len: 0.08, gain: 1.1 },
  { t: T.drift, type: "whoosh", len: 0.8, gain: 0.3 }, { t: T.drift + 1.9, type: "tick", len: 0.08, gain: 1.1 }, { t: T.drift + 2.25, type: "tink", len: 1.0, gain: 0.35 },
  { t: T.tokenized, type: "whoosh", len: 0.8, gain: 0.3 }, ...[0.3, 1.36, 3.06, 3.84].map((a) => ({ t: T.tokenized + a, type: "tink", len: 0.7, gain: 0.3 })),
  { t: T.end, type: "thump", len: 1.2, gain: 0.5 }, { t: T.end + 0.05, type: "tink", len: 1.4, gain: 0.4 }, ...seq(T.end + 0.95, 7, 0.07, "tick", 0.45),
];
writeFileSync("assets/audio/product-cues.json", JSON.stringify(cues, null, 1));
execFileSync("node", ["tools/sfx.mjs", "assets/audio/product-cues.json", "assets/audio/product-sfx.wav", String(DUR)], { stdio: "inherit" });

// ---- 4. mix: music ducked by the voice, voice forward
const inputs = ["-i", "assets/audio/product-music-ext.wav", "-i", "assets/audio/product-vo.wav", "-i", "assets/audio/product-sfx.wav"];
const graph = "[1:a]aresample=48000,asplit=2[vk][vm];" +
  "[0:a]volume=0.55[mu];[mu][vk]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[duck];" +
  "[vm]volume=2.4,pan=stereo|c0=c0|c1=c0[voice];[2:a]volume=0.7[sfx];" +
  "[duck][voice][sfx]amix=inputs=3:normalize=0";
const pass1 = spawnSync("ffmpeg", ["-hide_banner", ...inputs, "-filter_complex", `${graph},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const norm = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
ff([...inputs, "-filter_complex", `${graph},${norm},aresample=48000`, "-c:a", "pcm_s16le", "public/audio/product-mix.wav"]);
const check = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", "public/audio/product-mix.wav", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
console.log("mix →", check.stderr.split("\n").filter((l) => / I:| Peak:|LRA:/.test(l)).map((l) => l.trim()).join("  "));
