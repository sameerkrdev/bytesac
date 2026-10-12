/**
 * Spec 22 P0: drives the dev-only wallet lab (/dev/wallet-lab) with a real wallet extension, counts the wallet's confirmation screens per run, and
 * optionally clicks Approve. Results (the lab's JSON plus the measured counts) go to a file for docs/engineering/INTEGRATION-AUDIT.md.
 *
 *   1. Setup, once per wallet (opens a browser with its own profile; install the wallet from the Chrome Web Store, import the TEST seed,
 *      open the lab and connect the wallet, then close the browser):
 *        node e2e/wallet-lab-auto.mjs --setup --wallet phantom
 *   2. Run (counts screens while YOU approve in the wallet):
 *        node e2e/wallet-lab-auto.mjs --wallet phantom
 *      or let the script click the wallet's Approve button (test seed only):
 *        node e2e/wallet-lab-auto.mjs --wallet phantom --auto-approve
 *
 * Options:
 *   --wallet <name>          label for the report and the profile folder (required)
 *   --base <url>             lab origin, default http://localhost:3000 (localhost only)
 *   --profile <dir>          browser profile, default e2e/__wallet-profiles__/<wallet>
 *   --channel chrome         use installed Google Chrome instead of Playwright's Chromium
 *   --extension <dir>        also load an unpacked extension folder (optional)
 *   --wallet-tab home.html   open the wallet's own page in a tab so its requests show there (MetaMask uses Chrome's side panel otherwise)
 *   --extension-id <id>      which extension --wallet-tab opens (default: the profile's only extension)
 *   --wait-unlock            pause after opening the lab until you unlock the wallet and press Enter (MetaMask locks on every browser start)
 *   --compat                 drop Playwright's automation defaults (background networking off, mock keychain, automation flag) for wallets that hang (MetaMask)
 *   --sizes 2,5,12,20,30     Solana "Sign all" batch sizes (stops at the first failing size)
 *   --tests sol,send,sas,evm,reject   which groups to run (default sol,evm); send = S5 send signed, sas = S6 sign-and-send, reject = S7;
 *                            evmfree = E1 capabilities + count the EVM batch confirmation, then reject (no gas, no --allow-send needed)
 *   --chains base,arbitrum,polygon,bnb   EVM chains for E2-E4 (E1 capabilities also runs on ethereum)
 *   --evm-sizes 5,10,12      EVM batch sizes (MetaMask refuses more than 10 calls)
 *   --allow-send             required for every test that broadcasts (send, sas, evm calls); costs a few cents
 *   --auto-approve           click the wallet's Approve button (only during a lab action, capped per run)
 *   --approve "<regex>"      override the Approve button text pattern
 *   --reject "<regex>"       override the Reject button text pattern
 *   --solana-network devnet  run the Solana tests on devnet (free faucet SOL; switch the wallet to devnet too). Default mainnet.
 *   --out <dir>              default e2e/__wallet-lab__
 *
 * Safety: refuses any base that is not localhost; never approves outside a running lab action; at most n + 2 approvals per run; never approves a
 * "connect" request; broadcasting tests need --allow-send. Use a fresh test seed with tiny balances (runbook §1). Nothing secret is read or written
 * by this script: the seed lives only inside the wallet extension in the test profile.
 */
import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const list = (n, d) => arg(n, d).split(",").map((s) => s.trim()).filter(Boolean);

const wallet = arg("wallet");
if (!wallet) { console.error("--wallet <name> is required"); process.exit(1); }
const base = arg("base", "http://localhost:3000");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) { console.error("Refusing: --base must be a localhost origin (the lab never runs in production)."); process.exit(1); }
const profile = resolve(arg("profile", join("e2e", "__wallet-profiles__", wallet.toLowerCase().replace(/[^a-z0-9-]/g, "-"))));
const outDir = resolve(arg("out", join("e2e", "__wallet-lab__")));
const extension = arg("extension");
const channel = arg("channel");
const sizes = list("sizes", "2,5,12,20,30").map(Number);
const evmSizes = list("evm-sizes", "5,10,12").map(Number); // 10 = MetaMask's batch ceiling; 12 shows whether a wallet goes past it
const tests = new Set(list("tests", "sol,evm"));
const chains = list("chains", "base,arbitrum,polygon,bnb");
const allowSend = flag("allow-send");
const solanaNetwork = arg("solana-network", "mainnet");
if (!["mainnet", "devnet"].includes(solanaNetwork)) { console.error("--solana-network must be mainnet or devnet"); process.exit(1); }
const autoApprove = flag("auto-approve");
const APPROVE = new RegExp(arg("approve", "^(confirm|approve|sign|sign all|approve all|confirm all|submit)$"), "i");
const REJECT = new RegExp(arg("reject", "^(reject|cancel|deny|decline|reject all)$"), "i");
/**
 * Screens we never approve automatically: anything that changes the account itself (EIP-7702 smart-account upgrade, adding a network, exporting keys).
 * Connection requests need no rule: their button ("Connect") is not in APPROVE.
 */
