// node tools/capture.mjs <base> <outDir> <persona> <width>x<height>@<dpr> <route> [route...]
// Captures real Bytesac UI (mock API fixtures) for the films. Light theme, full page, crisp (dpr 2–3).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [base, outDir, persona, size, ...routes] = process.argv.slice(2);
const [, w, h, dpr] = size.match(/(\d+)x(\d+)@(\d+(?:\.\d+)?)/);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(dpr), colorScheme: "light",
  reducedMotion: "reduce", // final states, no reveal animations mid-flight
});
await ctx.addCookies([
  { name: "bx_theme", value: "light", url: base },
  ...(persona !== "none" ? [{ name: "bx_session", value: `mock-${persona}`, url: base }] : []),
]);
const page = await ctx.newPage();
for (const route of routes) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const name = `${route.replace(/^\//, "").replace(/[/?=&]+/g, "_") || "root"}-${w}.png`;
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
  console.log("saved", name, await page.title());
}
await browser.close();
