/**
 * Animation QA over time: scrolls an element into view and captures it every `interval` ms, for checking entrance and
 * assembly sequences (e.g. the glass scenes).
 *
 *   node e2e/time-frames.mjs --out <dir> [--base http://localhost:3000] [--width 1440] [--theme light] [--count 12] [--interval 300] --selector "<css>" /route
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
const count = Number(opt("count", "12"));
const interval = Number(opt("interval", "300"));
const selector = opt("selector", "canvas");
const route = args[0] ?? "/";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, deviceScaleFactor: 1, colorScheme: theme });
await ctx.addCookies([{ name: "bx_theme", value: theme, url: base }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base + route, { waitUntil: "networkidle" });
const el = page.locator(selector).first();
await el.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -120));
for (let i = 0; i < count; i++) {
  await page.screenshot({ path: join(out, `${String(i).padStart(3, "0")}.png`) });
  await page.waitForTimeout(interval);
}
console.log(`${count} frames`, errors.length ? errors : "no errors");
await browser.close();