const NEVER = /upgrade|smart account|add network|add a network|switch account|export|reveal|recovery phrase|secret phrase|private key/i;
/** Network-switch prompts (no funds move): accepted automatically so a test is not aborted by them. */
const SWITCH = /allow this site to switch|switch (the )?network\?|switch to .{1,40} network|change network/i;
const SWITCH_OK = /^(switch network|switch|approve|confirm|allow)$/i;

mkdirSync(profile, { recursive: true });
mkdirSync(outDir, { recursive: true });
/** Playwright defaults dropped by --compat: extensions off, automation banner, background networking, fake keychain and password store, component and sync limits. */
const COMPAT_DROP = ["--disable-extensions", "--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-component-update", "--disable-default-apps", "--disable-sync", "--password-store=basic", "--use-mock-keychain", "--no-service-autorun", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
// Imported after the argument and safety checks, so a bad --base is refused before a browser can start.
const { chromium } = await import("@playwright/test");

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, // wallet extensions do not run headless
  channel,
  viewport: { width: 1280, height: 900 },
  // Playwright passes --disable-extensions by default; drop it so wallets installed in this profile load.
  // --compat also drops the automation defaults that can leave a wallet's background process or unlock flow spinning (seen with MetaMask).
  ignoreDefaultArgs: flag("compat") ? COMPAT_DROP : ["--disable-extensions"],
  args: extension ? [`--disable-extensions-except=${resolve(extension)}`, `--load-extension=${resolve(extension)}`] : [],
});
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const lab = ctx.pages()[0] ?? await ctx.newPage();

if (flag("setup")) {
  await lab.goto("https://chromewebstore.google.com/");
  const second = await ctx.newPage();
  await second.goto(`${base}/dev/wallet-lab`).catch(() => {});
  console.log([
    `Setup for "${wallet}" (profile ${profile}):`,
    "  1. Install the wallet from the Chrome Web Store tab (official listing only).",
    "  2. In the wallet: import the TEST seed phrase. Turn auto-approve / auto-confirm OFF.",
    "  3. In the lab tab: Connect or switch wallet → pick the wallet for Solana and for EVM.",
    "  4. Close the browser window when done.",
    "  If the Web Store will not install into this browser, rerun setup and every run with --channel chrome (uses your installed Google Chrome, separate profile).",
  ].join("\n"));
  await new Promise((r) => ctx.on("close", r));
  process.exit(0);
}

