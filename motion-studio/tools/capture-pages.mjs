// node tools/capture-pages.mjs <theme> <outDir> <name=route[@width]> ... — full-page captures of the web app on the
// mock API (investor persona) for the films. Width defaults to 1440 at dpr 2.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [theme, outDir, ...jobs] = process.argv.slice(2);
const WEB = "http://localhost:3100";
mkdirSync(outDir, { recursive: true });
const HIDE = "nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }";
const browser = await chromium.launch();
for (const job of jobs) {
  const [name, rest] = job.split("=");
  const [route, w] = rest.split("@");
  const width = Number(w ?? 1440);
  const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 870 }, deviceScaleFactor: width > 600 ? 2 : 3, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "bx_theme", value: theme, url: WEB }, { name: "bx_session", value: "mock-investor", url: WEB }]);
  const page = await ctx.newPage();
  try {
    await page.goto(WEB + route, { waitUntil: "networkidle", timeout: 90000 });
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    console.log("saved", name, await page.title());
  } catch (err) { console.log("FAILED", name, String(err).split("\n")[0]); }
  await ctx.close();
}
await browser.close();
