# Spec 22 P1 — Batched First Investment and User-Paid Solana Gas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- On the website, a first investment is signed in Solana batches: one wallet approval per chunk of up to 12 transactions, fee first, charged per batch.
- The user pays Solana gas in SOL on every flow (web and mobile).
- A failure leaves the investment open with Continue, Raise slippage, Skip, Invest what's available, or Stop. It auto-stops after 24 h.

**Architecture:**
- A new `groups.service.ts` in `modules/operations` forms a signing group from the `PLANNED` Solana legs. It:
  1. Builds the group's fee transfer from per-leg fee shares.
  2. Quotes the legs in parallel (reusing the per-leg quote logic).
  3. On submit, verifies every user-signed transaction before claiming any.
  4. Claims them all under the operation lock.
  5. Sends the fee and waits for `confirmed`.
  6. Sends the buys in order, each gated by its real blockhash.
- The platform's Solana fee payer is no longer used for new legs (`gasPayer: "user_solana"`). Legs planned before this release keep the co-sign path until P4.
- Fees are recorded per charge (`operation_fee_charges`), and reports read charges.
- The web drives groups through a new `@repo/app-core` group signer. Mobile keeps the per-leg endpoints.

**Tech Stack:** Express 5, Drizzle (`@repo/db`), Zod (`@repo/validator`), `@solana/web3.js` 1.99.0, `@noble/curves` 2.4.0 (ed25519), BullMQ sweep, Next.js 16 + Reown AppKit 1.8.24, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-10-11-batched-signing-direct-routes-design.md` (§3 B-01, B-02, B-03, B-05, B-06, B-08, B-09, B-17, B-21, B-23; §5; §6.1–§6.3, §6.5; §8.1–§8.3, §8.5; §9; §10; §11; §12; §13 P1; §14)

## Global Constraints

**Values (verbatim from the spec):**
- `K_SIGN_ALL = 12`, `K_SIGN_AND_SEND = 12` (B-17). A group holds at most K transactions: K − 1 asset legs plus the fee when a fee is charged.
- `GROUP_SEND_WINDOW_MS = 40_000`: `sendBy = quotedAt + 40 s`. `sendBy` gates the submit (later means 409 `GROUP_EXPIRED`, nothing claimed) and caps the fee wait at `min(30 s, sendBy − now)`.
- **Per-leg send gate:** `isBlockhashValid(recentBlockhash, { commitment: "confirmed" })` is true **and** `getBlockHeight("confirmed") <= quoteBlockHeight + BLOCKHASH_LIFETIME_BLOCKS − BLOCKHASH_MARGIN_BLOCKS`, with `BLOCKHASH_LIFETIME_BLOCKS = 150` and `BLOCKHASH_MARGIN_BLOCKS = 20`. The first leg that fails, and every later leg, is released unsent with `lastError: "QUOTE_STALE"`.
- **SOL requirement:**
  - `need = Σ (5 000 × signatures + ceil(cuLimit × cuPrice / 1 000 000)) + Σ rent of accounts the user funds (2 039 280 lamports each) + native SOL sold + SOL_BUFFER_LAMPORTS`, where `SOL_BUFFER_LAMPORTS = 1_000_000n`.
  - A shortfall is 409 `SOL_REQUIRED` with `details: { lamportsRequired, lamportsHeld }` (string integers), checked at plan time and again at group quote.
- **Fee shares** (B-06):
  - Per kind, `floor(total × legBase / Σ legBase)`, with the remainder to the leg with the largest base (the first such leg on ties). Invest `legBase = amountIn`.
  - A group charges the uncovered shares of its legs. A kind summing to 0 is left out. Transfer order: network, manager, platform.
- **Network fee** for an invest plan is 0 (no platform gas). D-086's dust rule applies only to the operation total, as today.
- **Auto-stop:** a grouped invest needing action for 24 h (`INVEST_AUTO_STOP_HOURS = 24`) with nothing in flight is stopped: audit `operation.auto_stopped`, notice `execution_incomplete`.
- **Slippage:** 1–300 bps. Quote TTL 60 s.
- **Request limits:** `signed[]` holds 1..`K_SIGN_ALL` entries, each base64 decoding to at most 1232 bytes. `walletName` is at most 64 characters.

**Behaviour rules:**
- **Mobile and per-leg (B-21):** the per-leg endpoints stay. Every new Solana leg is `user_solana` there too. An operation that has any `operation_groups` row refuses per-leg quote and submit (409 `INVALID_TRANSITION`, "Continue this investment on the website."), and a group request is refused if any leg left `PLANNED` through the per-leg path.
- **Needs-action semantics** (stay `IN_PROGRESS`, then Continue or Stop) apply **only to operations that have groups**. Operations without groups keep today's terminal rules (PARTIAL/FAILED on a failed leg). This is a ruling to keep mobile unchanged.
- **Legacy legs:** `platform_fee_payer` legs (planned before this release) keep `svmSponsor`, `sponsorExposure`, `cosign` and Solana gas reservations unchanged until P4.
- **Never:**
  - Resend a transaction whose outcome is unknown.
  - Reuse old signed bytes.
  - Send from a BullMQ job (the send loop runs in the request, D-018).
  - Log wallet addresses with telemetry.

**Engineering rules:**
- **Dependencies:** none new. Pins: `@solana/web3.js` 1.99.0, `@noble/curves` 2.4.0 (`import { ed25519 } from "@noble/curves/ed25519.js"`), wagmi 2.19.5, `@reown/*` 1.8.24.
- **Database:** the runtime role has no DELETE. New tables get `GRANT SELECT, INSERT, UPDATE ... TO bytesac_api` and RLS `api_all`, as in `0014_lifi_hardening.sql`. Ledgers stay append-only.
- **Code style:**
  - Lean code (`ponytail`): no one-caller helpers, no wrappers around library calls.
  - Cross-module calls only through `*.service.ts`.
  - `test/no-cycles.test.ts` and `test/route-table.test.ts` stay green; update the snapshot only for the new paths.
- **Tests:**
  - Run in the foreground with stdin `< /dev/null`, one file at a time, never two suites at once.
  - Re-run a Windows `3221226505` crash alone.
  - Mocks only (`test/helpers/chain-mocks.ts`); never real wallets or funds.
- **Docs:** updated in place in Task 5 (ADR-023, register, domain doc, OPEN-ITEMS, HANDOFF). `docs/source/*` is never edited.
- **Git:**
  - Branch `feat/spec22-p1-invest`, cut from `spec/batched-signing` (after P0 merges into it, or from it directly).
  - Commit per task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never stage `.claude/settings.json`, `.gitignore`, `apps/api/.env.example`, `firebase-service-account.json`, root `AGENTS.md`, `apps/api/test/__snapshots__/route-table.test.ts.snap` line-ending noise (stage the snapshot only for real path changes), generated `apps/*/AGENTS.md`/`CLAUDE.md`, or `.superpowers/**`.
- **Environment:** Python is not installed (edit with Edit/Write or `node -e`; files are CRLF). Run `pnpm db:up` and `pnpm --filter @repo/db db:migrate` before API tests.

## Review Focus

1. **The wallet returns the signed batch in a different order, with a transaction missing, or with one we never quoted.** The server maps by `legId`, refuses the whole submit (nothing claimed, nothing sent) when the set differs from the group's quoted set, and never sends a transaction for a leg outside the group. Test in Task 3 (`submit refuses a missing, extra or foreign leg`).
2. **The same group is submitted twice at once (double click, two tabs).** Exactly one submit claims and sends; the other gets 409 and causes no second `sendRawTransaction`. Test in Task 3 (`concurrent submits send once`).
3. **The user's USDC changes between quote and submit, so the fee transaction fails preflight.** Every claim is released, no buy is sent, and the response is 503 `ROUTE_UNAVAILABLE`. Test in Task 3 (`fee preflight refusal sends no buy`).
4. **The wallet rewrites ComputeBudget (Phantom priority fee) on some transactions in the batch.** They are accepted. A wallet that changes the fee payer or any non-ComputeBudget instruction gets `TX_MISMATCH` for the whole group with nothing claimed. Test in Task 3 (`ComputeBudget-only rewrite accepted; payer change refused`).
5. **One leg's quote fails at group time (route gone, RWA no longer ALLOWED, LI.FI `SOL_REQUIRED`).** That leg is left out with its error and the rest of the group proceeds. If every leg fails, the first error is returned. A group whose only quotable content is the fee is not created. Test in Task 3 (`one failing leg is excluded`).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0025_signing_groups.sql` (+ `meta/`) | Groups table, leg and operation columns, `user_solana`, `operation_fee_charges` with backfill |
| `packages/db/src/schema/execution.ts` | `operationGroups`, `signingTier`, `groupStatus`, new leg and operation columns, `gasPayer` value |
| `packages/db/src/schema/fees.ts` | `operationFeeCharges` |
| `packages/validator/src/execution.ts` | Constants, `feeShares`, `approvalsEstimate`, group/continue schemas, view additions |
| `packages/validator/src/errors.ts` | `GROUP_EXPIRED` (409) |
| `packages/api-client/src/client.ts` | `requestGroup`, `submitGroup`, `continueOperation` |
| `apps/api/src/providers/solana-tx.ts` | `solanaCost`, `verifyUserSigned`, `buildFeeTransfer` with a payer, `blockhashUsable` |
| `apps/api/src/modules/operations/plan.service.ts` | User-paid quotes, SOL requirement, fee shares at invest |
| `apps/api/src/modules/operations/quote.service.ts` | Per-leg quote for `user_solana`; quoting extracted as `quoteAssetLeg` for reuse |
| `apps/api/src/modules/operations/submit.service.ts` | Per-leg submit for `user_solana` (verify, no co-sign) |
| `apps/api/src/modules/operations/groups.service.ts` (new) | `requestGroup`, `submitGroup`, the send loop |
| `apps/api/src/modules/operations/continue.service.ts` (new) | `continueOperation` |
| `apps/api/src/modules/operations/operations.service.ts` | View additions, grouped status recompute, cancel releases groups |
| `apps/api/src/modules/operations/operations.{route,controller}.ts` | New endpoints |
| `apps/api/src/modules/portfolio/tracking.service.ts` | Fee charges on settle, `fee_covered_by`, invest auto-stop sweep |
| `apps/api/src/modules/fees/fees.service.ts` | Earnings, revenue and reconciliation read charges |
| `apps/api/src/modules/rebalance/rebalance.service.ts` | User-paid Solana legs (no Solana reservation) |
| `apps/api/src/worker.ts` | Schedule `stopStalledInvests` in the existing 5-minute sweep |
| `packages/app-core/src/group-signer.ts` (new) | Reducer and runner for a Solana group |
| `packages/app-core/src/leg-signer.ts` | `Signer` gains optional `signSolanaAll` |
| `packages/app-core/src/error-copy.ts` | `GROUP_EXPIRED` copy; `SOL_REQUIRED` copy with the amount |
| `apps/web/lib/wallet/use-leg-signer.ts` | `signSolanaAll`, wallet name, tier detection |
| `apps/web/components/invest/invest-flow.tsx`, `group-progress.tsx` (new), `needs-action.tsx` (new), `open-operation-banner.tsx` (new) | Estimate-first review, prices strip, progress, needs action, Stop banners |
| Docs | ADR-023 (new), register, domain doc, ARCHITECTURE §4, OPEN-ITEMS, HANDOFF, FUTURE-PLANS |

---

### Task 1: Data model, contracts and pure money functions

**Files:**
- Create: `packages/db/migrations/0025_signing_groups.sql` and its `meta/` snapshot (generate the way `0022_per_chain_addresses.sql` was: `pnpm --filter @repo/db db:generate`, then append grants, RLS and the backfill by hand)
- Modify: `packages/db/src/schema/execution.ts`, `packages/db/src/schema/fees.ts`
- Modify: `packages/validator/src/execution.ts`, `packages/validator/src/errors.ts`, `packages/validator/src/fees.ts` (charge view)
- Modify: `packages/api-client/src/client.ts`
- Test: `packages/validator/src/execution.test.ts`

**Interfaces:**
- Produces (DB, Drizzle names):
  - `operationGroups` with columns `id`, `operationId`, `chain`, `tier` (`signingTier` enum: `sign_all`, `sign_and_send`, `single`, `evm_calls`, `evm_single`, `psbt`), `status` (`groupStatus` enum: `QUOTED`, `CLAIMED`, `SENT`, `EXPIRED`, `RELEASED`), `feeLegId`, `quoteBlockHeight` (bigint mode number), `expiresAt`, `sendBy`, `walletName`, `idempotencyKey`, `createdAt`, `updatedAt`.
    - `uniqueIndex("operation_groups_key").on(operationId, idempotencyKey)`.
    - `uniqueIndex("operation_groups_one_open").on(operationId, chain).where(status in ('QUOTED','CLAIMED'))`.
  - `operationLegs` + `groupId`, `feeShare` (`jsonb.$type<Partial<Record<FeeKind, string>>>()`), `feeCoveredBy`, `retryOf` (unique), `lastError`.
  - `operations` + `needsActionSince`, `solRequiredLamports` (numeric), `approvalsEstimate` (integer), `lastContinueKey` (text).
  - `gasPayer` enum + `user_solana`.
  - `operationFeeCharges`: `id`, `operationFeeId` FK → `operation_fees`, `feeLegId` FK → `operation_legs`, `amountMicro`, `settledAt`, `settledChainAt`, `createdAt`. Unique on `(operationFeeId, feeLegId)`.
- Produces (`@repo/validator`):
  - Constants: `SIGNING_TIERS`, `type SigningTier`, `K_SIGN_ALL`, `K_SIGN_AND_SEND`, `GROUP_SEND_WINDOW_MS`, `BLOCKHASH_LIFETIME_BLOCKS`, `BLOCKHASH_MARGIN_BLOCKS`, `SOL_BUFFER_LAMPORTS`, `INVEST_AUTO_STOP_HOURS`.
  - `GAS_PAYERS` + `"user_solana"`.
  - `feeShares(totals: Partial<Record<FeeKind, bigint>>, bases: bigint[]): Partial<Record<FeeKind, bigint>>[]`
  - `approvalsEstimate(i: { tier: SigningTier; solanaLegs: number; charged: boolean; k?: number }): number`
  - `groupRequestSchema`, `type GroupRequest`, `groupSubmitSchema`, `type GroupSubmit`, `groupResponseSchema`, `type GroupResponse`, `continueRequestSchema`, `type ContinueRequest`.
  - `investRequestSchema` + `tier: z.enum(["sign_all", "single"]).optional()`.
  - `legSchema` + `groupId`, `feeShare`, `feeCoveredBy`, `retryOf`, `lastError`.
  - `operationSchema` + `needsAction`, `needsActionSince`, `groups`, `approvalsEstimate`, `solRequiredLamports`, `charged`.
  - Error code `GROUP_EXPIRED` mapped to 409.
- Produces (`@repo/api-client`): `requestGroup(id, body)`, `submitGroup(id, groupId, body)`, `continueOperation(id, body)`.

- [ ] **Step 1: Write failing validator tests.** Append to `packages/validator/src/execution.test.ts`:

```ts
import { approvalsEstimate, feeShares, groupSubmitSchema, K_SIGN_ALL } from "./execution";

describe("feeShares", () => {
  it("splits each kind by base, remainder to the largest base, sums exactly", () => {
    const s = feeShares({ manager_entry: 1_000_001n, platform: 10n }, [100n, 300n, 100n]);
    expect(s.map((x) => x.manager_entry)).toEqual([200_000n, 600_001n, 200_000n]);
    expect(s.map((x) => x.platform)).toEqual([2n, 6n, 2n]);
    expect(s.reduce((t, x) => t + x.manager_entry!, 0n)).toBe(1_000_001n);
  });
  it("gives the remainder to the first largest base on ties and omits zero kinds", () => {
    const s = feeShares({ platform: 5n, network: 0n }, [1n, 1n]);
    expect(s).toEqual([{ platform: 3n }, { platform: 2n }]);
  });
  it("returns empty shares when there is no base", () => {
    expect(feeShares({ platform: 5n }, [])).toEqual([]);
  });
});

describe("approvalsEstimate", () => {
  it("counts chunks of K, one slot per chunk taken by the fee when charged", () => {
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 4, charged: true })).toBe(1);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 11, charged: true })).toBe(1);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 12, charged: true })).toBe(2);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 12, charged: false })).toBe(1);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 50, charged: true })).toBe(5);
    expect(approvalsEstimate({ tier: "single", solanaLegs: 50, charged: true })).toBe(51);
    expect(approvalsEstimate({ tier: "sign_and_send", solanaLegs: 24, charged: true })).toBe(4);
  });
});

describe("groupSubmitSchema", () => {
  it("bounds the batch", () => {
    const one = { legId: "0190a7b2-0000-7000-8000-000000000001", signedTx: "AA==" };
    expect(groupSubmitSchema.safeParse({ signed: [] }).success).toBe(false);
    expect(groupSubmitSchema.safeParse({ signed: Array(K_SIGN_ALL + 1).fill(one) }).success).toBe(false);
    expect(groupSubmitSchema.safeParse({ signed: [one] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @repo/validator exec vitest run src/execution.test.ts < /dev/null`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement the validator.** In `packages/validator/src/execution.ts`:

```ts
export const SIGNING_TIERS = ["sign_all", "sign_and_send", "single", "evm_calls", "evm_single", "psbt"] as const;
export type SigningTier = (typeof SIGNING_TIERS)[number];
/** Transactions per wallet approval (B-17); tuned after the Spec 22 P0 wallet lab. */
export const K_SIGN_ALL = 12;
export const K_SIGN_AND_SEND = 12;
/** A group's submit must arrive within this window of its quote; the fee wait is capped by it (spec §6.2). */
export const GROUP_SEND_WINDOW_MS = 40_000;
export const BLOCKHASH_LIFETIME_BLOCKS = 150;
/** A leg is not sent with fewer than this many blocks (~8 s) of its blockhash left (approximate: measured from the group's quote height). */
export const BLOCKHASH_MARGIN_BLOCKS = 20;
/** Keeps the wallet above the 890 880-lamport rent-exempt floor and absorbs wallet priority-fee padding (spec §5.3). */
export const SOL_BUFFER_LAMPORTS = 1_000_000n;
export const INVEST_AUTO_STOP_HOURS = 24;

