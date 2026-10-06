// node tools/investor-audio.mjs — SFX cue sheet for the investor film (shot times mirror src/investor/timeline.ts),
// mixed with the Lyria track (assets/audio/investor-0.mp3) to -14 LUFS, -1 dBTP → public/audio/investor-mix.wav
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const grid = JSON.parse(readFileSync("src/investor/grid.json", "utf8"));
const bar = (n) => grid.hits[n];
const BAR = grid.bar;
const S = {
  logo: 0, dashes: bar(3), job: bar(5), giant: bar(6), shortcut: bar(9), trust: bar(11), cards: bar(12), slot: bar(16),
  whatIf: bar(19), keys: bar(20), rings: bar(21), want: bar(24), intro: bar(26), managers: bar(28), tour: bar(30),
  chains: bar(33), legs: bar(35), donut: bar(37), plan: bar(39), notAll: bar(41), rebalance: bar(42), drift: bar(44),
  repair: bar(45), notify: bar(46), orbit: bar(48), funny: bar(50), cta: bar(52) + BAR / 2, outro: bar(54),
};
const DUR = 108;
const seq = (t0, n, step, type, gain, len = 0.06) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * step, type, gain, len }));

const cues = [
  // 1 logo
  { t: 0, type: "rise", len: 1.05, gain: 0.5 }, { t: S.logo + 0.45, type: "shimmer", len: 2.4, gain: 0.7 },
  ...seq(0.85, 7, 0.07, "tick", 0.7), { t: 1.0, type: "thump", len: 1.0, gain: 0.35 },
  // 2–3 dashes
  { t: S.dashes, type: "whoosh", len: 1.2, gain: 0.3 }, { t: S.dashes + 1.6, type: "whoosh", len: 1.4, gain: 0.35 },
  { t: S.job, type: "tick", len: 0.08, gain: 1 },
  // 4 giant (hard cut to white)
  { t: S.giant, type: "thump", len: 0.8, gain: 0.55 }, { t: S.giant + 0.02, type: "whoosh", len: 0.6, gain: 0.45 },
  // 5 typewriter
  ...seq(S.shortcut + 0.25, 23, 1 / 17, "tick", 0.55, 0.05), { t: S.shortcut + 1.9, type: "whoosh", len: 0.6, gain: 0.2 }, ...seq(S.shortcut + 2.5, 13, 1 / 15, "tick", 0.4, 0.05),
  // 6a panel up, lines
  { t: S.trust, type: "whoosh", len: 0.8, gain: 0.5 }, ...seq(S.trust + 0.45, 6, (S.cards - S.trust - 0.8) / 6, "tick", 0.8, 0.07),
  // 6 cards (one per bar)
  ...[0, 1, 2, 3].flatMap((i) => [{ t: S.cards + i * BAR, type: "whoosh", len: 0.7, gain: 0.4 }, { t: S.cards + i * BAR + 0.25, type: "tink", len: 1.0, gain: 0.35 }]),
  // 7 slot machine
  ...seq(S.slot, 6, BAR / 2, "tick", 1.1, 0.08),
  // 9–10
  { t: S.whatIf, type: "rise", len: 1.8, gain: 0.35 }, { t: S.keys + 0.05, type: "tink", len: 1.6, gain: 0.6 },
  // 11 rings + counting
  { t: S.rings, type: "thump", len: 0.6, gain: 0.3 }, { t: S.rings + BAR, type: "tink", len: 0.8, gain: 0.4 },
  ...seq(S.rings + BAR + 0.2, 6, 0.17, "tick", 0.9, 0.06), { t: S.rings + 2 * BAR, type: "tink", len: 1.2, gain: 0.5 },
  // 12 the question; 13 the reveal
  { t: S.want, type: "whoosh", len: 0.9, gain: 0.5 }, { t: S.want + 0.4, type: "rise", len: S.intro - S.want - 0.4, gain: 0.45 },
  { t: S.intro, type: "thump", len: 1.4, gain: 0.7 }, { t: S.intro + 0.05, type: "shimmer", len: 2.6, gain: 0.7 },
  // 14–15
  { t: S.managers, type: "whoosh", len: 0.8, gain: 0.35 }, { t: S.managers + 1.3, type: "tink", len: 1.2, gain: 0.55 },
  ...seq(S.tour, 4, (S.chains - S.tour) / 4, "whoosh", 0.3, 0.6),
  // 16 chains
  { t: S.chains, type: "thump", len: 0.6, gain: 0.3 }, ...seq(S.chains + 0.7, 6, 0.12, "tick", 0.8, 0.07),
  // 17 legs
  ...seq(S.legs + 0.25, 5, 0.22, "tick", 0.6, 0.06), ...seq(S.legs + 0.95, 5, 0.32, "tink", 0.3, 0.6),
  // 18–19
  ...seq(S.donut + 0.1, 5, 0.16, "tick", 0.7, 0.06), { t: S.plan, type: "whoosh", len: 0.9, gain: 0.35 },
  // 20 wedge
  { t: S.notAll, type: "whoosh", len: 1.9, gain: 0.55 },
  // 21–24
  { t: S.rebalance + 1.2, type: "whoosh", len: 0.7, gain: 0.4 }, { t: S.rebalance + 2.9, type: "tick", len: 0.08, gain: 1.3 },
  { t: S.drift, type: "whoosh", len: 0.6, gain: 0.35 }, { t: S.repair, type: "whoosh", len: 0.6, gain: 0.35 },
  ...seq(S.notify + 0.5, 3, 0.18, "tink", 0.4, 0.7),
  // 25 orbit; 26 the funny cards
  { t: S.orbit, type: "shimmer", len: 2.4, gain: 0.55 },
  ...[0, 1, 2].flatMap((i) => {
    const step = (S.cta - S.funny - 0.6) / 3;
    return [{ t: S.funny + i * step, type: "thump", len: 0.4, gain: 0.35 }, { t: S.funny + i * step + 0.55, type: "tink", len: 0.8, gain: 0.45 }];
  }),
  // 27 CTA; 28 logo
  { t: S.cta + 1.25, type: "thump", len: 1.0, gain: 0.55 },
  { t: S.outro, type: "rise", len: 1.05, gain: 0.45 }, { t: S.outro + 0.45, type: "shimmer", len: 3.2, gain: 0.8 },
  ...seq(S.outro + 0.85, 7, 0.07, "tick", 0.7), ...seq(S.outro + 1.7, 11, 1 / 16, "tick", 0.45, 0.05),
  { t: S.outro + 1.0, type: "thump", len: 1.6, gain: 0.5 },
];
writeFileSync("assets/audio/investor-cues.json", JSON.stringify(cues, null, 1));
execFileSync("node", ["tools/sfx.mjs", "assets/audio/investor-cues.json", "assets/audio/investor-sfx.wav", String(DUR)], { stdio: "inherit" });

if (!existsSync("assets/audio/investor-0.wav")) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", "assets/audio/investor-0.mp3", "assets/audio/investor-0.wav"]);
const graph = `[0:a]apad=whole_dur=${DUR},atrim=0:${DUR},asetpts=N/SR/TB[m];[1:a]volume=0.85[s];[m][s]amix=inputs=2:normalize=0`;
const inputs = ["-hide_banner", "-i", "assets/audio/investor-0.wav", "-i", "assets/audio/investor-sfx.wav"];
const pass1 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
const norm = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const pass2 = spawnSync("ffmpeg", [...inputs, "-filter_complex", `${graph},${norm},aresample=48000`, "-c:a", "pcm_s16le", "-y", "public/audio/investor-mix.wav"], { encoding: "utf8" });
if (pass2.status !== 0) throw new Error(pass2.stderr.slice(-800));
const check = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", "public/audio/investor-mix.wav", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
console.log("mix →", check.stderr.split("\n").filter((l) => / I:| Peak:|LRA:/.test(l)).map((l) => l.trim()).join("  "));