// ---------- confirmation-screen watcher ----------
/** One measurement window: counts extension windows opened and Approve screens seen (hidden → visible transitions), and clicks when allowed. */
function watch({ cap, mode }) {
  const state = { windows: 0, screens: 0, clicks: 0, rejected: 0, skipped: [], stop: false };
  const seen = new WeakMap(); // page → { visible, since, clicked }: Approve button state on the last poll
  const isWallet = (p) => p.url().startsWith("chrome-extension://");
  const onPage = (p) => { if (isWallet(p)) state.windows++; };
  ctx.on("page", onPage);
  const loop = (async () => {
    while (!state.stop) {
      for (const p of ctx.pages().filter((x) => isWallet(x) && !x.isClosed())) {
        try {
          const text = (await p.locator("body").innerText({ timeout: 500 }).catch(() => "")).slice(0, 4000);
          // A network-switch prompt moves no funds and is not an approval screen: accept it in every mode, never count it.
          if (SWITCH.test(text) && !NEVER.test(text)) { // an "add network" prompt still waits for the human
            const ok = p.getByRole("button", { name: SWITCH_OK }).last();
            if (await ok.isVisible().catch(() => false) && await ok.isEnabled().catch(() => false)) { await ok.click().catch(() => {}); state.switches = (state.switches ?? 0) + 1; }
            continue;
          }
          const approve = p.getByRole("button", { name: APPROVE }).last();
          const visible = await approve.isVisible({ timeout: 50 }).catch(() => false);
          const enabled = visible && await approve.isEnabled().catch(() => false);
          // A new screen = the Approve button reappears after being gone for at least 1 s (a wallet redrawing while it simulates is not a new screen).
          // The first appearance in a window always counts (the button often renders a moment after the window opens).
          const last = seen.get(p);
          if (visible && !last?.visible && (!last?.everVisible || Date.now() - last.since >= 1000 || last.clicked)) state.screens++;
          if (!last || last.visible !== visible) seen.set(p, { visible, since: Date.now(), clicked: false, everVisible: !!last?.everVisible || visible });
          if (!visible) continue;
          if (!state.buttons) state.buttons = (await p.getByRole("button").allInnerTexts().catch(() => [])).map((b) => b.trim()).filter(Boolean).slice(0, 12);
          if (mode === "reject") {
            // Rejecting never waits for Approve to become clickable (wallets keep it disabled while simulating, or for good when simulation fails).
            if (state.rejected === 0) {
              const reject = p.getByRole("button", { name: REJECT }).last();
              // No matching Reject button: closing the wallet's popup is a rejection in every wallet we know of.
              if (await reject.isVisible().catch(() => false)) { await reject.click(); state.rejectedBy = "button"; } else { await p.close(); state.rejectedBy = "closed popup"; }
              seen.set(p, { visible: false, since: Date.now(), clicked: true, everVisible: true });
              state.rejected++;
            }
            continue; // never approve in a reject run
          }
          if (!enabled) continue;
          if (NEVER.test(text)) { if (!state.skipped.includes(p)) state.skipped.push(p); continue; } // left for the human to decline
          if (mode === "approve" && state.clicks < cap) {
            await p.waitForTimeout(400); // let the wallet finish simulating
            await approve.click({ timeout: 2000 }).catch(() => {});
            state.clicks++;
            seen.set(p, { visible: false, since: Date.now(), clicked: true, everVisible: true }); // the next Approve after a click is a new screen
          }
        } catch { /* window closed mid-poll */ }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  return { state, done: async () => { state.stop = true; await loop; ctx.off("page", onPage); return { windows: state.windows, screens: state.screens, clicks: state.clicks, rejected: state.rejected, rejectedBy: state.rejectedBy, switches: state.switches ?? 0, skipped: state.skipped.length, walletButtons: state.buttons } } };
}

// ---------- lab helpers ----------
const rows = () => lab.locator("table tbody tr").count();
const lastRowText = async () => (await lab.locator("table tbody tr").last().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
/** The lab's note after "Send signed": "Sent N s after building: x accepted by the RPC …, y expired, z failed". */
const sendNote = async () => (await lab.getByText(/^Sent \d+ s after building/).innerText({ timeout: 15_000 }).catch(() => "")).trim();

async function setSize(n) { await lab.getByLabel("Batch size").selectOption(String(n)); }
async function setChain(c) { await lab.getByLabel("Chain").selectOption(c); }
async function setSend(on) {
  const box = lab.getByLabel(/Allow anything that broadcasts/);
  if ((await box.isChecked()) !== on) await box.click();
}

/** Clicks a lab button, measures the wallet while the lab is busy, waits for the new result row, and fills the popup count for Solana rows. */
async function run(label, button, { n, mode = autoApprove ? "approve" : "count", family }) {
  const before = await rows();
  const w = watch({ cap: n + 2, mode });
  const t0 = Date.now();
  await button.click();
  await lab.waitForFunction((b) => document.querySelectorAll("table tbody tr").length > b, before, { timeout: 180_000 }).catch(() => {});
  const m = await w.done();
  const row = await lastRowText();
  if (family === "solana" && (await rows()) > before) {
    const input = lab.getByLabel("How many popups did you see?");
    if (await input.isVisible().catch(() => false)) await input.fill(String(m.screens));
  }
  const result = { test: label, n, ms: Date.now() - t0, ...m, labRow: row };
  console.log(`${label.padEnd(28)} n=${String(n).padEnd(3)} screens=${m.screens} windows=${m.windows} clicks=${m.clicks}  ${row}`);
  return result;
}

const btn = (name) => lab.getByRole("button", { name });
const results = [];
const failed = (r) => /\b(error|unsupported|rejected)\b/.test(r.labRow);

await lab.goto(`${base}/dev/wallet-lab`, { waitUntil: "domcontentloaded" });
if (await lab.getByText("This page isn't here").isVisible().catch(() => false)) { console.error("Lab returned 404: set NEXT_PUBLIC_WALLET_LAB=1 and restart the web dev server."); await ctx.close(); process.exit(1); }
await lab.getByText("Wallet batch-signing lab").waitFor({ timeout: 30_000 });
await lab.waitForTimeout(3000); // wallets announce themselves and AppKit restores the connection
const walletTab = arg("wallet-tab"); // e.g. "home.html" for MetaMask, whose requests otherwise open in Chrome's side panel (invisible to Playwright)
if (walletTab) {
  // The wallet is the only extension in this profile (setup installs one), so its id comes from its MV3 service worker.
  if (!ctx.serviceWorkers().length) await ctx.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => {});
  const ids = [...new Set(ctx.serviceWorkers().map((w) => w.url().match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1]).filter(Boolean))];
  const id = arg("extension-id") ?? ids[0];
  if (!id) console.log("--wallet-tab: no extension service worker found yet; pass --extension-id <32 letters> (chrome://extensions → Developer mode).");
  else {
    if (ids.length > 1 && !arg("extension-id")) console.log(`--wallet-tab: several extensions (${ids.join(", ")}); using ${id}. Pass --extension-id to choose.`);
    const tab = await ctx.newPage();
    await tab.goto(`chrome-extension://${id}/${walletTab}`).catch((e) => console.log(`--wallet-tab: could not open the wallet page (${e.message})`));
    await lab.bringToFront();
    console.log(`Wallet page open in a tab (${walletTab}): requests should appear there instead of the side panel. Unlock it there.`);
  }
}
if (flag("wait-unlock")) {
  // Most wallets lock when the browser restarts (MetaMask always does): requests to a locked wallet fail at once, so let the human unlock first.
  console.log("Unlock the wallet now (open it from the extensions toolbar, use your password), then press Enter here to start…");
  await new Promise((r) => process.stdin.once("data", () => { process.stdin.pause(); r(); })); // pause so stdin does not keep the process alive
}
const status = () => lab.getByText(/Solana: .* · EVM: .*/).innerText().catch(() => "");
const needSol = ["sol", "send", "sas", "reject"].some((x) => tests.has(x));
const ready = (s) => (!needSol || /Solana: (?!not connected)/.test(s)) && (!(tests.has("evm") || tests.has("evmfree")) || /EVM: (?!not connected)/.test(s));
let connected = await status();
if (!ready(connected)) {
  // AppKit may still be restoring the session, or the wallet was never connected in this profile: give the human time to connect it.
  console.log(`Not connected yet (${connected || "no status"}). In the browser: "Connect or switch wallet" → pick the wallet${needSol ? " for Solana" : ""}${tests.has("evm") || tests.has("evmfree") ? " and for EVM" : ""}. Waiting up to 2 minutes…`);
  const until = Date.now() + 120_000;
  while (Date.now() < until && !ready(connected)) { await lab.waitForTimeout(2000); connected = await status(); }
  await lab.waitForTimeout(1000);
  connected = await status();
}
const features = await lab.locator("text=Connected wallets").locator("..").locator("li").allInnerTexts().catch(() => []);
console.log(`Wallet: ${wallet} | ${connected}`);
console.log(`Wallet Standard: ${features.join(" | ") || "none announced"}`);
if (!autoApprove) console.log("Counting only: approve each request in the wallet yourself (add --auto-approve to let the script click).");

// ---------- Solana ----------
const solanaTests = ["sol", "send", "sas", "reject"].some((t) => tests.has(t));
if (solanaTests && /Solana: (?!not connected)/.test(connected)) {
  await setSend(false);
  const wanted = solanaNetwork === "devnet" ? "Devnet" : "Mainnet";
  if (!(await lab.getByText(`Solana network: ${wanted}`, { exact: false }).isVisible().catch(() => false))) {
    await btn(solanaNetwork === "devnet" ? "Use devnet" : "Use mainnet").click();
    await lab.getByText(new RegExp(`Solana network:\\s*${wanted}`)).waitFor({ timeout: 20_000 }).catch(() => {});
  }
  console.log(`Solana network: ${await lab.getByText(/Solana network:/).innerText().catch(() => "unknown")}`);
  if (tests.has("sol")) {
    await setSize(5);
    results.push(await run("S2 sign one by one", btn("Sign one by one"), { n: 5, family: "solana" }));
    for (const n of sizes) {
      await setSize(n);
      const r = await run("S3/S4 sign all", btn("Sign all"), { n, family: "solana" });
      results.push(r);
      if (failed(r)) break; // the first failing size is the wallet's limit
    }
  }
  if (tests.has("send")) {
    if (!allowSend) console.log("S5 skipped: needs --allow-send");
    else {
      await setSize(12);
      results.push(await run("S5 sign all (for send)", btn("Sign all"), { n: 12, family: "solana" }));
      await setSend(true);
      await btn(/^Send signed/).click();
      const sent = await sendNote();
      console.log(`S5 send signed               ${sent || "no result shown within 15 s"}`);
      results.push({ test: "S5 send signed", n: 12, labRow: await lastRowText(), note: sent });
      await setSend(false);
    }
  }
  if (tests.has("sas")) {
    if (!allowSend) console.log("S6 skipped: needs --allow-send");
    else {
      await setSize(5);
      await setSend(true);
      results.push(await run("S6 sign and send", btn(/^Sign and send/), { n: 5, family: "solana" }));
      await setSend(false);
    }
  }
  if (tests.has("reject")) {
    await setSize(5);
    results.push(await run("S7 sign all, reject", btn("Sign all"), { n: 5, family: "solana", mode: "reject" }));
  }
} else if (solanaTests) console.log("Solana tests skipped: no Solana wallet connected in the lab.");

// ---------- EVM ----------
const evmFree = tests.has("evmfree");
if ((tests.has("evm") || evmFree) && /EVM: (?!not connected)/.test(connected)) {
  for (const c of ["ethereum", ...chains]) {
    await setChain(c);
    results.push({ ...(await run(`E1 capabilities ${c}`, btn("Capabilities"), { n: 0, family: "evm" })), chain: c });
    if (c === "ethereum") continue; // the lab never sends on Ethereum
    if (evmFree) {
      // Free: ask for the batch, count the confirmation screen(s), then reject, so nothing is sent and no gas is paid.
      // The box only enables the lab's button; reject mode never approves, and an unmatched Reject button closes the popup instead.
      await setSend(true);
      for (const n of evmSizes) {
        await setSize(n);
        const r = { ...(await run(`E2 free ${n} calls ${c}`, btn(/^Send \d+ (self-calls|harmless calls)$/), { n, family: "evm", mode: "reject" })), chain: c };
        results.push(r);
        if (/\bunsupported\b/.test(r.labRow)) break;
      }
      await setSend(false);
      continue;
    }
    if (!allowSend) { console.log(`E2-E4 on ${c} skipped: needs --allow-send (or use --tests evmfree to count popups and reject, at no cost)`); continue; }
    await setSend(true);
    for (const n of evmSizes) {
      await setSize(n);
      const r = { ...(await run(`E2/E3 ${n} calls ${c}`, btn(/^Send \d+ (self-calls|harmless calls)$/), { n, family: "evm" })), chain: c };
      results.push(r);
      if (failed(r)) break;
    }
    results.push({ ...(await run(`E4 reverting call ${c}`, btn(/^Send with a reverting call/), { n: 3, family: "evm" })), chain: c });
    await setSend(false);
  }
} else if (tests.has("evm") || evmFree) console.log("EVM tests skipped: no EVM wallet connected in the lab.");

// ---------- export ----------
let labJson = "";
if ((await rows()) > 0) { // with no rows the button is disabled and the clipboard holds whatever was there before
  await lab.evaluate(() => navigator.clipboard.writeText("")).catch(() => {});
  await btn("Copy JSON").click().catch(() => {});
  await lab.waitForTimeout(300);
  labJson = await lab.evaluate(() => navigator.clipboard.readText()).catch(() => "");
}
const file = join(outDir, `${wallet.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
// The lab scrubs addresses from its JSON; scrub our own row text the same way before writing.
const scrub = (s) => String(s ?? "").replace(/0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/g, "<addr>");
writeFileSync(file, JSON.stringify({
  wallet, connected: scrub(connected), walletStandard: features.map(scrub), solanaNetwork, autoApprove, allowSend, when: new Date().toISOString(),
  results: results.map((r) => ({ ...r, labRow: scrub(r.labRow), note: r.note ? scrub(r.note) : undefined })),
  labJson: (() => { try { return JSON.parse(labJson); } catch { return scrub(labJson); } })(),
}, null, 2));
console.log(`\nSaved ${file}\nPaste it into docs/engineering/INTEGRATION-AUDIT.md (Batch signing, P0) and fill the record row (runbook §6).`);
await ctx.close();