/**
 * Per-leg fee shares (B-06): each kind split by base, floor, remainder to the largest base (first on ties). Kinds whose total is 0 are omitted.
 * The shares of a kind always sum to its total, so charging every share charges exactly the planned fee.
 */
export function feeShares(totals: Partial<Record<FeeKind, bigint>>, bases: bigint[]): Partial<Record<FeeKind, bigint>>[] {
  const sum = bases.reduce((t, b) => t + b, 0n);
  const shares: Partial<Record<FeeKind, bigint>>[] = bases.map(() => ({}));
  if (!bases.length || sum === 0n) return shares;
  const largest = bases.reduce((best, b, i) => (b > bases[best]! ? i : best), 0);
  for (const [kind, total] of Object.entries(totals) as [FeeKind, bigint][]) {
    if (!total) continue;
    let given = 0n;
    bases.forEach((b, i) => { const s = (total * b) / sum; shares[i]![kind] = s; given += s; });
    shares[largest]![kind] = shares[largest]![kind]! + (total - given);
  }
  return shares;
}

/** "About N wallet approvals" for a Solana-only plan (spec §5.2). */
export function approvalsEstimate(i: { tier: SigningTier; solanaLegs: number; charged: boolean; k?: number }): number {
  const fee = i.charged ? 1 : 0;
  if (i.tier === "single") return i.solanaLegs + fee;
  const k = i.k ?? (i.tier === "sign_and_send" ? K_SIGN_AND_SEND : K_SIGN_ALL);
  if (i.tier === "sign_and_send") return Math.ceil(i.solanaLegs / k) * (1 + fee);
  return Math.ceil(i.solanaLegs / (k - fee));
}
```

  Import `FeeKind` from `./fees`. If that creates an import cycle (`fees.ts` imports from `execution.ts`), move `feeShares` into `fees.ts` and re-export it.

  **Schemas:**
  - `groupRequestSchema = z.strictObject({ chain: z.literal("solana"), tier: z.enum(["sign_all", "single"]), walletName: z.string().trim().min(1).max(64).optional(), idempotencyKey })`.
  - `groupSubmitSchema = z.strictObject({ signed: z.array(z.strictObject({ legId: z.uuid(), signedTx: z.string().min(4).max(1644) })).min(1).max(K_SIGN_ALL) })`. 1644 is the base64 length of 1232 bytes; the server still checks the decoded length.
  - `groupResponseSchema = z.object({ groupId: z.uuid(), status: z.literal("quoted"), expiresAt: iso, sendBy: iso, priceMoved: z.boolean(), approvalsEstimate: z.number().int(), solRequiredLamports: z.string(), transactions: z.array(z.object({ legId: z.uuid(), kind: z.enum(["fee", "asset"]), serializedBase64: z.string() })), legs: z.array(z.object({ legId: z.uuid(), estimatedOut: z.string().nullable(), minOut: z.string().nullable(), plannedMinOut: z.string().nullable(), routeFees: z.array(routeFee), priceImpact: z.number().nullable(), error: z.object({ code: z.string(), message: z.string() }).nullable() })) })`.
  - `continueRequestSchema = z.strictObject({ idempotencyKey, slippageBps: slippage.optional(), skipLegIds: z.array(z.uuid()).max(100).optional(), scaleToAvailable: z.boolean().optional() })`.
  - `legSchema` gains `groupId: z.uuid().nullable()`, `feeShare: z.record(z.enum(FEE_KINDS), z.string()).nullable()`, `feeCoveredBy: z.uuid().nullable()`, `retryOf: z.uuid().nullable()`, `lastError: z.string().nullable()`.
  - `operationSchema` gains:
    - `needsAction: z.boolean()`
    - `needsActionSince: iso.nullable()`
    - `groups: z.array(z.object({ id: z.uuid(), chain: assetChainSchema, tier: z.enum(SIGNING_TIERS), status: z.enum(["QUOTED", "CLAIMED", "SENT", "EXPIRED", "RELEASED"]), sendBy: iso, createdAt: iso }))`
    - `approvalsEstimate: z.number().int().nullable()`
    - `solRequiredLamports: z.string().nullable()`
    - `charged: z.array(z.object({ kind: z.enum(FEE_KINDS), amountMicro: z.string(), feeLegId: z.uuid(), settledAt: iso.nullable() }))`

  **Error codes:** add `"GROUP_EXPIRED"` to the code list and `GROUP_EXPIRED: 409` in `packages/validator/src/errors.ts`.

- [ ] **Step 4: Run the validator tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Schema and migration.**
  - Add the Drizzle tables and columns listed under Interfaces, then generate the migration.
  - Hand-append to `0025_signing_groups.sql`:

```sql
GRANT SELECT, INSERT, UPDATE ON app.operation_groups, app.operation_fee_charges TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.operation_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.operation_groups FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE app.operation_fee_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.operation_fee_charges FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Every fee that already settled becomes one charge, paid by the operation's (single) fee leg, so earnings and revenue keep their history.
INSERT INTO app.operation_fee_charges (id, operation_fee_id, fee_leg_id, amount_micro, settled_at, settled_chain_at, created_at)
SELECT gen_random_uuid(), f.id, f.leg_id, f.amount_micro, f.settled_at, f.settled_chain_at, f.settled_at
FROM app.operation_fees f WHERE f.settled_at IS NOT NULL AND f.amount_micro > 0 AND f.leg_id IS NOT NULL;
```

  `ALTER TYPE app.gas_payer ADD VALUE 'user_solana'` must sit in its own statement (Postgres cannot use a new enum value in the same transaction; use the `::text` cast pattern already noted in `execution.ts` for any check constraint).

- [ ] **Step 6: Migrate and type-check.**
  - `pnpm --filter @repo/db db:migrate < /dev/null`, then `pnpm --filter @repo/db check-types < /dev/null`. Expected: PASS.
  - Run the DB package tests if present: `pnpm --filter @repo/db test < /dev/null`.

- [ ] **Step 7: Client methods.** In `packages/api-client/src/client.ts` add, next to `quoteLeg`:

```ts
requestGroup: (id: string, b: GroupRequest): Promise<GroupResponse> => request("POST", `/v1/operations/${e(id)}/groups`, groupResponseSchema, b),
submitGroup: (id: string, groupId: string, b: GroupSubmit): Promise<OperationView> => request("POST", `/v1/operations/${e(id)}/groups/${e(groupId)}/submit`, operationSchema, b),
continueOperation: (id: string, b: ContinueRequest): Promise<OperationView> => request("POST", `/v1/operations/${e(id)}/continue`, operationSchema, b),
```

- [ ] **Step 7b: View fields** (so `apps/api` type-checks in this commit). In `apps/api/src/modules/operations/operations.service.ts` `operationView`, add:
  - `needsAction: op.needsActionSince !== null`
  - `needsActionSince: op.needsActionSince?.toISOString() ?? null`
  - `groups`: select from `operationGroups` where `operationId = op.id`, ordered by `createdAt`, mapped to `{ id, chain, tier, status, sendBy, createdAt }`
  - `approvalsEstimate: op.approvalsEstimate`
  - `solRequiredLamports: op.solRequiredLamports`
  - `charged`: select from `operationFeeCharges` inner-joined to `operationFees` on `operation_fee_id`, where `operation_fees.operation_id = op.id`, mapped to `{ kind, amountMicro, feeLegId, settledAt }`
  - Per leg: `groupId`, `feeShare`, `feeCoveredBy`, `retryOf`, `lastError`

  Then run `pnpm --filter @repo/api-client check-types < /dev/null` and `pnpm --filter api check-types < /dev/null`. Expected: PASS.

- [ ] **Step 8: Commit.** `feat(db,validator): signing groups, fee charges and fee-share math (spec 22 P1)`.

### Task 2: User-paid Solana gas everywhere, SOL requirement, fee shares and charges

**Files:**
- Modify: `apps/api/src/providers/solana-tx.ts`, `apps/api/src/providers/routes/lifi.ts` (no change unless `svmSponsor` handling needs it)
- Modify: `apps/api/src/modules/operations/plan.service.ts`, `quote.service.ts`, `submit.service.ts`, `operations.service.ts`, `gas.service.ts`
- Modify: `apps/api/src/modules/rebalance/rebalance.service.ts`, `apps/api/src/modules/portfolio/tracking.service.ts`, `apps/api/src/modules/fees/fees.service.ts`
- Modify: `apps/api/test/helpers/chain-mocks.ts` (the LI.FI mock builds a user-paid transaction when `svmSponsor` is absent; a `getBlockHeight` mock)
- Test: `apps/api/test/modules/operations/user-paid-gas.test.ts` (new); update `invest.test.ts`, `sell.test.ts`, `gas.test.ts`, `money.test.ts`, `lifi-hardening.test.ts`, `per-chain-money.test.ts`, and the rebalance, repair and fees tests where expectations change

**Interfaces:**
- Consumes: Task 1 constants, `feeShares` and the new columns.
- Produces (`solana-tx.ts`):
  - `solanaCost(serializedBase64: string, payer: string): { lamports: bigint; rentLamports: bigint }`: the user's cost when `payer` is the fee payer. It counts signatures, priority (price × limit) and one rent per ATA `CreateIdempotent` whose funder is the payer. It refuses nothing.
  - `verifyUserSigned(signedBase64: string, i: { owner: string; storedMessageHash: string; preparedBase64?: string }): { raw: Uint8Array; signature: string; recentBlockhash: string }`: 409 `TX_MISMATCH` on any mismatch.
  - `buildFeeTransfer(i: { owner: string; payer: "user" | "platform"; transfers: { recipient: string; amountMicro: bigint }[] })`: `"user"` makes the owner the fee payer and ATA funder.
  - `blockhashUsable(recentBlockhash: string, quoteBlockHeight: number): Promise<boolean>`
  - `FEE_TRANSFER_USER_LAMPORTS = 5_000n + FEE_LEG_PRIORITY_LAMPORTS` (one signature).
- Produces (`plan.service.ts`):
  - `gasPayerFor` returns `"user_solana"` for Solana.
  - `planQuote` never sends `svmSponsor`, and falls back to an estimate on LI.FI `SOL_REQUIRED` as on build refusal (1001).
  - `solanaLegLamports(q: PlanQuote, toChain: AssetChain, toToken: string | null, owner: string): Promise<bigint>` replaces `legCost`'s Solana part.
  - `assertSolFor(owner: string, needLamports: bigint, nativeSoldLamports?: bigint): Promise<bigint>` returns the computed requirement, else throws 409 `SOL_REQUIRED` with details.
- Produces (`tracking.service.ts`): on a fee leg settling, `operation_fee_charges` rows are written and the covered legs get `fee_covered_by`.

- [ ] **Step 1: Write the failing tests.** Create `apps/api/test/modules/operations/user-paid-gas.test.ts`, reusing `arrange`/`invest`/`post` from `invest.test.ts` (copy the small helpers; test files do not import each other). Cases:
  1. **Invest plan is user-paid:**
     - Every quote has `svmSponsor` undefined.
     - Every leg's `gasPayer` is `"user_solana"`.
     - No `sponsor_usage` row for Solana.
     - `networkFeeUsdc` is `"0"`.
     - `solRequiredLamports` equals `FEE_TRANSFER_USER_LAMPORTS × (fee ? 1 : 0) + Σ leg lamports + SOL_BUFFER_LAMPORTS (+ rent for missing ATAs)`. Compute the expected value from the mock's `gasNative` 5 000 and the decoded user transaction.
  2. **`SOL_REQUIRED` at plan:** with the wallet's SOL balance (`balanceKey(owner, null)`) at 0, the plan is 409 `SOL_REQUIRED` with `details.lamportsRequired` equal to case 1's need and `details.lamportsHeld` `"0"`, and no operation row exists.
  3. **Fee shares at invest:**
     - With a manager entry fee of 100 bps on 500 USDC (fee 5 USDC) and weights 50/30/20, the asset legs' `feeShare.manager_entry` are proportional to `amountIn`, sum to 5 000 000, and the remainder goes to the 50% leg.
     - The plan fee leg's `amountIn` is the total.
     - The fee transfer built at the per-leg quote has the **user as fee payer** (`staticAccountKeys[0]` equals the user's Solana address).
  4. **Per-leg (mobile) submit, user-paid:** the user signs the quoted transaction (no platform slot), the server verifies and sends it without co-signing, and the sent bytes carry only the user's signature.
  5. **`TX_MISMATCH` per leg:** a signed transaction whose fee payer differs from the user, or whose transfer changed, is 409 and nothing is sent. A ComputeBudget-only rewrite is accepted.
  6. **Legacy leg:** a leg inserted directly with `gasPayer = 'platform_fee_payer'` and a platform-paid stored message still quotes with `svmSponsor` and still co-signs (the regression guard for in-flight operations).
  7. **Charges:**
     - Settling the plan fee leg of a per-leg operation writes one `operation_fee_charges` row per charged kind, sets `fee_covered_by` on every asset leg, and keeps `operation_fees.settled_at` stamped.
     - `GET /v1/organizations/:id/earnings` and `/v1/ops/revenue` sum charges.
     - `revenue-reconcile` compares charges with treasury inflows.
  8. **Sell plan with only Solana sells:** user-paid legs, no Solana reservation, SOL requirement includes the fee transaction.

  Update existing tests whose expectations assumed the fee payer: `svmSponsor` present, `platform_fee_payer`, Solana `sponsor_usage`, an invest network fee greater than 0, and `walletSign` returning a transaction with an empty platform slot. Change only the assertion lines that encode the old gas model.

- [ ] **Step 2: Run the new file and see it fail.** `pnpm --filter api exec vitest run test/modules/operations/user-paid-gas.test.ts < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement `solana-tx.ts`.**
  - `buildFeeTransfer` gains `payer: "user" | "platform"`:
    - `payerKey = payer === "user" ? owner : feePayer().publicKey`.
    - The ATA `CreateIdempotent` funder is that payer.
  - Add:

