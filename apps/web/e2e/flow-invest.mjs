/**
 * Walks the full-page investment flow against the mock API and captures each step (visual QA only).
 *   node e2e/flow-invest.mjs --out <dir> [--width 1440] [--theme light] [--slug core-crypto-index]
 */
import process from "node:process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("out", "e2e/__screens__");
const width = Number(arg("width", "1440"));
const theme = arg("theme", "light");
const slug = arg("slug", "core-crypto-index");
const base = "http://localhost:3000";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: theme });
await ctx.addCookies([{ name: "bx_theme", value: theme, url: base }, { name: "bx_session", value: "mock-investor", url: base }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: join(out, `invest-${name}.${width}.${theme}.png`), fullPage: true });

await page.goto(`${base}/baskets/${slug}/invest`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "How much do you want to invest?" }).waitFor();
await page.waitForTimeout(500);
await shot("1-amount");
await page.getByRole("button", { name: "Get preview" }).click();
await page.getByRole("heading", { name: "Review the plan" }).waitFor();
await page.waitForTimeout(400);
await shot("2-review");
await page.getByRole("checkbox").check();
await page.getByRole("button", { name: "Continue to signing" }).click();
await page.getByRole("heading", { name: "Authorize each step" }).waitFor();
await page.waitForTimeout(600);
await shot("3-sign");
await browser.close();
console.log(errors.length ? errors.join("\n") : "flow ok");
