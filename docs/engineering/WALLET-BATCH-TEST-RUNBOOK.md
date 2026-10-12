# Wallet batch-signing test runbook (Spec 22 P0)

**Purpose:** measure, for the 20 most-used wallets, how many approval popups each one shows for a batch of transactions on every chain Bytesac signs on. The results decide each wallet's signing tier (`sign_all`, `sign_and_send`, `single`, `evm_calls`, `evm_single`) and the batch size K.

**Where the results go:** paste the lab's "Copy JSON" output plus the record row (§6) into `docs/engineering/INTEGRATION-AUDIT.md` under **"Batch signing (P0)"**.

**Tool:** the dev-only wallet lab at `http://localhost:3000/dev/wallet-lab`. It signs **memo-only** transactions (a text note, no funds move). No API or database is needed.

---

## 1. Safety rules (read first)

1. Use a **fresh test seed phrase created only for this**. Never import your main wallet.
2. Approve only requests coming from `localhost:3000`, and check that each Solana transaction's memo reads `bytesac-lab …`.
3. **Turn auto-approve / auto-confirm off** in every wallet that has it (Jupiter, Phantom Auto-Confirm, Backpack…). Otherwise the popup count is meaningless.
4. Keep "Allow anything that broadcasts" **off** until a step says to tick it.
5. Keep balances tiny (§2.3). When finished, sweep the leftovers back and remove the test seed from every wallet.

---

## 2. One-time setup (~45 min)

### 2.1 The lab
1. In `apps/web/.env` set `NEXT_PUBLIC_WALLET_LAB=1`, and keep `NEXT_PUBLIC_REOWN_PROJECT_ID`.
2. In the Reown dashboard, add `http://localhost:3000` to the project's allowed domains.
3. Start the web app only:
   ```bash
   pnpm --filter web dev
   ```
4. Open `http://localhost:3000/dev/wallet-lab`. You should see "Connected wallets", "Batch size", "Solana", "EVM (EIP-5792)" and "Results". The site header may show signed-out errors because the API isn't running; ignore them.

### 2.2 Browsers
- **One Chrome profile per wallet** (Chrome → profile icon → Add). Install only that wallet's extension in it. Several Solana wallets in one profile fight over the page; Jupiter can even pose as Phantom.
- **Brave Wallet** is tested in Brave. For every *other* wallet tested in Brave, first set `brave://settings/wallet` → Default Solana wallet **and** Default Ethereum wallet → **"Extensions (no fallback)"**.
- Mobile wallets over WalletConnect (Trust mobile, etc.): use the lab on desktop and scan the QR code from the Reown modal.

### 2.3 Funding: free by default
**Nothing in the free suite (§10) is sent, so it spends nothing.** The only catch is that some wallets refuse to *sign* without a balance:

| Wallet behaviour with 0 SOL | What to do |
|---|---|
| Signs anyway (Phantom, Solflare) | Test on mainnet with 0 SOL |
| Simulation fails and Confirm stays disabled (MetaMask) | Test on **Solana devnet**: switch the wallet to devnet, get free devnet SOL at faucet.solana.com, and run with `--solana-network devnet` (P0 showed Phantom identical on mainnet and devnet) |

EVM needs no gas for the free suite: the batch confirmation is counted and then rejected. With 0 gas a wallet may show a fee warning ("Review alert"), which doesn't matter.

**Only for the optional tests that broadcast** (`send`, `sas`, `evm`, Bitcoin §5, real investment §7): a fresh test seed with ~0.01 SOL and ~$1 of gas per EVM chain. A Solana address can differ between wallets for the same seed (derivation path), so check it in each wallet.

---

## 3. The 20 wallets and which tests apply

`S` = Solana tests (§4.1), `E` = EVM tests (§4.2), `B` = Bitcoin check (§5), `R` = real investment check (§7).

