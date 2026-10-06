// node tools/teaser-clips.mjs — copies Runway clips from runway-kit/clips/ into public/teaser/clips/ and writes
// src/teaser/clips.json (which shots have footage). Shots without a clip fall back to the animated start frame.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
const SHOTS = ["A1", "A2", "A3", "B4", "B1", "B2", "B3", "B5"];
mkdirSync("public/teaser/clips", { recursive: true });
const have = {};
for (const s of SHOTS) {
  const src = readdirSync("runway-kit/clips").find((f) => f.toUpperCase().startsWith(s) && f.toLowerCase().endsWith(".mp4"));
  if (src) { copyFileSync(`runway-kit/clips/${src}`, `public/teaser/clips/${s}.mp4`); have[s] = true; }
  else have[s] = false;
}
writeFileSync("src/teaser/clips.json", JSON.stringify(have, null, 1) + "\n");
console.log("clips:", Object.entries(have).map(([k, v]) => `${k}${v ? "✓" : "·"}`).join(" "));
