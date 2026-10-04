/**
 * Finds what actually widens the page: elements past the viewport edge that are not inside a horizontal scroller.
 *
 *   node e2e/overflow-culprit.mjs [--base http://localhost:3000] [--width 390] [--as manager] /route
 */
import process from "node:process";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const base = opt("base", "http://localhost:3000");
const width = Number(opt("width", "390"));
const persona = opt("as", "");
const route = args[0] ?? "/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 } });
if (persona) await ctx.addCookies([{ name: "bx_session", value: `mock-${persona}`, url: base }]);
const page = await ctx.newPage();
await page.goto(base + route, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const found = await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const clipped = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX; if (p === document.body || p === document.documentElement) continue;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
    }
    return false;
  };
  return {
    scrollWidth: document.documentElement.scrollWidth, w,
    culprits: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > w + 1 && !clipped(el))
      .slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 90)} right=${Math.round(el.getBoundingClientRect().right)} pos=${getComputedStyle(el).position}`),
  };
});
console.log(JSON.stringify(found, null, 2));
// Bisect: which element, when hidden, removes the overflow?
const blame = await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length === 0) continue;
    const prev = el.style.display; el.style.display = 'none';
    const fixed = document.documentElement.scrollWidth <= w;
    el.style.display = prev;
    if (fixed) out.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 100));
  }
  return out.slice(-6);
});
console.log('hiding fixes it:', JSON.stringify(blame, null, 2));
await browser.close();
