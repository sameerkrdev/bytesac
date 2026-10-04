/** Prints console errors for a route (debug helper): node e2e/console.mjs /route [persona] */
import process from "node:process";
import { chromium } from "@playwright/test";
const [route, persona] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext();
if (persona) await ctx.addCookies([{ name: "bx_session", value: `mock-${persona}`, url: "http://localhost:3000" }]);
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 600)); });
p.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 600)));
await p.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await b.close();