```ts
/** What a user-paid transaction costs its fee payer `payer`: signatures, priority fee (price x limit; 1.4M when unset), and rent for each ATA it funds. */
export function solanaCost(serializedBase64: string, payer: string): { lamports: bigint; rentLamports: bigint } {
  const message = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64")).message;
  const keys = message.staticAccountKeys;
  const payerIndex = keys.findIndex((k) => k.toBase58() === payer);
  let price = 0n;
  let limit: bigint | null = null;
  let creates = 0n;
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex]!.toBase58();
    const data = Buffer.from(ix.data);
    if (program === COMPUTE_BUDGET && data[0] === 2 && data.length >= 5) limit = BigInt(data.readUInt32LE(1));
    if (program === COMPUTE_BUDGET && data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
    if (program === ATA_PROGRAM.toBase58() && data[0] === 1 && ix.accountKeyIndexes[0] === payerIndex) creates += 1n;
  }
  const rentLamports = creates * TOKEN_ACCOUNT_RENT_LAMPORTS;
  return { lamports: BigInt(message.header.numRequiredSignatures) * LAMPORTS_PER_SIGNATURE + (price * (limit ?? 1_400_000n) + 999_999n) / 1_000_000n + rentLamports, rentLamports };
}

/**
 * A user-paid transaction the user signed: the fee payer (index 0) is `owner`, the message is the quoted one (byte-identical, or ComputeBudget-only
 * changes against `preparedBase64`), and the owner's ed25519 signature verifies. Nothing is sent; the caller claims first (ADR-014 claim before send).
 */
export function verifyUserSigned(signedBase64: string, i: { owner: string; storedMessageHash: string; preparedBase64?: string }): { raw: Uint8Array; signature: string; recentBlockhash: string } {
  const mismatch = (why: string) => createHttpError(409, `The transaction changed after it was prepared (${why}).`, { code: "TX_MISMATCH" });
  const raw = Buffer.from(signedBase64, "base64");
  if (raw.length > 1232) throw mismatch("size");
  const tx = VersionedTransaction.deserialize(raw);
  const owner = new PublicKey(i.owner);
  if (!tx.message.staticAccountKeys[0]!.equals(owner)) throw mismatch("fee payer");
  if (messageHash(tx) !== i.storedMessageHash) {
    if (!i.preparedBase64) throw mismatch("message");
    const prepared = VersionedTransaction.deserialize(Buffer.from(i.preparedBase64, "base64"));
    if (messageHash(prepared) !== i.storedMessageHash || !sameExceptComputeBudget(prepared, tx)) throw mismatch("message");
  }
  if (!ed25519.verify(tx.signatures[0]!, tx.message.serialize(), owner.toBytes())) throw mismatch("signature");
  return { raw: tx.serialize(), signature: bs58.encode(tx.signatures[0]!), recentBlockhash: tx.message.recentBlockhash };
}

/** The send gate (spec §6.2 step 9): the blockhash is still valid and, measured from the group's quote height, has at least the margin left. */
export async function blockhashUsable(recentBlockhash: string, quoteBlockHeight: number): Promise<boolean> {
  const [valid, height] = await Promise.all([connection.isBlockhashValid(recentBlockhash, { commitment: "confirmed" }), connection.getBlockHeight("confirmed")]);
  return valid.value && height <= quoteBlockHeight + BLOCKHASH_LIFETIME_BLOCKS - BLOCKHASH_MARGIN_BLOCKS;
}
```

  `sendSolana`, `sameExceptComputeBudget`, `cosign` and `sponsorExposure` stay as they are (legacy legs). Add `export const FEE_TRANSFER_USER_LAMPORTS = LAMPORTS_PER_SIGNATURE + FEE_LEG_PRIORITY_LAMPORTS;`.