| # | Wallet | How to connect | S | E | B | R | Watch for |
|---|---|---|---|---|---|---|---|
| 1 | **Phantom** | Extension | ✅ | ✅ | ✅ | ✅ | Main candidate for 1 popup. Turn **Auto-Confirm off**. |
| 2 | **MetaMask** | Extension (turn on Solana in MetaMask) | ✅ | ✅ | if offered | ✅ | Already measured: one popup per transaction on Solana. Re-confirm and record the version. |
| 3 | **Solflare** | Extension | ✅ | – | – | ✅ | Main candidate for 1 popup |
| 4 | **Trust Wallet** (extension) | Extension | ✅ | ✅ | if offered | ✅ | |
| 5 | **Trust Wallet** (mobile) | WalletConnect QR | ✅ | ✅ | – | – | Does the session list `solana_signAllTransactions`? (see §4.1 step 1) |
| 6 | **Coinbase Wallet / Base App** | Extension | ✅ | ✅ | if offered | ✅ | Strong EIP-5792 support expected on EVM |
| 7 | **Binance Wallet** | Extension | ✅ | ✅ | if offered | optional | No public developer docs; this test is the only source |
| 8 | **OKX Wallet** | Extension | ✅ | ✅ | ✅ | optional | |
| 9 | **Bitget Wallet** | Extension | ✅ | ✅ | if offered | – | |
| 10 | **Backpack** | Extension | ✅ | if offered | – | – | Turn auto-approve off |
| 11 | **Jupiter Wallet** | Extension | ✅ | – | – | – | Run S **twice**: "Connect as Phantom" **off**, then **on**. Record the reported name each time. Auto-approve **off**. |
| 12 | **Exodus** | Extension | ✅ | ✅ | if offered | – | |
| 13 | **Rabby** | Extension | – | ✅ | – | – | EVM only |
| 14 | **SafePal** | Extension | ✅ | ✅ | – | – | |
| 15 | **TokenPocket** | Extension | ✅ | ✅ | – | – | Docs say batch signs one by one; confirm |
| 16 | **Brave Wallet** | Built into Brave (no other wallet extensions) | ✅ | ✅ | – | – | |
| 17 | **Zerion** | Extension | ✅ | ✅ | – | – | |
| 18 | **OneKey** | Extension | ✅ | ✅ | if offered | – | |
| 19 | **Rainbow** | Extension | – | ✅ | – | – | EVM only |
| 20 | **Uniswap Wallet** | Extension | first check | ✅ | – | – | First see whether it connects for Solana at all. If not, run E only. |
| + | **Ledger** (through Phantom and MetaMask) | Hardware, via the wallet | ✅ (n=2, 5 only) | ✅ (3 calls) | – | – | Expect one confirmation per transaction **on the device** |
| + | **Xverse, Leather, UniSat** | Extension | – | – | ✅ | – | Bitcoin only (§5) |

**Order:** Phantom → Solflare → MetaMask → Trust (extension, then mobile) → Coinbase → Binance → OKX → Backpack → Jupiter → Bitget → Exodus → Rabby → the rest. The top 6 matter most; if time runs short, stop after them.

---

## 4. Test script (~15 min per wallet)

