// node tools/capture-dark-cards.mjs — real Bytesac UI pieces in the dark theme for the investor film
// (mock API, investor persona). Each job: route + text inside the card; the card is the nearest ancestor with a
// radius of at least 14px and a non-transparent background.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const WEB = "http://localhost:3100";
const OUT = "public/ui-dark";
const P = "0192f1c2-7a4b-7c3d-8e9f-000000000100";
mkdirSync(OUT, { recursive: true });

/** [name, route, text, persona?, width?] */
const JOBS = [
  ["basket-hero", "/baskets/core-crypto-index", "The largest networks by long-run adoption"],
  ["discover-card-core", "/baskets", "The largest networks by long-run adoption"],
  ["discover-card-balanced", "/baskets", "Crypto growth balanced with tokenized"],
  ["discover-card-solana", "/baskets", "The core of the Solana network"],
  ["discover-ai", "/baskets", "Describe what you want"],
  ["portfolio-value", "/portfolio", "Values use current market prices"],
  ["attention-update", "/portfolio", "The manager published a new version"],
  ["attention-drift", "/portfolio", "Prices moved your weights"],
  ["position-core", "/portfolio", "Opened 12 Jun 2026"],
  ["rebalance-version", `/portfolio/${P}/rebalance`, "Rebalanced toward the target"],
  ["rebalance-decide", `/portfolio/${P}/rebalance`, "Create plan"],
  ["rebalance-weights", `/portfolio/${P}/rebalance`, "Current and target weights"],
  ["notifications-list", "/notifications", "Core Crypto Index: new version available"],
  ["invest-amount", "/baskets/core-crypto-index/invest", "How much do you want to invest"],
  ["invest-split", "/baskets/core-crypto-index/invest", "Target split"],
  ["invest-summary", "/baskets/core-crypto-index/invest", "Your wallet, your signature"],
  ["signin", "/sign-in", "Connect", "none"],
];
const HIDE = "nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }";

const browser = await chromium.launch();
const only = process.argv.slice(2);
for (const [name, route, text, persona = "investor", width = 1440] of JOBS) {
  if (only.length && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
  const cookies = [{ name: "bx_theme", value: "dark", url: WEB }];
  if (persona !== "none") cookies.push({ name: "bx_session", value: `mock-${persona}`, url: WEB });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  try {
    await page.goto(WEB + route, { waitUntil: "networkidle", timeout: 90000 });
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    const handle = await page.evaluateHandle((needle) => {
      // Every text node that contains the needle; the first one inside a card wins, else its form/section.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node, fallback = null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.toLowerCase().includes(needle.toLowerCase())) continue;
        let el = node.parentElement;
        if (!el || el.getClientRects().length === 0) continue; // hidden copies (titles, sr-only)
        while (el && el !== document.body) {
          const cs = getComputedStyle(el);
          const bg = cs.backgroundColor;
          const filled = (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0;
          const { width: w, height: h } = el.getBoundingClientRect();
          if (parseFloat(cs.borderTopLeftRadius) >= 14 && filled && w > 240 && h > 100) return el;
          if (!fallback && (el.tagName === "FORM" || el.tagName === "SECTION") && w > 360) fallback = el;
          el = el.parentElement;
        }
      }
      return fallback;
    }, text);
    const el = handle.asElement();
    if (!el) throw new Error(`card not found for "${text}"`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await el.screenshot({ path: `${OUT}/${name}.png`, omitBackground: true });
    const box = await el.boundingBox();
    console.log("saved", name, Math.round(box.width), "x", Math.round(box.height));
  } catch (err) { console.log("FAILED", name, String(err).split("\n")[0]); }
  await ctx.close();
}
await browser.close();
