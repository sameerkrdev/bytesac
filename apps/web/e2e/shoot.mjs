/**
 * Visual QA capture: screenshots routes at the brief's breakpoints in light and dark, and reports horizontal
 * overflow. Needs the web dev server (:3000) and the mock API (:4000) running.
 *
 *   node e2e/shoot.mjs --out <dir> [--widths 390,1440] [--themes light,dark] [--as investor] [--full] /route /route2 …
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
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const out = opt("out", "e2e/__screens__");
const widths = opt("widths", "390,430,768,1024,1280,1440,1920").split(",").map(Number);
const themes = opt("themes", "light,dark").split(",");
const persona = opt("as", "");
const base = opt("base", "http://localhost:3000");
const full = flag("full");
const reduced = flag("reduced");
const routes = args.length ? args : ["/"];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const problems = [];
for (const theme of themes) {
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: theme });
    const cookies = [{ name: "bx_theme", value: theme, url: base }];
    if (persona) cookies.push({ name: "bx_session", value: `mock-${persona}`, url: base });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${theme} ${width} pageerror: ${e.message}`));
    for (const route of routes) {
      await page.goto(base + route, { waitUntil: "networkidle" }).catch((e) => problems.push(`${route} goto: ${e.message}`));
      await page.waitForTimeout(900);
      if (full) {
        // Scroll through so scroll-triggered reveals run, then return to the top.
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(600);
      }
      const overflow = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > w + 1 && getComputedStyle(el).position !== "fixed").slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
        return { scroll: document.documentElement.scrollWidth > w, wide };
      });
      if (overflow.scroll) problems.push(`${route} @${width} ${theme}: horizontal overflow → ${overflow.wide.join(" | ")}`);
      const name = `${route.replace(/[/?=&]+/g, "_").replace(/^_|_$/g, "") || "home"}.${width}.${theme}.png`;
      await page.screenshot({ path: join(out, name), fullPage: full });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no overflow or page errors");