Before each wallet: open its Chrome profile → lab page → **Connect or switch wallet** → choose the wallet (if it isn't listed, use "All wallets" or the WalletConnect QR).

### 4.1 Solana (S)

| Step | Do | Batch size | Record |
|---|---|---|---|
| S1 | Read **Connected wallets**: the reported name and its feature list | – | Name as reported. Has `solana:signTransaction`? Has `solana:signAndSendTransaction`? (For WalletConnect, note any error from S3 instead.) |
| S2 | Press **Sign one by one** | 5 | Popups (baseline, should be 5). Type the number into "How many popups did you see?" |
| S3 | Press **Sign all** | **2** | Popups; outcome; the detail column ("2/2 back, in order, 0 rewritten") |
| S4 | **Sign all** again at each size | **5, 12, 20, 30** | Popups at each size. **Stop increasing** at the first `error`, and record the detail text: that is the wallet's batch limit. |
| S5 | Tick **Allow anything that broadcasts**. Run **Sign all** at **12**, then press **Send signed** within ~30 s | 12 | The note line: "x accepted / y expired / z failed". Proves the signed transactions are valid and land. Costs ~0.00006 SOL. |
| S6 | Press **Sign and send** | 5 | Popups, and the detail ("sent 5 ok / …"). If `unsupported`, record that. |
| S7 | Press **Sign all** at 5 and **reject in the middle** (cancel at the 2nd or 3rd popup, or the single popup) | 5 | Did it return an error for all (good), or some signed transactions? Record the outcome. |

**What "good" looks like:** S3/S4 show **1 popup**, "in order, 0 rewritten" (or "ComputeBudget only"), and S5 shows all accepted. That wallet gets `sign_all` with K = the largest working size, capped at 12 until the time window allows more.

### 4.2 EVM (E), on each of Base, Arbitrum, Polygon, BNB Chain (plus Ethereum for E1 only)

Select the chain in the EVM panel for each run.

| Step | Do | Record |
|---|---|---|
| E1 | Press **Capabilities** (also on **Ethereum**) | In the JSON: `atomic.status` = `supported` / `ready` / missing, per chain |
| E2 | Tick **Allow anything that broadcasts**, set batch size **5**, press **Send 5 harmless calls** (zero-value USDC `decimals()` calls; Bytesac needs 2 calls per sell: approve + swap). In the free suite the script rejects the confirmation instead of sending | Popups. Detail: "N receipts, M distinct to, atomic / not atomic". Note "sent to your own address" (that means an EIP-7702 account). |
| E3 | Batch sizes **10** and **12**, press **Send N harmless calls** | Popups. Any `5740` (batch too large) in the detail: MetaMask refuses more than 10. |
| E4 | Press **Send with a reverting call** | Revert verdict: `continued` / `stopped` / `all_reverted` |

**What "good" looks like:** 1 popup, all receipts. That wallet gets `evm_calls` on that chain. If E1 shows nothing for a chain, or E2 errors `unsupported`, it gets `evm_single` there. Record each chain separately: a wallet can batch on Base and not on BNB.

---

## 5. Bitcoin check (B): Phantom, OKX, Xverse, Leather, UniSat

The lab doesn't test Bitcoin. A Bitcoin sell is always **one PSBT = one approval**, so we only confirm the wallet can sign Bytesac's PSBT at all. This needs the API running, and is done with step 7 or separately:
1. Link the wallet's Bitcoin address in the app (Add chain account).
2. Hold a tiny BTC position, or use the sell path on a test basket with BTC, and run **Sell**.
3. Record: did one popup appear, and did the server accept the signed PSBT (no `PSBT_MISMATCH`)?
4. Record whether the wallet offers a **segwit / Taproot** address. Legacy addresses are refused (D-074).

---

## 6. Record row (one per wallet)

Fill one row per wallet in `INTEGRATION-AUDIT.md`, below the pasted lab JSON:

```
| Wallet | Version | Browser/profile | Connect | Reported name | Sol features | S2 one-by-one (5) | S3 sign-all 2 | S4 5/12/20/30 | Max batch | Rewritten? | S5 sent ok/exp/fail | S6 sign&send (5) | S7 reject | E1 atomic per chain (eth/base/arb/pol/bnb) | E2 popups (5) | E3 popups (12)/5740? | E4 revert | Tier → | Notes |
```

Results of earlier runs are in `INTEGRATION-AUDIT.md` §Batch signing and Spec 22 §17.

---

## 7. Real investment check (R): top wallets only

Memo transactions are simpler than real LI.FI swaps. Wallets can show warnings, longer screens or a different popup count for real ones. For **Phantom, Solflare, MetaMask, Trust (extension) and Coinbase**:

1. Start the **API and database** as well as the web app (normal local setup), or use a preview deployment with real config.
2. Use a basket with **4 assets** (ideally 2 Solana tokens and 2 bridged EVM assets), and invest **~$2–5 USDC** from the test wallet (it needs USDC plus ~0.01 SOL).
3. Record:
   - Popups from Confirm to "all sent".
   - Seconds from Confirm to "all sent".
   - Any `GROUP_EXPIRED` / `QUOTE_STALE` / `TX_MISMATCH`.
   - Any wallet warning text ("transaction may fail", "unknown program"…).
   - The `group.quoted` log line: tier and wallet name.
4. For the 2 most-used wallets, also run one **sell** of one asset back to USDC.

---

## 8. Turning results into the wallet table

| Measured | Tier |
|---|---|
| Sign all = **1 popup**, transactions unchanged, sends land | `sign_all`, K = largest working size (≤ 12 for now) |
| Sign all = N popups, Sign and send = 1–2 | `sign_and_send` (add the wallet to `SIGN_AND_SEND_WALLETS`; none so far) |
| Both N popups (like MetaMask) | `sign_all` (same count; the server keeps fee-first and stop-on-failure). The review shows "approve each transaction". |
| Sign all `unsupported` or `error` at 2 | `single` |
| Sign all rewrites anything other than ComputeBudget, or changes the blockhash or fee payer | `single`, and report it (it would fail our `TX_MISMATCH` check) |
| EVM chain: 1 confirmation for the batch | `evm_calls` on that chain, at most 10 calls per group (MetaMask limit, D-131) |
| EVM chain: no capability, or errors | `evm_single` on that chain |

Untested wallets default to `sign_all` / `evm_single`, which at worst equals today's flow.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| Lab page shows 404 | `NEXT_PUBLIC_WALLET_LAB=1` isn't set, or the dev server wasn't restarted. The flag is never on in production (`app.bytesac.com`). |
| Wallet missing from the Connect modal | Use "All wallets" search, or WalletConnect QR. Check the extension is enabled in this profile. |
| Connect modal does nothing | Add `http://localhost:3000` to the Reown project's allowed domains; check the project id. |
| Wrong wallet opens (Brave, Jupiter-as-Phantom) | Separate Chrome profile; Brave default wallets set to "Extensions (no fallback)". |
| "Send signed" says expired | You waited more than ~60 s after signing. Sign again and send right away. |
| Sends fail with insufficient funds | That wallet's Solana address differs (§2.3). Fund it with 0.005 SOL. |
| EVM error `5710` | The wallet doesn't support batching on that chain. Record `evm_single` for that chain. |
| EVM error `5740` | The batch is too large for the wallet. Record the size; that's its EVM limit. |
| Wallet stuck on a loading or unlock spinner (MetaMask) | Add `--compat`; unlock with the password (not passkey) after `--wait-unlock` pauses. |
| Wallet requests open in Chrome's side panel (MetaMask) | The script can't see the side panel. Try `--wallet-tab home.html`; otherwise run that wallet by hand (§10). |
| EVM error "Expected a string matching ^0x[0-9a-f]+$" | The wallet refuses empty call data; the lab now sends USDC `decimals()` calls. Update the web app. |
| A wallet asks to "upgrade to smart account" | Record that it asked, and decline. Bytesac never requires the upgrade (`atomicRequired: false`). Rerun E2: does it still batch? |

---

## 10. Automated runs (`apps/web/e2e/wallet-lab-auto.mjs`)

The script drives the lab in a real browser with the wallet extension:
- It presses the lab buttons for every test in §4.
- It **counts the wallet's confirmation screens** (each time an Approve button appears) and the windows the wallet opens, and types the count into the lab.
- It saves the lab JSON plus the counts to `apps/web/e2e/__wallet-lab__/<wallet>-<time>.json` (git-ignored).

Run it from `apps/web`, with the web dev server running and `NEXT_PUBLIC_WALLET_LAB=1`:

```bash
node e2e/wallet-lab-auto.mjs --setup --wallet phantom
```
Setup runs once per wallet. It opens a separate browser profile (`e2e/__wallet-profiles__/phantom`, git-ignored). There you install the wallet from the Chrome Web Store, import the test seed, turn auto-approve off, connect it in the lab, and close the window. If the store won't install into Playwright's browser, add `--channel chrome` to setup and to every run.

```bash
node e2e/wallet-lab-auto.mjs --wallet phantom
```
Counting mode: you approve each request in the wallet yourself, and the script counts the screens.

```bash
node e2e/wallet-lab-auto.mjs --wallet phantom --tests sol,reject,evmfree --auto-approve
```
**Free suite (use this for every wallet): nothing is sent and no money is spent.** It covers:
- Solana: sign one by one, sign all at 2/5/12/20/30, and the reject test.
- EVM: reads capabilities on all 5 chains, then asks for a 5-, 10- and 12-call batch per chain, counts the confirmation and **rejects** it.

```bash
node e2e/wallet-lab-auto.mjs --wallet phantom --tests sol,send,sas,evm,reject --allow-send --auto-approve
```
Optional broadcasting suite (a few cents): it proves signed batches land, measures sign-and-send, and runs the EVM reverting-call test. Already proven once with Phantom.

**Options:**

| Option | Use |
|---|---|
| `--auto-approve` | The script clicks the wallet's Approve/Confirm button (test seed only) |
| `--solana-network devnet` | Solana tests on devnet (free faucet SOL); switch the wallet to devnet too |
| `--compat` | Drop Playwright's automation flags; needed for MetaMask to load at all |
| `--wait-unlock` | Pause after opening the lab until you unlock the wallet and press Enter (MetaMask locks on every browser start) |
| `--wallet-tab home.html` | Open the wallet's own page in a tab, for wallets whose requests go to Chrome's side panel |
| `--channel chrome` | Use installed Google Chrome instead of Playwright's Chromium |
| `--approve "<regex>"` / `--reject "<regex>"` | Button labels for wallets that use other words |
| `--sizes`, `--evm-sizes`, `--chains` | Batch sizes and EVM chains to test |

**MetaMask: run it by hand.** It shows requests only in Chrome's side panel, which Playwright can't read. Open `/dev/wallet-lab` in your normal browser and connect MetaMask.
- **EVM:** tick "Allow anything that broadcasts", pick a chain, press **Send 5 harmless calls**, count the confirmation screens ("Includes 5 transactions"), then **Cancel**.
- **Solana:** use devnet; press **Sign all** at each size, and type the popup count into the box.

**Notes:**
- **Safety:** the script refuses any non-localhost `--base`. It approves only while a lab action is running, at most n + 2 times per run. It never approves a smart-account upgrade, add-network or key-export screen (those wait for you). Tests that broadcast need `--allow-send`. Use only the test seed.
- **When Approve isn't found:** the default pattern matches buttons named Confirm / Approve / Sign / Sign all / Submit (never "Send": wallet home pages have a Send button). For a wallet with different labels, pass `--approve "^(your label)$"`; for S7, `--reject`.
- **Manual-only wallets:** hardware wallets, WalletConnect mobile and wallets needing an account login. Run §4 by hand for those.
- **Treat the first automated run of each wallet as supervised.** Watch it, and check that the counted screens match what you saw before trusting it unattended.

## 11. Suggested schedule

| Session | Wallets | Time |
|---|---|---|
| Setup | §2 | 45 min |
| Day 1 morning | Phantom, Solflare, MetaMask, Trust extension | ~1 h |
| Day 1 afternoon | Trust mobile, Coinbase, Binance, OKX, Bitget | ~1.5 h |
| Day 2 morning | Backpack, Jupiter (×2), Exodus, Rabby, SafePal | ~1.5 h |
| Day 2 afternoon | TokenPocket, Brave, Zerion, OneKey, Rainbow, Uniswap, Ledger | ~1.5 h |
| Day 3 | Bitcoin check (§5) + real investment check (§7) | ~2 h |
| Wrap-up | Fill the wallet table (§8), paste into INTEGRATION-AUDIT.md, sweep funds, remove the test seed | 30 min |
