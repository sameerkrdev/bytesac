// node tools/capture-cards.mjs — screenshots individual real Bytesac UI pieces (mock API, investor persona) for the
// waitlist film. Each job: page + text that identifies the card; the card is the nearest rounded, white ancestor.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const WEB = "http://localhost:3100";
const EXPO = "http://localhost:8091";
const OUT = "public/ui";
mkdirSync(OUT, { recursive: true });

const POSITION = "0192f1c2-7a4b-7c3d-8e9f-000000000100"; // Core Crypto Index position (fixtures)

/** [name, base, route, width, dpr, mode, text?] — mode "card" (element), "viewport" (phone screen), "page" (full). */
const JOBS = [
  ["card-portfolio", WEB, "/home", 1440, 2, "card", "Portfolio value"],
  ["card-attention", WEB, "/home", 1440, 2, "card", "The manager published a new version"],
  ["card-baskets", WEB, "/home", 1440, 2, "card", "Aligned"],
  ["card-basket-solana", WEB, "/home", 1440, 2, "card", "The core of the Solana network"],
  ["card-position", WEB, "/portfolio", 1440, 2, "card", "Opened 12 Jun 2026"],
  ["page-rebalance", WEB, `/portfolio/${POSITION}/rebalance`, 1440, 2, "page"],
  ["phone-home", WEB, "/home", 390, 3, "viewport"],
  ["phone-home-full", WEB, "/home", 390, 3, "page"],
  ["phone-basket-alloc", WEB, "/baskets/core-crypto-index", 390, 3, "scroll", "Target weights"],
  ["phone-basket-full", WEB, "/baskets/core-crypto-index", 390, 3, "page"],
  ["phone-rebalance", WEB, `/portfolio/${POSITION}/rebalance`, 390, 3, "viewport"],
];

const HIDE = "nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }";

const browser = await chromium.launch();
for (const [name, base, route, width, dpr, mode, text] of JOBS) {
  const ctx = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 870 }, deviceScaleFactor: dpr, colorScheme: "light", reducedMotion: "reduce",
  });
  await ctx.addCookies([
    { name: "bx_theme", value: "light", url: base },
    { name: "bx_session", value: "mock-investor", url: base },
  ]);
  const page = await ctx.newPage();
  try {
    await page.goto(base + route, { waitUntil: "networkidle", timeout: 90000 });
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(base === EXPO ? 4000 : 800);
    const file = `${OUT}/${name}.png`;
    if (mode === "card") {
      const handle = await page.evaluateHandle((needle) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) if (node.textContent?.includes(needle)) break;
        let el = node?.parentElement ?? null;
        while (el && el !== document.body) {
          const cs = getComputedStyle(el);
          if (parseFloat(cs.borderTopLeftRadius) >= 14 && cs.backgroundColor === "rgb(255, 255, 255)") return el;
          el = el.parentElement;
        }
        return null;
      }, text);
      const el = handle.asElement();
      if (!el) throw new Error(`card not found for "${text}"`);
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: file, omitBackground: true });
    } else if (mode === "scroll") {
      // Scroll so the section label sits just under the sticky header, then capture the phone screen.
      await page.evaluate((needle) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) if (node.textContent?.trim().toLowerCase() === needle.toLowerCase()) break;
        const el = node?.parentElement;
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96);
      }, text);
      await page.waitForTimeout(500);
      await page.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: mode === "page" });
    }
    console.log("saved", file);
  } catch (err) {
    console.log("FAILED", name, String(err).split("\n")[0]);
  }
  await ctx.close();
}
await browser.close();
