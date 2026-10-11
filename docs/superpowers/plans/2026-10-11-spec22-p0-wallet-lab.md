# Spec 22 P0 — Wallet Batch-Signing Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only web page plus a read-only LI.FI script that let the user measure, on mainnet with their own wallets and tiny amounts, how each wallet handles batched Solana signing and EIP-5792 `wallet_sendCalls`. The output is the tier matrix, K per tier, signing time for a 12-transaction batch, and whether B-07 (sign-and-send batching) is needed.

**Architecture:**
- A client-only Next.js page at `/dev/wallet-lab`, behind `NEXT_PUBLIC_WALLET_LAB=1` (`notFound()` otherwise). It builds its own harmless transactions:
  - Solana: memo-only, the user as fee payer, 5 000 lamports each when sent.
  - EVM: zero-value self-calls, plus one deliberately reverting call.
- It calls the wallet through the existing Reown AppKit providers and wagmi actions, times each step, and outputs JSON the user pastes into `docs/engineering/INTEGRATION-AUDIT.md`.
- No API changes. Pure helpers live in one file with unit tests.
- A separate read-only API script asks LI.FI (real key) for user-fee-payer Solana quotes and direct routes, and prints their shape. It never signs or sends.

**Tech Stack:** Next.js 16 App Router, Reown AppKit 1.8.24 (`@reown/appkit-adapter-solana/react` `useAppKitConnection`, `appKit.getProvider("solana")`), `@solana/web3.js` 1.99.0, wagmi 2.19.5 (`getCapabilities`, `sendCalls`, `waitForCallsStatus` from `wagmi/actions`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-batched-signing-direct-routes-design.md` (§13 P0, §5.1, §15 Q2)

## Global Constraints

- **No new dependencies.** Versions stay pinned exactly: `@solana/web3.js` 1.99.0, wagmi 2.19.5, `@reown/*` 1.8.24. Never add pnpm `minimumReleaseAgeExclude`.
- **Never in production:**
  - The page renders only when `process.env.NEXT_PUBLIC_WALLET_LAB === "1"`, otherwise `notFound()`.
  - It is never linked from navigation.
  - `.env.example` documents the flag with value empty.
- **The page never sends anything by itself.**
  - "Send" is a separate button per run, defaulting to off.
  - Every run says what it costs: "N × 0.000005 SOL" or "N calls on <chain>, gas from your wallet".
- **Harmless transactions only.**
  - Solana: one Memo instruction (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`), data `bytesac-lab <runId> <i>/<n>`, fee payer = the connected address.
  - EVM: `{ to: <own address>, value: 0n, data: "0x" }`. The revert case is `{ to: <USDC on that chain>, data: "0xdeadbeef" }`.
- **Batch sizes:** 2, 5, 10, 12, 20, 30. The 12-transaction run is the timing reference (user request 2026-10-11).
- **No addresses in the exported JSON.** Wallet name, tier, counts and timings only.
- **The LI.FI script is read-only:** quotes, estimates and `/v1/tools` only. Never `svmSponsor`, never signing, never broadcasting.
- **Git:**
  - Work on branch `feat/spec22-p0-wallet-lab`, cut from `spec/batched-signing`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never stage `.claude/settings.json`, `.gitignore`, `apps/api/.env.example` (the user's own edits), generated `apps/*/AGENTS.md`, or anything under `.superpowers/`.
- **Python is not installed.** Edit with Edit/Write or `node -e`. Files are CRLF.

## Review Focus

1. **Wallet returns a different message (rewrites ComputeBudget or the fee payer).** The lab must report `rewritten: true`, plus whether only ComputeBudget changed, instead of assuming identity. Test in Task 1 (`compareSigned`).
2. **Wallet returns fewer signed transactions than requested, or in a different order.** Report a count mismatch and an order check by memo text. Test in Task 1 (`compareSigned` over a shuffled array).
3. **Wallet throws "method not supported" versus the user rejecting.** Both must land in the result as distinct outcomes (`unsupported` / `rejected`), never as a crash. Test in Task 1 (`classifyWalletError`).
4. **Blockhash expires while the user is in the wallet.** The send step records `isBlockhashValid` for each transaction at send time and the elapsed time since build. A stale one is recorded as `expired` and not sent. Test in Task 1 (`sendPlan`).
5. **The flag is unset in a production build.** The page answers 404. Test in Task 1 (page module returns `notFound`).

---

### Task 1: Wallet lab page and helpers

**Files:**
- Create: `apps/web/lib/wallet-lab.ts` (pure helpers, no React)
- Create: `apps/web/app/dev/wallet-lab/page.tsx` (server component: flag check, renders the client lab)
- Create: `apps/web/components/dev/wallet-lab.tsx` (`"use client"`; runs and results)
- Create: `apps/web/test/wallet-lab.test.ts`
- Modify: `apps/web/.env.example` (add `NEXT_PUBLIC_WALLET_LAB=` with the comment `# 1 = dev-only /dev/wallet-lab (Spec 22 P0); never set in production`)

**Interfaces:**
- Produces, in `apps/web/lib/wallet-lab.ts`:
  - `MEMO_PROGRAM_ID: PublicKey`
  - `LAB_BATCH_SIZES = [2, 5, 10, 12, 20, 30] as const`
  - `USDC_BY_CHAIN: Record<"ethereum" | "base" | "arbitrum" | "polygon" | "bnb", \`0x${string}\`>`
  - `buildMemoBatch(i: { payer: PublicKey; blockhash: string; n: number; runId: string }): VersionedTransaction[]`
  - `compareSigned(sent: VersionedTransaction[], got: VersionedTransaction[]): { count: number; expected: number; inOrder: boolean; rewritten: number; onlyComputeBudget: boolean; feePayerChanged: boolean }`
  - `classifyWalletError(err: unknown): "rejected" | "unsupported" | "error"`
  - `sendPlan(i: { builtAt: number; now: number; valid: boolean[] }): ("send" | "expired")[]` (once one transaction is expired, every later one is `expired` too: the same rule as P1)
  - `standardWalletFeatures(timeoutMs?: number): Promise<{ name: string; features: string[] }[]>` (Wallet Standard discovery through the `wallet-standard:app-ready` / `wallet-standard:register-wallet` events, without the `@wallet-standard/app` package)
  - `LabResult` type: `{ family: "solana" | "evm"; wallet: string; mode: "sign_all" | "sign_and_send" | "single" | "evm_calls"; chain: string; n: number; outcome: "ok" | "rejected" | "unsupported" | "error"; msToReturn: number | null; popupsReported: number | null; compare?: ReturnType<typeof compareSigned>; sent?: { ok: number; expired: number; failed: number }; evm?: { capabilities: unknown; receipts: number; distinctTxTo: number; revertedCall: "stopped" | "continued" | "n/a" } }`

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/wallet-lab.test.ts`:

```ts
import { ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { buildMemoBatch, classifyWalletError, compareSigned, MEMO_PROGRAM_ID, sendPlan } from "@/lib/wallet-lab";

const payer = Keypair.generate();
const BH = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const batch = (n = 3) => buildMemoBatch({ payer: payer.publicKey, blockhash: BH, n, runId: "r1" });

describe("wallet lab helpers", () => {
  it("builds n memo-only transactions paid by the user", () => {
    const txs = batch(3);
    expect(txs).toHaveLength(3);
    for (const [i, tx] of txs.entries()) {
      expect(tx.message.staticAccountKeys[0]!.equals(payer.publicKey)).toBe(true);
      expect(tx.message.compiledInstructions).toHaveLength(1);
      expect(tx.message.staticAccountKeys[tx.message.compiledInstructions[0]!.programIdIndex]!.equals(MEMO_PROGRAM_ID)).toBe(true);
      expect(Buffer.from(tx.message.compiledInstructions[0]!.data).toString()).toBe(`bytesac-lab r1 ${i + 1}/3`);
    }
  });

  it("reports identical, ComputeBudget-only rewrites, fee-payer changes, short and shuffled returns", () => {
    const sent = batch(3);
    expect(compareSigned(sent, sent)).toMatchObject({ count: 3, expected: 3, inOrder: true, rewritten: 0, feePayerChanged: false });
    const padded = sent.map((tx) => new VersionedTransaction(new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: BH,
      instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }), ...TransactionMessage.decompile(tx.message).instructions],
    }).compileToV0Message()));
    expect(compareSigned(sent, padded)).toMatchObject({ rewritten: 3, onlyComputeBudget: true, feePayerChanged: false });
    const other = Keypair.generate().publicKey;
    const payerSwap = sent.map((tx) => new VersionedTransaction(new TransactionMessage({ payerKey: other, recentBlockhash: BH, instructions: TransactionMessage.decompile(tx.message).instructions }).compileToV0Message()));
    expect(compareSigned(sent, payerSwap)).toMatchObject({ feePayerChanged: true, onlyComputeBudget: false });
    expect(compareSigned(sent, sent.slice(0, 2))).toMatchObject({ count: 2, expected: 3 });
    expect(compareSigned(sent, [sent[2]!, sent[0]!, sent[1]!])).toMatchObject({ inOrder: false });
  });

  it("separates a user rejection from an unsupported method", () => {
    expect(classifyWalletError({ code: 4001, message: "User rejected the request." })).toBe("rejected");
    expect(classifyWalletError(new Error("signAllTransactions is not supported"))).toBe("unsupported");
    expect(classifyWalletError({ code: 4200, message: "Unsupported method" })).toBe("unsupported");
    expect(classifyWalletError(new Error("boom"))).toBe("error");
  });

  it("marks everything after the first stale blockhash as expired", () => {
    expect(sendPlan({ builtAt: 0, now: 10_000, valid: [true, false, true] })).toEqual(["send", "expired", "expired"]);
    expect(sendPlan({ builtAt: 0, now: 10_000, valid: [true, true] })).toEqual(["send", "send"]);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail.** `pnpm --filter web exec vitest run test/wallet-lab.test.ts < /dev/null`. Expected: FAIL, cannot resolve `@/lib/wallet-lab`.

- [ ] **Step 3: Implement `apps/web/lib/wallet-lab.ts`:**
  - `buildMemoBatch`: one `TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(\`bytesac-lab ${runId} ${i}/${n}\`) })` per transaction, compiled with `TransactionMessage(...).compileToV0Message()`.
  - `compareSigned`:
    - Compares `message.serialize()` bytes per index.
    - `onlyComputeBudget` is true when every differing transaction, after removing `ComputeBudget111111111111111111111111111111` instructions, has the same payer, the same remaining program ids and the same data.
    - `inOrder` is judged by the memo text.
    - `feePayerChanged` is true when any `staticAccountKeys[0]` differs.
  - `classifyWalletError`:
    - Code 4001, or a message matching `/reject|denied|cancel/i`, gives `rejected`.
    - Code 4200, -32601 or 4100, or a message matching `/not supported|unsupported|not implemented|not a function/i`, gives `unsupported`.
    - Anything else gives `error`.
  - `sendPlan`: walk `valid`; the first `false` makes that and every later entry `expired`. `builtAt` and `now` are carried only for display.
  - `standardWalletFeatures`: register listeners, dispatch `new CustomEvent("wallet-standard:app-ready", { detail: { register: (...wallets) => { collect } } })`, also listen for `wallet-standard:register-wallet` (call `event.detail({ register })`), resolve after `timeoutMs` (default 300) with `{ name, features: Object.keys(wallet.features) }`. A single comment cites the Wallet Standard repo's `register.ts` protocol.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS, 4 tests.

- [ ] **Step 5: Build the page and the lab component.**
  - `app/dev/wallet-lab/page.tsx`:

    ```tsx
    import { notFound } from "next/navigation";
    import { WalletLab } from "@/components/dev/wallet-lab";
    export const dynamic = "force-dynamic";
    export default function Page() {
      if (process.env.NEXT_PUBLIC_WALLET_LAB !== "1") notFound();
      return <WalletLab />;
    }
    ```

  - `components/dev/wallet-lab.tsx` sections:
    1. **Connected wallets:** the AppKit connect button, plus each wallet's `walletInfo.name` from `useAppKitAccount`, and its Wallet Standard features from `standardWalletFeatures()`.
    2. **Solana:**
       - A batch-size select (`LAB_BATCH_SIZES`) and three buttons: **Sign all** (`provider.signAllTransactions(txs)`), **Sign one by one** (`signTransaction` in a loop, counting popups) and **Sign and send (Wallet Standard)**. The last calls the connected wallet's `features["solana:signAndSendTransaction"].signAndSendTransaction(...inputs)` with every input `{ account, chain: "solana:mainnet", transaction: tx.serialize() }`, only when the feature exists; otherwise it records `unsupported`.
       - Timing: `performance.now()` around each wallet call gives `msToReturn`.
       - After signing, the user enters "How many popups did you see?" (number), stored as `popupsReported`.
       - A **Send signed** button (off by default):
         1. For each transaction, `isBlockhashValid(recentBlockhash)` through `useAppKitConnection().connection`.
         2. `sendPlan` decides which to send.
         3. Send each with `sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 })`.
         4. Record ok, expired and failed.
    3. **EVM:**
       - Chain select (base, arbitrum, polygon, ethereum, bnb).
       - **Capabilities:** `getCapabilities(config, { account, chainId })`, shown raw.
       - **Send N self-calls:** `sendCalls(config, { calls, atomicRequired: false })`, then `waitForCallsStatus(config, { id })`. Record `receipts.length` and the number of distinct `to` among the receipts' transactions; fetch each with `getTransaction`, where `to === account` signals EIP-7702.
       - **Send with a reverting call:** call 2 of 3 is `{ to: USDC_BY_CHAIN[chain], data: "0xdeadbeef" }`. Record whether call 3 still executed: `continued` or `stopped`.
       - Ethereum shows a warning: "Ethereum gas is expensive; prefer Base, Arbitrum or Polygon".
    4. **Results:**
       - A table of `LabResult` rows.
       - **Copy JSON**, which writes `JSON.stringify(rows, null, 2)` to the clipboard.
       - The notice: "No addresses are included. Paste into INTEGRATION-AUDIT.md §Batch signing (P0)."
  - Wallet errors go through `classifyWalletError`; the UI never throws.
  - Use the existing UI kit (`Button`, `Callout` from `@/components/ui`).

- [ ] **Step 6: Gate on web.** Run each command alone, one after another:

  ```
  pnpm --filter web lint < /dev/null
  pnpm --filter web check-types < /dev/null
  pnpm --filter web exec vitest run < /dev/null
  pnpm --filter web build < /dev/null
  ```

  Expected: all pass. The build lists `/dev/wallet-lab` as dynamic.

- [ ] **Step 7: Commit.**

  ```bash
  git add apps/web/lib/wallet-lab.ts apps/web/app/dev/wallet-lab/page.tsx apps/web/components/dev/wallet-lab.tsx apps/web/test/wallet-lab.test.ts apps/web/.env.example
  git commit -m "feat(web): dev-only wallet batch-signing lab (spec 22 P0)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

  (`apps/web/.env.example` is not on the never-stage list; `apps/api/.env.example` is.)

### Task 2: LI.FI read-only check, results home and user action

**Files:**
- Create: `apps/api/scripts/p0-lifi-check.ts`
- Modify: `apps/api/README.md` (one line under scripts: how to run it)
- Modify: `docs/engineering/INTEGRATION-AUDIT.md` (new section `## Batch signing (Spec 22 P0)` with empty result tables)
- Modify: `docs/OPEN-ITEMS.md` §1 (a user action: run the lab and the script, paste results)

**Interfaces:**
- Consumes:
  - `lifi.quote` / `lifi.estimate` from `apps/api/src/providers/routes/lifi.ts` (`LegQuoteInput` without `svmSponsor`).
  - `env` from `@/config/dotenv`.
- Produces: a console report only.

- [ ] **Step 1: Write the script.**
  - Run: `pnpm --filter api exec tsx --env-file-if-exists=.env scripts/p0-lifi-check.ts <solanaAddress> <evmAddress>`.
  - It runs:
    1. **Solana USDC → JUP** (`fromAmount` 1 USDC, `fromAddress` = the Solana argument, no `svmSponsor`), via `lifi.quote`:
       - Decode `transaction.serializedBase64`.
       - Print: fee payer equals `fromAddress`; `numRequiredSignatures`; serialized length; whether any signature slot other than index 0 is already filled (pre-signed by LI.FI); ComputeBudget limit and price; and `recentBlockhash`.
       - Then poll `connection.isBlockhashValid(recentBlockhash, { commitment: "confirmed" })` every 2 s, for at most 120 s, and print the seconds until it turns false. This is the real lifetime of a LI.FI blockhash after the quote, and it checks the 40 s `sendBy` and the 20-block margin. (`isBlockhashValid` returns only a boolean, so this lifetime cannot be read directly.)
       - On 1002 `SOL_REQUIRED`, print it and continue.
    2. **Solana USDC → ETH on Ethereum** (cross-chain), the same checks.
    3. **Direct routes** via `lifi.estimate` with no balance: Ethereum AAPLx-like ERC-20 (use the registry's first ACTIVE Ethereum ERC-20 deployment, read with `db`) → JUP on Solana, and JUP on Solana → native BTC. Print found or not, tool and `toAmountMin`.
    4. **Parallel quoting:** fire 12 `lifi.estimate` calls at once (USDC → 12 distinct ACTIVE Solana deployments, or fewer if the registry has fewer). Print wall time and any HTTP 429. This feeds spec §15 Q5.
  - It exits 0 even when individual checks fail, printing each failure.
  - A header comment says "read-only: never signs or sends".

- [ ] **Step 2: Type-check the script.** `pnpm --filter api check-types < /dev/null`. Expected: PASS. If `scripts/` sits outside the api tsconfig `include`, add `"scripts"` to `include`.

- [ ] **Step 3: Add the results home.** Append to `docs/engineering/INTEGRATION-AUDIT.md`:

  ```markdown
  ## Batch signing (Spec 22 P0)

  Filled in by the user from `/dev/wallet-lab` (JSON pasted below each table) and `scripts/p0-lifi-check.ts`. Decides K per tier, `sendBy` (40 s default) and whether B-07 is built.

  | Wallet | sign_all (n max) | ms for 12 | popups for 12 | rewrites | sign_and_send batch | single | Notes |
  |---|---|---|---|---|---|---|---|

  | Wallet | Chain | getCapabilities | sendCalls n | receipts / distinct `to` | revert behaviour | Notes |
  |---|---|---|---|---|---|---|

  | LI.FI check | Result |
  |---|---|
  | User fee payer quote (swap) | |
  | User fee payer quote (cross-chain) | |
  | Pre-signed by LI.FI? | |
  | Blockhash lifetime after quote (s), swap / cross-chain | |
  | ERC-20 → Solana token direct | |
  | Solana token → BTC direct | |
  | 12 parallel estimates (ms, 429s) | |
  ```

- [ ] **Step 4: Add the user action.** In `docs/OPEN-ITEMS.md` §1, add a line:

  > **Spec 22 P0 wallet lab (user action, mainnet, tiny amounts).** Set `NEXT_PUBLIC_WALLET_LAB=1` locally, open `/dev/wallet-lab`, and run every batch size with Phantom, Solflare, Backpack, MetaMask (Solana), Coinbase, Bitget, OKX and Trust (WalletConnect). On EVM, run MetaMask, Coinbase, Rabby, Phantom EVM, Trust and OKX on Base, Arbitrum and Polygon (Ethereum capabilities only). Run `scripts/p0-lifi-check.ts`. Paste the results into INTEGRATION-AUDIT §Batch signing (P0). Cost: about 0.000005 SOL per sent Solana transaction plus EVM gas for the calls.

- [ ] **Step 5: Full gate**, run in the background (it exceeds 10 minutes): `pnpm turbo run lint check-types test build --continue --concurrency=1 --force < /dev/null`. Expected: every task passes. A Windows `3221226505` crash in an api file is re-run alone.

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/api/scripts/p0-lifi-check.ts apps/api/README.md apps/api/tsconfig.json docs/engineering/INTEGRATION-AUDIT.md docs/OPEN-ITEMS.md
  git commit -m "chore(api): read-only LI.FI P0 check; P0 results home and user action

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

  (Stage `apps/api/tsconfig.json` only if Step 2 changed it.)

---

**After P0:** the user runs the lab. Their results set `K_SIGN_ALL`, `K_SIGN_AND_SEND`, `GROUP_SEND_WINDOW_MS` and the B-07 decision before P1 Task 3 is executed (P1 starts with the defaults 12 / 12 / 40 s and changes only constants).
