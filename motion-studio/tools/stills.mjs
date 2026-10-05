// node tools/stills.mjs <CompositionId> <out-prefix> <t1,t2,...|every:0.5> [cols]
// Bundles once, renders the requested moments as PNG stills, tiles them into <out-prefix>-sheet.png.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const BROWSER = path.join(homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe");

const [id, prefix, spec, colsArg] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id, browserExecutable: BROWSER });
const dur = composition.durationInFrames / composition.fps;
const times = spec.startsWith("every:")
  ? Array.from({ length: Math.floor(dur / Number(spec.slice(6))) + 1 }, (_, i) => i * Number(spec.slice(6)))
  : spec.split(",").map(Number);

mkdirSync(path.dirname(prefix), { recursive: true });
const files = [];
for (const [i, t] of times.entries()) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(t * composition.fps));
  const output = `${prefix}-${String(i).padStart(3, "0")}.png`;
  await renderStill({ composition, serveUrl, frame, output, browserExecutable: BROWSER, scale: Number(process.env.SCALE ?? 0.5) });
  files.push(output);
  process.stdout.write(`${t.toFixed(2)}s `);
}
const cols = Number(colsArg ?? (composition.width > composition.height ? 4 : 6));
const rows = Math.ceil(files.length / cols);
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i", `${prefix}-%03d.png`,
  "-vf", `scale=${composition.width > composition.height ? 480 : 270}:-1,tile=${cols}x${rows}:padding=4:color=white`, "-frames:v", "1", `${prefix}-sheet.png`]);
console.log(`\nsheet → ${prefix}-sheet.png (${files.length} frames, ${times.map((t) => t.toFixed(2)).join(" ")})`);