- [ ] **Step 4: Implement the planners.**
  - **`plan.service.ts`:**
    - `gasPayerFor`: Solana gives `"user_solana"`.
    - `planQuote`: drop `quoteSponsorable` and `svmSponsor` for new legs. In the catch, `if (!isBuildRefusal(err) && (err as { code?: string }).code !== "SOL_REQUIRED") throw err; return provider.estimate(trade);`.
    - Keep `quoteSponsorable` exported only for the legacy path in `quote.service.ts`.
    - Replace `legCost`/`sponsoredCost` with `solanaLegLamports`: a built transaction gives `solanaCost(tx, owner).lamports`, falling back to `q.gasNative` when that is higher; an estimate gives `q.gasNative` plus rent when the Solana destination ATA is missing.
    - Add:

```ts
/** The plan's SOL requirement (spec §5.3) checked against the wallet's SOL; returns it for the view. */
export async function assertSolFor(owner: string, needLamports: bigint, nativeSoldLamports = 0n): Promise<bigint> {
  const required = needLamports + nativeSoldLamports + SOL_BUFFER_LAMPORTS;
  const held = await solanaBalance(owner, null);
  if (held < required) throw createHttpError(409, "Add a little SOL to your Solana wallet for network fees, then continue.", { code: "SOL_REQUIRED", details: { lamportsRequired: required.toString(), lamportsHeld: held.toString() } });
  return required;
}
```

  - **`createInvestPlan`:**
    - `networkMicro: 0n`. Keep `planFees`; its rent extra no longer goes into the network fee: when `payer` is the user, `planFees` must not add rent to `network.amountMicro`. Add an input flag `rentPaidBy: "user" | "platform"` (default `"platform"` for legacy callers), and for `"user"` return `rentLamports` without touching `network.amountMicro`.
    - Solana need: `fees.totalMicro > 0n ? FEE_TRANSFER_USER_LAMPORTS + fees.rentLamports : 0n` plus `Σ solanaLegLamports`. Call `assertSolFor` after the USDC check and before `insertPlan`.
    - No Solana gas reservation: `gas` is an empty `Map`.
    - Fee shares: `feeShares(Object.fromEntries(fees.rows.filter((r) => r.amountMicro > 0n).map((r) => [r.kind, r.amountMicro])), shares.map((s) => s.amountMicro))`, stored as strings on each asset `LegDraft.feeShare`.
    - Store `solRequiredLamports` and `approvalsEstimate({ tier: body.tier ?? "single", solanaLegs: constituents.length, charged: fees.totalMicro > 0n })` on the operation.
  - **`insertPlan`:**
    - Create the `network_fee` leg only when `fees.totalMicro > 0n`. Fee rows then carry `legId: null`, which is allowed.
    - Pass `feeShare` through.
    - Accept `solRequiredLamports` and `approvalsEstimate` in `op`.
  - **`createSellPlan` and `rebalance.service.ts` planners:**
    - Solana legs are `user_solana`; Solana gas is neither reserved nor counted in the network fee (the network fee keeps only EVM drop costs).
    - `assertSolFor(owner, FEE_TRANSFER_USER_LAMPORTS (when a fee leg exists) + Σ Solana leg lamports, nativeSolSold)`, where `nativeSolSold` is the planned amount of a native SOL sell.
    - EVM gas reservation is unchanged.
  - **Repair:** same change in the repair planner, wherever it builds its Solana buy.

- [ ] **Step 5: Per-leg quote and submit.**
  - **`quote.service.ts`, extract quoting into one function** used by both the per-leg path and Task 3:

    ```ts
    export async function quoteAssetLeg(op: Op, leg: Leg, addresses: Addresses): Promise<{ q: LegQuote; patch: Partial<typeof operationLegs.$inferInsert>; response: Pick<LegQuoteResponse, "estimatedOut" | "minOut" | "transaction" | "approval"> }>
    ```

    It holds today's body from `const [from, to] = …` through the `expectedTx` patch.
    - For `user_solana` legs: no `svmSponsor`, no `sponsorExposure`, no `reserveLegGas`. Store `builtMessageHash` and `expectedTx.preparedBase64` exactly as today.
    - Legacy `platform_fee_payer` legs keep `quoteSponsorable` + `svmSponsor` + `sponsorExposure` + `reserveLegGas`.
    - The fee leg branch: `buildFeeTransfer({ owner, payer: leg.gasPayer === "platform_fee_payer" ? "platform" : "user", transfers })`. When `leg.routeSummary?.feeCharges` exists (a group fee leg, Task 3), transfers come from it instead of the fee rows; otherwise today's rows check stays.
    - At the top of `quoteLeg`: `if (await hasGroups(op.id)) throw invalidTransition("Continue this investment on the website.")`. `hasGroups` lives in `operations.service.ts`: a one-row select on `operationGroups`.
  - **`submit.service.ts`:**
    - For `leg.fromChain === "solana"`: `leg.gasPayer === "platform_fee_payer" ? cosign(...) : verifyUserSigned(body.signedTx, { owner: addressOn(addresses, "solana"), storedMessageHash: leg.builtMessageHash, preparedBase64 })`.
    - Same `hasGroups` refusal.
  - **`tracking.service.ts`:** the recovery leg is created with `gasPayer: gasPayerFor(chain)` (now `user_solana` on Solana).

- [ ] **Step 6: Charges on settle and reports.**
  - **`tracking.service.ts` `settleLeg`, `network_fee` branch** (keep the `settledAt` stamp on `operation_fees` for compatibility):

```ts
// What this fee leg charged: a group fee leg carries its per-kind charges and the legs it covers; the plan's single fee leg charges every fee row.
const charges = (leg.routeSummary?.feeCharges ?? null) as Record<string, string> | null;
const rows = await tx.select({ id: operationFees.id, kind: operationFees.kind, amountMicro: operationFees.amountMicro }).from(operationFees).where(eq(operationFees.operationId, op.id));
const blockTime = await solanaBlockTime(leg.sourceTx!).catch(() => null);
const values = rows.flatMap((r) => {
  const amount = charges ? charges[r.kind] : BigInt(r.amountMicro) > 0n ? r.amountMicro : undefined;
  return amount && BigInt(amount) > 0n ? [{ operationFeeId: r.id, feeLegId: leg.id, amountMicro: amount, settledAt: sql`now()` as unknown as Date, settledChainAt: blockTime }] : [];
});
if (values.length) await tx.insert(operationFeeCharges).values(values).onConflictDoNothing();
const covers = (leg.routeSummary?.covers ?? null) as string[] | null;
await tx.update(operationLegs).set({ feeCoveredBy: leg.id }).where(and(eq(operationLegs.operationId, op.id), covers ? inArray(operationLegs.id, covers) : ne(operationLegs.kind, "network_fee"), isNull(operationLegs.feeCoveredBy)));
```

  If `settled_chain_at` is already written elsewhere for the fee rows, reuse that block time instead of reading it twice.

  - **`fees.service.ts`:**
    - `getEarnings`, `getEarningsCsv`, `getRevenue`, `getRevenueCsv` and `reconcileRevenue` read `operation_fee_charges` joined to `operation_fees` (for kind, organization, basket and version) instead of `operation_fees.amountMicro`/`settledAt`.
    - The amount is `charges.amount_micro`; the time is `coalesce(charges.settled_chain_at, charges.settled_at)` for buckets and `charges.settled_at` for the month and filters.
    - The waived report keeps reading `operation_fees.waived_reason`.

