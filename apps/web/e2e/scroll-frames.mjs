/**
 * Scroll choreography QA: captures the viewport at evenly spaced scroll positions so page-swap and parallax moves can
 * be checked frame by frame.
 *
 *   node e2e/scroll-frames.mjs --out <dir> [--base http://localhost:3000] [--width 1440] [--theme light] [--step 0.5] [--from 0] [--to 99] /route
 */
import process from "node:process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const out = opt("out", "e2e/__frames__");
const base = opt("base", "http://localhost:3000");
const width = Number(opt("width", "1440"));
const theme = opt("theme", "light");
const step = Number(opt("step", "0.5"));
const from = Number(opt("from", "0"));
const to = Number(opt("to", "99"));
const route = args[0] ?? "/";
mkdirSync(out, { recursive: true });

const height = width < 768 ? 844 : 900;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme });
await ctx.addCookies([{ name: "bx_theme", value: theme, url: base }]);
const page = await ctx.newPage();
await page.goto(base + route, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let n = 0;
for (let k = from; k <= to; k++) {
  const y = Math.round(k * step * height);
  if (y > total - height + step * height) break;
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(out, `${String(k).padStart(3, "0")}.png`) });
  n++;
}
console.log(`${n} frames, page height ${total}px`, errors.length ? errors : "no page errors");
await browser.close();