- [ ] **Step 7: Per-leg SOL estimate.** Every Solana asset leg stores its plan-time cost on `expectedTx.userLamports` (string), the value `solanaLegLamports` returned for it. Continue (Task 4) sums these to recheck SOL without re-quoting. Add an assertion to case 1 of `user-paid-gas.test.ts`: every asset leg has `expectedTx.userLamports`.

- [ ] **Step 8: Run the tests and see them pass.** Run `user-paid-gas.test.ts`, then one at a time `invest.test.ts`, `sell.test.ts`, `gas.test.ts`, `money.test.ts`, `lifi-hardening.test.ts`, `per-chain-money.test.ts`, the rebalance, repair and fees test files (`ls apps/api/test/modules/{rebalance,portfolio,fees}`), `route-table.test.ts` and `no-cycles.test.ts`. Expected: PASS.

- [ ] **Step 9: Commit.** `feat(api): user-paid Solana gas, SOL requirement, fee shares and fee charges (spec 22 P1)`.

### Task 3: Solana signing groups (request, verify, claim, send)

**Files:**
- Create: `apps/api/src/modules/operations/groups.service.ts`
- Modify: `operations.route.ts`, `operations.controller.ts`, `operations.service.ts` (cancel releases groups)
- Modify: `apps/api/test/__snapshots__/route-table.test.ts.snap` (two new paths)
- Test: `apps/api/test/modules/operations/groups.test.ts` (new)

**Interfaces:**
- Consumes: `quoteAssetLeg` (Task 2), `verifyUserSigned`, `blockhashUsable`, `buildFeeTransfer`, `solanaCost`, `sendSolana`, `lockOperation`, `setLegStatus`, `markSubmitted` (from `submit.service.ts`, exported already), `enqueue("track-leg")`, and the Task 1 constants.
- Produces:
  - `requestGroup(ctx: OpCtx, opId: string, body: GroupRequest): Promise<GroupResponse>`
  - `submitGroup(ctx: OpCtx, opId: string, groupId: string, body: GroupSubmit): Promise<OperationView>`
  - Routes:
    - `POST /v1/operations/:id/groups` (`validate({ params: idParam, body: groupRequestSchema })`)
    - `POST /v1/operations/:id/groups/:groupId/submit` (`validate({ params: z.object({ id: z.uuid(), groupId: z.uuid() }), body: groupSubmitSchema })`)
  - Log lines `group.quoted { walletName, chain, tier, legs, approvals }`, `group.expired { tier, walletName }` and `leg.released { reason }`, with no addresses.

- [ ] **Step 1: Write the failing tests** in `groups.test.ts`. The helpers mirror `invest.test.ts`, plus `signAll(txs)`, which signs each `serializedBase64` with `wallet.keypair`. Cases (each names the behaviour; assertions are on DB rows and `sendRawTransaction` calls):
  1. **Happy path, 4 legs plus fee:**
     - `requestGroup` returns 5 transactions, fee first.
     - Every transaction's fee payer is the user.
     - `sendBy` is 40 s after now.
     - `approvalsEstimate` is 1.
     - The fee leg's `routeSummary.feeCharges` sums the 4 legs' `feeShare`, and `covers` lists them.
     - Submit sends the fee first, waits for `confirmed` (mock `connection.confirmTransaction` or the signature-status call used), then the 4 buys in sequence order.
     - Every leg is `SUBMITTED`, the group is `SENT`, and `track-leg` is enqueued 5 times.
  2. **Chunking:**
     - A 14-leg basket (seed 14 Solana assets): the first group takes 11 legs plus the fee.
     - After its fee leg settles (drive `trackLeg` with the finality mock), the second group takes the remaining 3 legs, and its fee covers only their shares.
     - The fee legs' charges sum to the plan's total fee.
  3. **No fee when covered:** a retry leg whose `feeCoveredBy` is set (insert directly) gets a group with no fee transaction.
  4. **One failing leg is excluded (Review Focus 5):**
     - The LI.FI mock throws `ROUTE_UNAVAILABLE` for one deployment. That leg comes back with `error.code === "ROUTE_UNAVAILABLE"`, is not in `transactions`, stays `PLANNED`, and is not counted in the fee.
     - When every leg throws, the response is that error and no group row exists.
  5. **SOL recheck:** the SOL balance drops after plan; `requestGroup` is 409 `SOL_REQUIRED` with details, and no group row exists.
  6. **Idempotency:** the same `idempotencyKey` returns the same group (no new quotes). A second key while a `QUOTED` group exists expires the old group (`EXPIRED`) and creates a new one.
  7. **Order, missing, extra or foreign (Review Focus 1):** submitting with a leg missing, an extra `legId` from another operation, or a duplicated `legId` is 409 `TX_MISMATCH`; nothing is claimed and `sendRawTransaction` is not called. A shuffled array order is accepted (mapping by `legId`), and the send order is still the fee, then sequence order.
  8. **Rewrites (Review Focus 4):** a ComputeBudget-only rewrite of two legs is accepted. A fee-payer change on one leg means the whole group is refused with nothing claimed.
  9. **Concurrent submits (Review Focus 2):** `Promise.all` of two identical submits gives one 200 and one 409, and `sendRawTransaction` is called `legs + 1` times in total.
  10. **Fee preflight refusal (Review Focus 3):**
      - `sendRawTransaction` throws `SendTransactionError` for the fee.
      - The response is 503 `ROUTE_UNAVAILABLE`.
      - Every leg is back to `PLANNED`, with `builtMessageHash` and `expectedTx.preparedBase64` cleared and `sourceTx` null.
      - The group is `RELEASED`.
  11. **Fee not confirmed in time:** the confirmation mock never resolves within the cap (fake timers, or a mocked status returning nothing). The fee leg is `SUBMITTED`, the buys are released `PLANNED` with no buy sent, and `needsActionSince` is set.
  12. **Buy preflight refusal stops the rest:** buy 2 of 4 throws `SendTransactionError`. Buy 1 is `SUBMITTED`; buys 2–4 are `PLANNED` with `lastError` set (buy 2 carries the refusal message, buys 3–4 `"STOPPED"`).
  13. **Blockhash gate:**
      - `isBlockhashValid` returns false for buy 3: buys 3 and 4 are released with `lastError: "QUOTE_STALE"`, and `leg.released` is logged twice.
      - `getBlockHeight` above `quoteBlockHeight + 130`: the same release, from that leg on.
      - Submit after `sendBy` (fake timers +41 s) is 409 `GROUP_EXPIRED`, nothing claimed, the group `EXPIRED`, and `group.expired` logged.
      - With the clock past `sendBy` **after** the claim but the blockhash still valid, the buys are still sent.
  14. **Unknown send outcome:** buy 2's `sendRawTransaction` rejects with a plain `Error("timeout")`. Buy 2 is `SUBMITTED` (tracked, never resent) and buys 3–4 are still sent.
  15. **Per-leg refusal:** after a group exists, `POST /legs/:legId/quote` is 409 `INVALID_TRANSITION`.
  16. **Cancel while a group is `QUOTED`:** the group becomes `RELEASED` and the operation `CANCELLED` (`PLANNED`) or stops (`IN_PROGRESS`).
  17. **Telemetry:** the `group.quoted` log has `walletName` and `tier`, and no string field matches the user's address.

- [ ] **Step 2: Run them and see them fail.** `pnpm --filter api exec vitest run test/modules/operations/groups.test.ts < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement `requestGroup`.** Under one `db.transaction` with `lockOperation`:
  1. **Ownership and state:** `assertOperable`.
  2. **Exclusivity:** refuse with 409 `INVALID_TRANSITION` when the operation has no group yet but some leg is no longer `PLANNED`, which means the per-leg path was used.
  3. **Idempotency:** the same `(operationId, idempotencyKey)` returns the stored response, rebuilt from the group's legs (their `expectedTx.preparedBase64` and `routeSummary`).
  4. **Expire** any `QUOTED` group of the chain (`EXPIRED`) and clear `groupId` on its still-`PLANNED` legs.
  5. **Refuse** with 409 `OPERATION_IN_PROGRESS` while a fee leg is `SUBMITTING`, `SUBMITTED`, `PENDING_CHAIN` or `UNKNOWN`.
  6. **Candidates:** `PLANNED` asset legs with `fromChain === "solana"`, no `recoveryOf`, in sequence order.
  7. **Fee:** `uncovered = candidates.filter((l) => !l.feeCoveredBy)`. `charged` is true when any uncovered leg has a non-zero share. `take = candidates.slice(0, K_SIGN_ALL - (charged ? 1 : 0))`. Recompute `charged` over `take`.

  Then, outside the transaction (provider calls):
  1. **Quotes:** `Promise.allSettled(take.map((l) => quoteAssetLeg(op, l, addresses)))`. A rejected one becomes `{ legId, error: { code, message } }`; if all reject, rethrow the first.
  2. **Fee transfer:** sum `feeShare` per kind over the *quoted* legs that are uncovered. When the sum is greater than 0, build `buildFeeTransfer({ owner, payer: "user", transfers })` (transfers in network, manager, platform order, recipients from the operation's fee rows).
  3. **Balances:**
     - USDC (wallet, or free USDC as today): `≥ fee + Σ quoted leg amountIn`, else 409 `INSUFFICIENT_BALANCE` with `details: { usdcRequiredMicro, usdcHeldMicro }`.
     - SOL: `assertSolFor(owner, Σ solanaCost(tx, owner).lamports)`.
  4. **Height:** `quoteBlockHeight = await connection.getBlockHeight("confirmed")`.

  Back under the lock, in one transaction (re-check that each quoted leg is still `PLANNED` and not in another group; if not, 409 `INVALID_TRANSITION`):
  1. **Fee leg:** reuse the plan fee leg (sequence 1) when it is still `PLANNED` with no group, setting `amountIn` to the group fee. Otherwise insert a new `network_fee` leg at `max(sequence) + 1` with `gasPayer: "user_solana"`. Either way, set `routeSummary: { feeCharges: { [kind]: string }, covers: uncoveredQuotedLegIds }`, `builtMessageHash`, `expectedTx.preparedBase64`, `quoteExpiresAt` and `groupId`.
  2. **Group row:** insert with `status: "QUOTED"`, `expiresAt: now + 60 s`, `sendBy: now + GROUP_SEND_WINDOW_MS`, `quoteBlockHeight`, `walletName`, `tier`, `feeLegId`.
  3. **Legs:** save each quoted leg's patch, and `groupId`, guarded by `status = 'PLANNED'`.
  4. **Clock:** set `operations.needsActionSince = null`.

  **Response:**
  - `priceMoved` is true when any quoted leg's fresh `minOut` is below its stored plan `minOut` (read before the patch).
  - `approvalsEstimate` comes from `approvalsEstimate({ tier, solanaLegs: remaining PLANNED Solana legs, charged })`.
  - `logger.info("group.quoted", { walletName, chain, tier, legs: quoted.length, approvals })`.

- [ ] **Step 4: Implement `submitGroup`.** The send loop is the money path, written out in full:

```ts
export async function submitGroup(ctx: OpCtx, opId: string, groupId: string, body: GroupSubmit): Promise<OperationView> {
  const { op } = await loadOperation(ctx, opId); // owner check; 404 otherwise
  const [group] = await db.select().from(operationGroups).where(and(eq(operationGroups.id, groupId), eq(operationGroups.operationId, op.id)));
  if (!group) throw notFound();
  const legs = await db.select().from(operationLegs).where(eq(operationLegs.groupId, group.id)).orderBy(asc(operationLegs.sequence));
  const fee = legs.find((l) => l.kind === "network_fee") ?? null;
  const assets = legs.filter((l) => l.kind !== "network_fee");
  const owner = addressOn(await userAddresses(db, ctx.userId), "solana");

  if (group.status !== "QUOTED") throw invalidTransition(`This batch is ${group.status.toLowerCase()}.`);
  if (group.sendBy <= new Date()) {
    await db.update(operationGroups).set({ status: "EXPIRED", updatedAt: sql`now()` }).where(and(eq(operationGroups.id, group.id), eq(operationGroups.status, "QUOTED")));
    logger.info("group.expired", { tier: group.tier, walletName: group.walletName });
    throw createHttpError(409, "These quotes expired. Get new quotes.", { code: "GROUP_EXPIRED" });
  }
  // Exactly the group's legs, each once (mapping by legId; the wallet may return them in any order).
  const byLeg = new Map(body.signed.map((s) => [s.legId, s.signedTx]));
  if (byLeg.size !== body.signed.length || byLeg.size !== legs.length || legs.some((l) => !byLeg.has(l.id))) throw createHttpError(409, "The signed batch doesn't match the prepared one.", { code: "TX_MISMATCH" });
  // Verify everything before claiming anything.
  const verified = new Map(legs.map((l) => [l.id, verifyUserSigned(byLeg.get(l.id)!, { owner, storedMessageHash: l.builtMessageHash!, preparedBase64: (l.expectedTx as { preparedBase64?: string } | null)?.preparedBase64 })]));

  // Claim every leg in one transaction, only if the group and each leg are still exactly what was verified.
  try {
    await db.transaction(async (tx) => {
      const locked = await lockOperation(tx, op.id);
      if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${locked.status.toLowerCase()}.`);
      const claimed = await tx.update(operationGroups).set({ status: "CLAIMED", updatedAt: sql`now()` }).where(and(eq(operationGroups.id, group.id), eq(operationGroups.status, "QUOTED"))).returning({ id: operationGroups.id });
      if (claimed.length !== 1) throw invalidTransition("This batch was already submitted.");
      for (const l of legs) {
        const v = verified.get(l.id)!;
        const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, l.id));
        if (current!.status !== "PLANNED" || current!.groupId !== group.id || current!.builtMessageHash !== l.builtMessageHash) throw invalidTransition("This batch changed. Get new quotes.");
        await setLegStatus(tx, ctx, current!, "SUBMITTING", { sourceTx: v.signature, submittedAt: sql`now()` as unknown as Date, expectedTx: { ...(current!.expectedTx ?? {}), recentBlockhash: v.recentBlockhash, signedBase64: Buffer.from(v.raw).toString("base64") } });
      }
    });
  } catch (err) {
    if (isUniqueViolation(err, "operation_legs_source_tx")) throw invalidTransition("That transaction is already recorded for another leg.");
    throw err;
  }

  // Unsent legs go back to PLANNED with their bytes cleared (Continue re-quotes; old bytes are never reused).
  const release = async (ids: string[], reason: string, stoppedBy?: string) => {
    if (!ids.length) return;
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      for (const id of ids) {
        const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, id));
        if (current!.status !== "SUBMITTING") continue;
        const { preparedBase64: _p, signedBase64: _s, recentBlockhash: _r, ...rest } = (current!.expectedTx ?? {}) as Record<string, unknown>;
        await setLegStatus(tx, ctx, current!, "PLANNED", { sourceTx: null, submittedAt: null, builtMessageHash: null, quoteExpiresAt: null, groupId: null, expectedTx: rest, lastError: id === stoppedBy ? reason : reason === "QUOTE_STALE" ? "QUOTE_STALE" : "STOPPED" });
      }
      await tx.update(operations).set({ needsActionSince: sql`coalesce(${operations.needsActionSince}, now())` }).where(eq(operations.id, op.id));
    });
    for (const _ of ids) logger.info("leg.released", { reason: reason === "QUOTE_STALE" ? "QUOTE_STALE" : "STOPPED" });
  };
  const refused = (err: unknown) => err instanceof SendTransactionError || (err as { code?: string }).code === "BROADCAST_REJECTED";
  const send = async (l: Leg): Promise<{ r: "sent" | "unknown" } | { r: "refused"; message: string }> => {
    try {
      await sendSolana(verified.get(l.id)!.raw);
      return { r: "sent" };
    } catch (err) {
      // unknown: the leg stays claimed and is tracked, never resent
      return refused(err) ? { r: "refused", message: (err instanceof Error ? err.message : "refused").slice(0, 300) } : { r: "unknown" };
    }
  };
  const done = async (l: Leg) => { await markSubmitted(ctx, op.id, l.id); await enqueue("track-leg", { legId: l.id }); };

  if (fee) {
    const s = await send(fee);
    if (s.r === "refused") {
      await release(legs.map((l) => l.id), `FEE_REFUSED: ${s.message}`, fee.id);
      await db.update(operationGroups).set({ status: "RELEASED", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
      throw createHttpError(503, "The network rejected the fee transaction. Nothing was sent. Get new quotes.", { code: "ROUTE_UNAVAILABLE" });
    }
    await done(fee);
    const waitMs = Math.max(0, Math.min(30_000, group.sendBy.getTime() - Date.now()));
    const confirmed = s.r === "sent" && (await solanaConfirmed(verified.get(fee.id)!.signature, waitMs));
    if (!confirmed) {
      await release(assets.map((l) => l.id), "FEE_UNCONFIRMED");
      await db.update(operationGroups).set({ status: "SENT", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
      return getOperation(ctx, op.id);
    }
  }
  for (const [n, l] of assets.entries()) {
    if (!(await blockhashUsable(verified.get(l.id)!.recentBlockhash, group.quoteBlockHeight).catch(() => false))) {
      await release(assets.slice(n).map((x) => x.id), "QUOTE_STALE");
      break;
    }
    const s = await send(l);
    if (s.r === "refused") {
      await release(assets.slice(n).map((x) => x.id), `PREFLIGHT_REFUSED: ${s.message}`, l.id);
      break;
    }
    await done(l);
  }
  await db.update(operationGroups).set({ status: "SENT", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
  return getOperation(ctx, op.id);
}
```

  Supporting pieces:
  - `solanaConfirmed(signature, waitMs): Promise<boolean>` goes in `solana-tx.ts`: poll `connection.getSignatureStatuses([signature])` every 500 ms until `confirmationStatus` is `confirmed` or `finalized` with `err === null` (true), the status has an `err` (false), or `waitMs` elapses (false).
  - `loadOperation` is the `operations` part of `loadLeg` (owner check). If no such helper exists, inline the select and `notFound()`.
  - `lastError` values:
    - The leg that caused a stop gets `PREFLIGHT_REFUSED: <message>` (or `FEE_REFUSED: <message>` for the fee).
    - Later legs get `STOPPED`.
    - Legs failing the blockhash gate get `QUOTE_STALE`.
    - Buys released because the fee did not confirm get `STOPPED`, with the fee leg tracked.
  - `leg.released` logs `STOPPED` or `QUOTE_STALE` only, never the message, which may contain an address.
  - Do **not** strip `signedBase64` on legs that were sent; the tracker does not need it. It may stay for audit.

- [ ] **Step 5: Routes and controller.** Add `requestGroup` and `submitGroup` controller functions (parse, `ctx(req)`, call the service, `res.json`), then register the two routes in `operations.route.ts` after `/:id`.
  - `cancelOperation` also sets every `QUOTED` group of the operation to `RELEASED` and clears `groupId` on their `PLANNED` legs, in the same transaction.
  - Update the route-table snapshot.

- [ ] **Step 6: Run the tests and see them pass.** `groups.test.ts`, then `route-table.test.ts`, then `no-cycles.test.ts`, one at a time. Expected: PASS.

- [ ] **Step 7: Commit.** `feat(api): Solana signing groups with fee-first send and blockhash gate (spec 22 P1)`.

### Task 4: Needs action, Continue, Stop and the 24-hour auto-stop

**Files:**
- Create: `apps/api/src/modules/operations/continue.service.ts`
- Modify: `operations.service.ts` (`refreshOperationStatus` for grouped operations), `operations.route.ts`, `operations.controller.ts`, `apps/api/src/modules/portfolio/tracking.service.ts` (`stopStalledInvests`), `apps/api/src/worker.ts`
- Modify: route-table snapshot (one path)
- Test: `apps/api/test/modules/operations/continue.test.ts` (new)

**Interfaces:**
- Produces:
  - `continueOperation(ctx: OpCtx, opId: string, body: ContinueRequest): Promise<OperationView>`
  - Route `POST /v1/operations/:id/continue` (`validate({ params: idParam, body: continueRequestSchema })`)
  - `stopStalledInvests(): Promise<void>`, called from the same 5-minute sweep as `stopStalledRecoveries`
- Consumes: `hasGroups`, `feeShares` (not needed for retries: shares are copied), `assertSolFor`, `freeUsdcMicro`, `solanaBalance`, `notify`, `writeAudit`.

- [ ] **Step 1: Write the failing tests** in `continue.test.ts`, driving legs to states through submit mocks and `trackLeg` with the finality mocks:
  1. **Needs action, not terminal:** in a grouped invest, buy 2 `FAILED` on chain (reverted). The operation stays `IN_PROGRESS`, `needsAction` is true and `needsActionSince` is set; no `execution_incomplete` notice yet.
  2. **Completed:** every asset leg `SETTLED` gives `COMPLETED`, and `needsActionSince` is cleared.
  3. **Ungrouped is unchanged:** the same failure on an operation without groups gives `PARTIAL`, as today (mobile path).
  4. **Continue with a retry:**
     - Buy 2 `FAILED`; continue with a new key.
     - A new `PLANNED` leg has `retryOf = buy2.id`, the same `toDeploymentId` and `amountIn`, and `feeShare` and `feeCoveredBy` copied.
     - The next group charges no fee for it.
     - The original stays `FAILED`.
  5. **Continue while in flight:** a leg `SUBMITTED` or `UNKNOWN` gives 409 `OPERATION_IN_PROGRESS`.
  6. **Skip:** `skipLegIds: [buy2]` gives buy 2 `FAILED` with `failureReason: "SKIPPED"` and no retry. When the others are all `SETTLED`, the operation becomes `PARTIAL`.
  7. **Raise slippage:** `slippageBps: 250` updates `operations.slippageBps`, and the next group's quotes use 250. A value of 301 is 400.
  8. **USDC short:**
     - USDC below `Σ remaining + uncovered shares` is 409 `INSUFFICIENT_BALANCE` with `usdcRequiredMicro` and `usdcHeldMicro`.
     - With `scaleToAvailable: true`, remaining `amountIn` and uncovered shares are scaled by `available / needed` (floor, remainder to the largest), and a leg scaled to 0 is `SKIPPED`.
  9. **SOL short:** 409 `SOL_REQUIRED`.
  10. **Idempotent:** the same key twice creates retry legs once, and the second call returns the same view.
  11. **Stop with needs action:** `cancel` gives `PARTIAL` (an asset leg settled) or `FAILED`, and releases `QUOTED` groups.
  12. **Auto-stop:**
      - `needsActionSince` older than 24 h, nothing in flight: `stopStalledInvests` stops it (`PARTIAL`/`FAILED`), writes audit `operation.auto_stopped` (`reason: "needs_action_timeout"`) and one `execution_incomplete` notice ("We stopped your unfinished investment; your USDC is still in your wallet.").
      - At 23 h it does nothing.
      - With a leg `UNKNOWN` it does nothing.
      - An ungrouped operation is never touched.

- [ ] **Step 2: Run them and see them fail.** `pnpm --filter api exec vitest run test/modules/operations/continue.test.ts < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Grouped status recompute.** In `refreshOperationStatus`, after the recovery checks, branch for grouped operations (`await hasGroups(op.id)` inside the same transaction):

```ts
if (grouped) {
  // Spec 22 B-08: a grouped operation never ends on its own after a failure; it waits for Continue or Stop (or the 24 h auto-stop).
  const replaced = new Set(all.filter((l) => l.retryOf).map((l) => l.retryOf));
  const assets = legs.filter((l) => l.kind !== "network_fee" && !replaced.has(l.id));
  if (assets.some((l) => ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "UNKNOWN"].includes(l.status))) return;
  if (assets.every((l) => l.status === "SETTLED")) {
    await tx.update(operations).set({ needsActionSince: null }).where(eq(operations.id, op.id));
    await setOperationStatus(tx, ctx, op, "COMPLETED");
    return;
  }
  const actionable = assets.some((l) => l.status === "PLANNED" || (l.status === "FAILED" && l.failureReason !== "SKIPPED" && !l.recoveryToken));
  if (!actionable) { await setOperationStatus(tx, ctx, op, stopStatus(all)); return; } // only skips left: PARTIAL or FAILED
  await tx.update(operations).set({ needsActionSince: sql`coalesce(${operations.needsActionSince}, now())` }).where(eq(operations.id, op.id));
  return;
}
```

  The select in `refreshOperationStatus` must add `retryOf`, `failureReason` and `recoveryToken` to the fetched columns. Keep the existing non-grouped branch unchanged below.

- [ ] **Step 4: Implement `continueOperation`.** Inside one transaction with `lockOperation`:
  1. **Owner and state:** the owner check, the `IN_PROGRESS` check, and `hasGroups` (otherwise 409 `INVALID_TRANSITION`, "Nothing to continue.").
  2. **Idempotency:** `op.lastContinueKey === body.idempotencyKey` returns the view.
  3. **In flight:** refuse with 409 `OPERATION_IN_PROGRESS` while any leg is `SUBMITTING`, `SUBMITTED`, `PENDING_CHAIN` or `UNKNOWN`.
  4. **Skips:** each `skipLegIds` entry must be an asset leg of this operation that is `PLANNED`, or `FAILED` without `SKIPPED`; otherwise 400 `VALIDATION_FAILED`. Set `FAILED` with `failureReason: "SKIPPED"` (`setLegStatus`; FAILED to FAILED is not a transition, so update `failureReason` directly for an already-`FAILED` leg).
  5. **Retries:** for each other `FAILED` asset leg with no `retryOf` child, `failureReason` not `SKIPPED` or `DESTINATION_SWAP_FAILED`, and no `recoveryToken`, insert a `PLANNED` leg at `max(sequence) + 1`. Copy `kind`, chains, deployments, `amountIn`, `minOut`, `routeSummary` (without `tool`, `routeFees`, `priceImpact`), `gasPayer`, `feeShare` and `feeCoveredBy`, with `retryOf = original.id`.
  6. **Slippage:** apply `slippageBps` when given.
  7. **Balances:**
     - `remaining` = `PLANNED` asset legs.
     - `need = Σ amountIn + Σ uncovered shares`.
     - `held = freeUsdcMicro(db, userId, solanaBalance(owner, USDC))`.
     - If `held < need`: without `scaleToAvailable`, 409 `INSUFFICIENT_BALANCE` with details. With it, `factor = held / need`; scale every remaining `amountIn` and uncovered share by floor; give the rounding remainder to the largest `amountIn`; mark legs that hit 0 as `SKIPPED`; scale `minOut` by the same factor.
     - SOL: `assertSolFor(owner, (anyUncoveredShare ? FEE_TRANSFER_USER_LAMPORTS : 0n) + Σ BigInt(leg.expectedTx.userLamports ?? "5000") over remaining legs)` (`userLamports` from Task 2 Step 7; `"5000"` only for a retry leg copied from a pre-release plan).
  8. **Close out:** set `lastContinueKey`, call `refreshOperationStatus` (which may complete or stop the operation when only skips remain), audit `operation.continued` (`{ retries, skips, slippageBps, scaled }`), and return the view.

- [ ] **Step 5: Auto-stop.** `stopStalledInvests` is modelled on `stopStalledRecoveries`.
  - **Select:** operations `IN_PROGRESS` with `needs_action_since < now() - interval '24 hours'` (`INVEST_AUTO_STOP_HOURS`) that have a group.
  - **Under the lock, re-check:** no leg in flight and still needing action. Then `setOperationStatus(stopStatus(legs))`, release `QUOTED` groups, audit `operation.auto_stopped` (`reason: "needs_action_timeout"`), and notify `execution_incomplete` with `data.autoStopped: true` and dedupe `incomplete:<opId>`.
  - **Wiring:** register it in `worker.ts` next to `stopStalledRecoveries`, inside the existing sweep job, with the same isolation (its own try/catch per operation).

- [ ] **Step 6: Route, controller and snapshot.** Add `continueOperation`, register `POST /:id/continue`, and update the snapshot.

- [ ] **Step 7: Run the tests and see them pass.** `continue.test.ts`, `groups.test.ts`, `invest.test.ts`, `route-table.test.ts` and `no-cycles.test.ts`, one at a time. Expected: PASS.

- [ ] **Step 8: Commit.** `feat(api): needs-action, continue, skip, scale-to-available and 24 h auto-stop for batched invests (spec 22 P1)`.

### Task 5: Web batched invest, shared group signer, mobile copy and docs

**Files:**
- Create: `packages/app-core/src/group-signer.ts`, `packages/app-core/src/group-signer.test.ts`
- Modify: `packages/app-core/src/leg-signer.ts` (`Signer.signSolanaAll?`), `packages/app-core/src/index.ts` (exports), `packages/app-core/src/error-copy.ts` (+ test)
- Modify: `apps/web/lib/wallet/use-leg-signer.ts` (`signSolanaAll`, `walletName`)
- Create: `apps/web/components/invest/group-progress.tsx`, `apps/web/components/invest/needs-action.tsx`, `apps/web/components/invest/open-operation-banner.tsx`
- Modify: `apps/web/components/invest/invest-flow.tsx`, `invest-wizard.tsx`, `invest-button.tsx`, the sell, rebalance and repair entry components (banner only)
- Test: `apps/web/test/group-flow.test.tsx` (new), `apps/web/e2e/invest-batched.spec.ts` (new, mocked API)
- Docs: `docs/decisions/ADR-023-BATCHED-SIGNING.md` (new), `DECISION-REGISTER.md`, `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`, `docs/architecture/ARCHITECTURE.md` §4, `docs/OPEN-ITEMS.md`, `docs/superpowers/HANDOFF.md` §2, `docs/domains/FUTURE-PLANS.md`, `apps/api/README.md` (platform wallets: the Solana fee payer is legacy only)

**Interfaces:**
- Produces (`@repo/app-core/group-signer.ts`):

```ts
export type GroupSignerState =
  | { kind: "idle" } | { kind: "quoting" } | { kind: "priceMoved"; group: GroupResponse }
  | { kind: "signing"; group: GroupResponse } | { kind: "sending"; group: GroupResponse }
  | { kind: "done"; op: OperationView } | { kind: "needsAction"; op: OperationView } | { kind: "failed"; code: string; message: string };
export type GroupSignerEvent =
  | { type: "reset" } | { type: "quoteRequested" } | { type: "quoted"; group: GroupResponse } | { type: "accepted" }
  | { type: "signed" } | { type: "finished"; op: OperationView } | { type: "failed"; code: string; message: string };
export function groupSignerReducer(s: GroupSignerState, e: GroupSignerEvent): GroupSignerState;
export type GroupSignerApi = { requestGroup(id: string, b: GroupRequest): Promise<GroupResponse>; submitGroup(id: string, g: string, b: GroupSubmit): Promise<OperationView> };
/** One chunk: quote → (accept new prices) → wallet → submit. Tier `single` signs one transaction per popup; `sign_all` one popup. Downgrades on "unsupported". */
export async function runGroup(api: GroupSignerApi, signer: Signer, opId: string, dispatch: (e: GroupSignerEvent) => void,
  opts: { tier: "sign_all" | "single"; walletName?: string; acceptNewPrices(g: GroupResponse): Promise<boolean>; onDowngrade(): void }): Promise<OperationView | null>;
```

- `Signer.signSolanaAll?(serializedBase64: string[]): Promise<string[]>` (optional; mobile omits it).
- Web `useLegSigner` returns `signSolanaAll` (Reown provider `signAllTransactions`, the same wallet selection as `signSolana`) and `walletName` (from `useAppKitAccount`, `walletInfo?.name`).

- [ ] **Step 1: Write the failing app-core tests** (`group-signer.test.ts`):
  1. **Reducer:** ignores a late `quoted` after `failed`; `priceMoved` only reachable from `quoting`; `accepted` moves `priceMoved` to `signing`.
  2. **`runGroup` happy path:** `requestGroup`, then `signSolanaAll` with the transactions in response order, then `submitGroup` mapping results back to `legId` in that order. `done` when the operation is `COMPLETED`, otherwise `needsAction` when `op.needsAction`, otherwise `done`.
  3. **Price moved:** `priceMoved: true` calls `acceptNewPrices`; on false, nothing is signed, the state resets, and `submitGroup` is not called.
  4. **Unsupported:**
     - `signSolanaAll` throws `new Error("signAllTransactions is not supported")`: `onDowngrade` is called and the same group is signed one by one with `signSolana` (N calls), then submitted.
     - A `WalletRejectedError` does **not** downgrade; it ends `failed` with code `WALLET_REJECTED`.
  5. **`GROUP_EXPIRED`** from submit ends `failed` with that code, and `submitGroup` is not retried automatically.

- [ ] **Step 2: Run them and see them fail.** `pnpm --filter @repo/app-core exec vitest run src/group-signer.test.ts < /dev/null`. Expected: FAIL.

- [ ] **Step 3: Implement `group-signer.ts`.**
  - A `FROM` table like `leg-signer.ts`.
  - `runGroup`:
    1. `dispatch quoteRequested`; `requestGroup(opId, { chain: "solana", tier, walletName, idempotencyKey: crypto.randomUUID() })`; `dispatch quoted`.
    2. If `priceMoved`, await `acceptNewPrices`; `false` means `reset` and return null.
    3. Sign: `tier === "sign_all" && signer.signSolanaAll ? signSolanaAll(txs) : sequential signSolana`. Catch an "unsupported" message (`/not supported|unsupported|not implemented|not a function/i`) by calling `onDowngrade()` and falling back to sequential.
    4. `dispatch signed`; `submitGroup`; `dispatch finished`.
  - Errors go through `legErrorInfo`.
  - Export from `index.ts`. Add `signSolanaAll?` to `Signer`.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Error copy.** In `packages/app-core/src/error-copy.ts`:
  - Add `GROUP_EXPIRED: { title: "Quotes expired", message: "These quotes expired before they were sent. Get new quotes — nothing was spent.", recovery: "retry" }`.
  - Make the `SOL_REQUIRED` message use the amount when the error has `details.lamportsRequired` and `details.lamportsHeld`: "Add about X SOL to your Solana wallet, then continue." with `X = (required - held) / 1e9` rounded up to 4 decimals. Keep the generic text when details are absent (mobile and older APIs).
  - Add a test for both.

- [ ] **Step 6: Web.**
  - **`use-leg-signer.ts`:** add `signSolanaAll` (deserialize all, `provider.signAllTransactions(txs)`, re-serialize, through `guard`) and `walletName`.
  - **`invest-flow.tsx`:**
    - **Review step** (plan estimates; nothing expires here):
      - "About N wallet approvals" from `plan.approvalsEstimate`.
      - A SOL line: "Network fees: about X SOL, paid by you in SOL", where X is `solRequiredLamports − SOL_BUFFER_LAMPORTS` formatted, and "keep about 0.001 SOL extra" in muted text.
      - Fee lines plus "Fees are charged per batch; batches you never send aren't charged."
      - For more than 10 asset legs, a checkbox "I've checked the minimum amounts" that gates Confirm (spec §15 Q6).
    - **Confirm:** request the plan with `tier: "sign_all"`, then loop `runGroup` until no `PLANNED` Solana asset leg without an error remains, or the state is `needsAction` or `failed`.
      - The wallet opens immediately after `quoted` unless `priceMoved`.
      - **Prices updated strip:** shows the fresh `estimatedOut`/`minOut` per leg and a countdown to `sendBy` (`use-countdown.ts`).
      - When `priceMoved`, the strip shows **Accept new prices** and `acceptNewPrices` resolves on that click; dismissing resolves false.
      - `onDowngrade` sets tier `single` for the rest of the session (React state).
  - **`group-progress.tsx`:** per group "Sending 7 of 12 · confirmed 5", from polling `GET /v1/operations/:id` every 3 s while any leg is in flight (TanStack Query `refetchInterval`).
  - **`needs-action.tsx`** (shown when `op.needsAction`):
    - Each failed or released leg with its `lastError` or `failureReason` in plain words (`QUOTE_STALE` reads "Quote expired before sending — nothing spent").
    - Buttons: **Continue** (`continueOperation({ idempotencyKey })`, then the group loop), **Raise slippage** (select up to 3%, then Continue with `slippageBps`), **Skip <asset>** (Continue with `skipLegIds`), **Invest what's available** (shown after an `INSUFFICIENT_BALANCE` from Continue: Continue with `scaleToAvailable: true`), and **Stop** (`cancelOperation`).
    - Text: "Continue is free until <needsActionSince + 24 h, local time>; stopping keeps fees already paid."
  - **`open-operation-banner.tsx`:** reads `portfolio.openOperations` (existing query). When one has `needsAction` or is `IN_PROGRESS`, it shows "Finish or stop your open investment" with **Continue** (link to the operation page) and **Stop**. Render it at the top of `invest-flow.tsx`, `invest-wizard.tsx`, `invest-button.tsx` (disabled state plus banner) and the sell, rebalance and repair entry components (find them with `rg -l "sellPlan|rebalancePlan|repairPlan" apps/web/components apps/web/app`).
  - **Errors** go through `toDisplayError`, which already uses app-core copy: `SOL_REQUIRED` with the amount, `INSUFFICIENT_BALANCE` (show `usdcRequiredMicro` when present), `GROUP_EXPIRED` ("Get new quotes", which runs the next `runGroup`).

- [ ] **Step 7: Web tests.** `apps/web/test/group-flow.test.tsx`, using the existing render helpers and mocks of `api` and `useLegSigner`:
  1. The review shows "About 1 wallet approval" and the SOL line.
  2. Confirm calls `requestGroup`, then `signSolanaAll` once, then `submitGroup`.
  3. `priceMoved` shows **Accept new prices**, and the wallet is not called before the click.
  4. Needs-action renders Continue, Raise slippage, Skip, Stop, and the 24 h text.
  5. The banner shows on the invest button when an open operation exists.
  6. `SOL_REQUIRED` with details renders "Add about 0.0042 SOL".

  E2E `apps/web/e2e/invest-batched.spec.ts` (the mocked API pattern of the existing e2e specs): a happy path, and a partial plus Continue.

- [ ] **Step 8: Run the web and app-core gates.** One at a time: `pnpm --filter @repo/app-core test`, `pnpm --filter web lint`, `pnpm --filter web check-types`, `pnpm --filter web exec vitest run`, `pnpm --filter web build`, `pnpm --filter mobile test` (mobile must still pass: `Signer.signSolanaAll` is optional), all with `< /dev/null`. Expected: PASS.

- [ ] **Step 9: Docs in place** (spec §14, P1 scope only):
  - **`ADR-023-BATCHED-SIGNING.md`** (from `ADR-TEMPLATE.md`): decision B-01, B-02, B-03, B-05, B-06, B-08 (24 h invest, 7 d later for rebalance and sell), B-09, B-17, B-21, B-23; the blockhash gate and `sendBy`; the per-leg exclusivity and needs-action-only-when-grouped rulings; `operation_fee_charges`; status `APPROVED; P1 IMPLEMENTED`.
  - **`DECISION-REGISTER.md`:**
    - Rewrite D-067: "Platform gas is recovered through the network fee only for EVM gas drops; Solana gas is paid by the user in SOL (ADR-023)."
    - Rewrite D-068: "Solana legs are user-paid (`user_solana`); EVM legs get one gas drop; per-user and global daily caps apply to EVM; the Solana fee payer remains only for legs planned before Spec 22 until P4."
    - Rewrite D-072: drop the fee-payer co-sign clause and keep reservations.
    - Rewrite D-090: "Fees are charged per signing group on that group's legs; a group never sent is never charged; a sent fee is not refunded (ADR-023)."
    - Rewrite D-094: "`SOL_REQUIRED` carries the exact shortfall at plan time and at group quote; no platform SOL drop."
    - Add D-123 to D-126: signing groups, fee per group, needs-action/Continue/auto-stop (24 h invest), and user-paid Solana gas, each one sentence with ADR-023.
  - **`INVESTMENT-REBALANCING-DRIFT-FIX.md`:** the first-investment and signing bullets now describe batches, user-paid SOL, needs action and Continue (rewrite the "Signing: strictly one leg at a time…" bullet in place; mobile keeps per-leg).
  - **`ARCHITECTURE.md`** §4 "Invest or exit" bullet: groups and user-paid SOL. §1 HANDOFF paragraph wording "the platform only co-signs as Solana fee payer" becomes "sends capped EVM gas drops".
  - **`OPEN-ITEMS.md`:** add the mobile device check (invest with user-paid SOL on Android, D-041), "re-enable D-073 before launch", "tune K and `sendBy` from P0 and telemetry", and "retire the Solana fee payer (P4)".
  - **`FUTURE-PLANS.md`:** mark "Batched signing by wallet family" and option 3 as built for invest (Solana). The EVM and rebalance parts stay pointing to P2/P3, plus fee-in-EVM-batch (B-16).
  - **`HANDOFF.md`** §2: a Spec 22 P1 row.

- [ ] **Step 10: Full gate**, in the background, observed to completion: `pnpm turbo run lint check-types test build --continue --concurrency=1 --force < /dev/null`. Expected: every task passes (re-run any `3221226505` api file alone and record it).

- [ ] **Step 11: Commit.** `feat(web,app-core): batched Solana signing for invest with needs-action and stop banners; docs (spec 22 P1)`.

---

## Self-review notes (for the executor)

- **Spec items deferred out of P1:**
  - §7 sells, repair, rebalance on groups; EVM `wallet_sendCalls`; group gas drops (P2/P3).
  - B-07 sign-and-send (P0 decides).
  - B-19, B-20 (P2).
  - Continuation operations (P3).
  - Retiring the fee payer (P4).
- **Rulings made here:**
  - Needs-action semantics only for grouped operations (keeps mobile unchanged; cost if wrong: mobile users see PARTIAL after a failure, as today).
  - The plan fee leg is reused by the first group (cost: none; its `amountIn` changes only while `PLANNED` and unclaimed).
  - Charges are written per fee leg and the old rows are backfilled (cost: report queries change; covered by tests).
