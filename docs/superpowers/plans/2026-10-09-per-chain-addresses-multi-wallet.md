# Per-chain addresses and web multi-wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user link a different wallet address per chain (tick chains, one approval per wallet), move a chain to another wallet only when it is empty, execute every leg against the chain's own address, and on web keep several wallets connected with automatic wallet selection per signing step.

**Architecture:** `wallet_addresses` stays one row per chain; the family-wide address rule is dropped for EVM and Solana and replaced by "one active row per (wallet, chain)" plus a `replaced` status. Execution keeps calling `addressOn(addresses, chain)`, which now reads the chain's own address. Web uses Reown's paid Multiwallet hooks (`useAppKitConnections`, `useAppKitConnection().switchConnection`); mobile keeps one wallet per family with a "Connect X to sign this step" prompt.

**Tech Stack:** Postgres + drizzle-orm 0.45 (migrations via drizzle-kit), Express API (vitest, supertest), zod validators, `@repo/app-core` shared logic, Next.js web (`@reown/appkit` 1.8.24, wagmi), Expo SDK 57 mobile (`@reown/appkit-react-native` 2.0.6, jest-expo).

**Spec:** `docs/superpowers/specs/2026-10-09-per-chain-addresses-multi-wallet-design.md`

## Global Constraints

- Linkable and sign-in chains: Solana, Ethereum, Base, BNB Chain, Arbitrum, **Polygon**; Bitcoin is link-only and keeps one address per account (`CHAIN_FAMILY_ALREADY_LINKED` stays for Bitcoin only).
- One **active** address per chain per wallet; rows are never deleted (`replaced` / `disabled` keep history).
- `chains` on the challenge is optional: omitted = every chain of the address's family (backward compatible); apps always send it.
- Smart-contract wallets (`erc1271`, `erc6492`) link only the chain they were verified on; the check happens at verify.
- Reassign only when the chain is empty: no open operation, no position units on the chain, zero on-chain balance of every registered deployment on that chain at the old address.
- Error codes: `CHAIN_ALREADY_LINKED` (409), `CHAIN_NOT_LINKED` (409), `CHAIN_NOT_EMPTY` (409), existing `OPERATION_IN_PROGRESS` (409).
- Unchanged: USDC on Solana funding (D-030), one leg at a time with server checks (ADR-014), fees, sessions (session rotates on `add_chain_account` and `reassign_chain`).
- Code rules (CODING-STANDARDS): `@/` imports, cross-module calls only through `<module>.service`, files CRLF in the working tree (normalize line endings when editing with scripts), never stage `apps/api/test/__snapshots__/route-table.test.ts.snap` unless an endpoint is intentionally added (Task 3 adds one: update and stage it there), never run two API test suites at once.

## Review Focus

1. A user links Base to `0xAAA` and later signs in with `0xBBB` that is linked to Ethereum on the same account → same account, no new user (Task 2 test "sign-in from any linked chain").
2. Reassign raced with a new invest plan for the same chain → the plan must not deliver to the old address (Task 4 tests "reassign refused while an operation is open" and "plan after reassign uses the new address").
3. A user ticks a chain already linked to the same address → idempotent success, no session rotation (Task 2 test "same address same chain is idempotent").
4. Polygon assets held by existing users before the migration → still found at the backfilled Polygon row (Task 1 test "backfill gives EOA wallets a polygon row").
5. Web signer when the leg's chain is linked to a wallet that is connected but not active → switches instead of failing (Task 7 test "switches to the connection holding the linked address").

---

### Task 1: Schema, migration and validator contracts

**Files:**
- Modify: `packages/validator/src/chains.ts`, `packages/validator/src/auth.ts`, `packages/validator/src/me.ts`, `packages/validator/src/errors.ts`
- Modify: `packages/db/src/schema/enums.ts`, `packages/db/src/schema/identity.ts`
- Create: `packages/db/migrations/0022_per_chain_addresses.sql` (generated, then the backfill appended)
- Test: `packages/validator/src/chains.test.ts` (create if absent), `apps/api/test/modules/auth/per-chain-migration.test.ts`

**Interfaces:**
- Produces: `chainSchema` and `CHAINS` include `polygon` (`evmChainId: 137`); `challengePurposeSchema` = `["sign_in", "add_chain_account", "reassign_chain"]`; `challengeRequestSchema.chains?: AssetChain[]`; `walletAddressViewSchema.walletName?: string | null`, `status: "active" | "disabled" | "replaced"`; error codes `CHAIN_ALREADY_LINKED`, `CHAIN_NOT_LINKED`, `CHAIN_NOT_EMPTY` mapped to 409; DB columns `wallet_addresses.wallet_name`, `replaced_at`, `replaced_by_address_id`, `auth_challenges.chains text[]`.

- [ ] **Step 1: Write the failing validator test**

```ts
// packages/validator/src/chains.test.ts
import { describe, expect, it } from "vitest";
import { challengeRequestSchema } from "./auth";
import { CHAINS, chainFromEvmChainId, chainsInFamily, signInChainSchema } from "./chains";
import { ERROR_STATUS } from "./errors";

describe("per-chain addresses contracts", () => {
  it("Polygon is a linkable and sign-in EVM chain", () => {
    expect(CHAINS.polygon).toEqual({ family: "evm", label: "Polygon", evmChainId: 137 });
    expect(chainsInFamily("evm")).toEqual(["ethereum", "base", "bnb", "arbitrum", "polygon"]);
    expect(signInChainSchema.options).toContain("polygon");
    expect(chainFromEvmChainId(137)).toBe("polygon");
  });
  it("challenge accepts optional chains and the reassign purpose", () => {
    expect(challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc", chains: ["base", "bnb"] }).chains).toEqual(["base", "bnb"]);
    expect(challengeRequestSchema.parse({ purpose: "reassign_chain", chain: "base", address: "0xabc" }).chains).toBeUndefined();
    expect(() => challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc", chains: [] })).toThrow();
    expect(() => challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc", chains: ["base", "base"] })).toThrow();
  });
  it("new error codes are 409", () => {
    expect(ERROR_STATUS.CHAIN_ALREADY_LINKED).toBe(409);
    expect(ERROR_STATUS.CHAIN_NOT_LINKED).toBe(409);
    expect(ERROR_STATUS.CHAIN_NOT_EMPTY).toBe(409);
  });
});
```

(Check the name of the code-to-status map in `errors.ts` first; if it is not `ERROR_STATUS`, use the exported name.)

- [ ] **Step 2: Run it and see it fail**

Run: `cd packages/validator && pnpm exec vitest run src/chains.test.ts`
Expected: FAIL (`CHAINS.polygon` undefined, `chains` rejected by the strict schema).

- [ ] **Step 3: Implement the validator changes**

`chains.ts`:
```ts
export const chainSchema = z.enum(["ethereum", "base", "bnb", "arbitrum", "polygon", "solana", "bitcoin"]);
// in CHAINS, after arbitrum:
  polygon: { family: "evm", label: "Polygon", evmChainId: 137 },
```
`auth.ts`:
```ts
export const challengePurposeSchema = z.enum(["sign_in", "add_chain_account", "reassign_chain"]);

export const challengeRequestSchema = z.strictObject({
  purpose: challengePurposeSchema,
  chain: signInChainSchema,
  address: z.string().trim().min(1).max(128),
  /** D-120: chains to link with this address (same family). Omitted = every chain of the family (backward compatible). */
  chains: z.array(assetChainSchema).min(1).max(5).refine((c) => new Set(c).size === c.length, "Chains must be distinct").optional(),
});
```
`me.ts` in `walletAddressViewSchema`:
```ts
  status: z.enum(["active", "disabled", "replaced"]),
  /** D-120: the wallet app reported when this chain was linked. */
  walletName: z.string().nullish(),
```
`errors.ts`: add `"CHAIN_ALREADY_LINKED", "CHAIN_NOT_LINKED", "CHAIN_NOT_EMPTY"` to `ERROR_CODES` and map each to `409` in the status map. Keep `CHAIN_FAMILY_ALREADY_LINKED` (Bitcoin).

- [ ] **Step 4: Run the validator test**

Run: `cd packages/validator && pnpm exec vitest run`
Expected: PASS (fix any existing test that enumerates `chainSchema.options` or `ERROR_CODES` length).

- [ ] **Step 5: DB schema**

`packages/db/src/schema/enums.ts`:
```ts
export const chain = app.enum("chain", ["ethereum", "base", "bnb", "arbitrum", "polygon", "solana", "bitcoin"]);
export const addressStatus = app.enum("address_status", ["active", "disabled", "replaced"]);
export const challengePurpose = app.enum("challenge_purpose", ["sign_in", "add_chain_account", "payout_wallet", "reassign_chain"]);
```
`identity.ts` `walletAddresses` columns (after `disabledReason`):
```ts
    /** D-120: wallet app reported at link time. */
    walletName: text("wallet_name"),
    replacedAt: ts("replaced_at"),
    replacedByAddressId: uuid("replaced_by_address_id").references((): AnyPgColumn => walletAddresses.id),
```
and in the table extras:
```ts
    uniqueIndex("wallet_addresses_active_chain_key").on(t.investmentWalletId, t.chain).where(sql`${t.status} = 'active'`),
    check("wallet_addresses_replaced", sql`${t.status}::text <> 'replaced' OR (${t.replacedAt} IS NOT NULL AND ${t.replacedByAddressId} IS NOT NULL)`),
```
`authChallenges` gains `chains: text("chains").array(),`.

- [ ] **Step 6: Generate the migration and append the backfill**

Run: `cd packages/db && pnpm exec drizzle-kit generate --name per_chain_addresses`
Then append to `migrations/0022_per_chain_addresses.sql` (enum values added by `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as enum literals, so cast through text):
```sql
--> statement-breakpoint
INSERT INTO "app"."wallet_addresses" ("id", "investment_wallet_id", "chain_family", "chain", "address", "status", "verification_method", "verified_on_chain", "verification_challenge_id", "verified_at", "signable_chains", "created_at")
SELECT gen_random_uuid(), w."investment_wallet_id", w."chain_family", 'polygon'::text::"app"."chain", w."address", 'active', w."verification_method", w."verified_on_chain", w."verification_challenge_id", w."verified_at", w."signable_chains", now()
FROM (SELECT DISTINCT ON ("investment_wallet_id", "address") * FROM "app"."wallet_addresses"
      WHERE "chain_family" = 'evm' AND "verification_method" = 'eoa_ecdsa' AND "status" = 'active'
      ORDER BY "investment_wallet_id", "address", "created_at") w
ON CONFLICT DO NOTHING;
```
If drizzle placed the `ADD VALUE` statements in the same file, move the `INSERT` into a second migration `0023_backfill_polygon.sql` (run `drizzle-kit generate --custom --name backfill_polygon` and paste the INSERT) so the new enum value is committed first.

- [ ] **Step 7: Migration test**

```ts
// apps/api/test/modules/auth/per-chain-migration.test.ts
import { describe, expect, it } from "vitest";
import { adminSql } from "../../helpers/db";

describe("per-chain migration", () => {
  it("has one active row per wallet and chain, and accepts polygon", async () => {
    const idx = await adminSql`select indexdef from pg_indexes where indexname = 'wallet_addresses_active_chain_key'`;
    expect(idx[0]?.indexdef).toContain("WHERE (status = 'active'");
    const enumVals = await adminSql`select unnest(enum_range(null::app.chain))::text as v`;
    expect(enumVals.map((r) => r.v)).toContain("polygon");
  });
});
```
(Check `test/helpers/db.ts` for the admin client export name; `add-chain-account.test.ts` imports `adminSql`.)

- [ ] **Step 8: Run DB and API type-checks and the migration test**

Run: `cd apps/api && pnpm exec tsc --noEmit && pnpm exec vitest run test/modules/auth/per-chain-migration.test.ts`
Expected: tsc errors only where code uses `status` exhaustively or `chainSchema` lists (fix them: treat `replaced` like `disabled` in displays); test PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/validator/src packages/db/src packages/db/migrations apps/api/test/modules/auth/per-chain-migration.test.ts
git commit -m "feat(db): per-chain address schema, Polygon chain and reassign purpose (D-120)"
```

---

### Task 2: Link exactly the ticked chains (challenge and verify)

**Files:**
- Modify: `apps/api/src/modules/auth/sign-in.service.ts`, `apps/api/src/modules/auth/sign-in-message.service.ts`, `apps/api/src/modules/auth/wallets.service.ts`, `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/me/me.service.ts`
- Modify: `apps/api/test/helpers/auth.ts`, `apps/api/test/modules/auth/add-chain-account.test.ts`, `apps/api/test/modules/auth/sign-in.test.ts`
- Test: `apps/api/test/modules/auth/link-chains.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and columns.
- Produces: `issueChallenge({ ..., chains?: AssetChain[] })` stores `chains`; `verifyChallenge` registers `ch.chains ?? chainsInFamily(family)`; `insertAddresses` rows carry `walletName`; `/me` address rows include `walletName`.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/modules/auth/link-chains.test.ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, walletAddresses } from "@repo/db";
import type { AssetChain, Chain } from "@repo/validator";
import { app } from "@/app";
import { webHeaders, type TestWallet } from "../../helpers/auth";
import { resetDb, testDb } from "../../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

async function link(w: TestWallet, chain: Chain, chains: AssetChain[] | undefined, opts: { purpose?: "sign_in" | "add_chain_account"; cookie?: string; walletProvider?: string } = {}) {
  const headers = webHeaders(opts.cookie);
  const ch = await request(app).post("/v1/auth/challenge").set(headers).send({ purpose: opts.purpose ?? "sign_in", chain, address: w.address, ...(chains ? { chains } : {}) });
  if (ch.status !== 200) return ch;
  return request(app).post("/v1/auth/verify").set(headers).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web", walletProvider: opts.walletProvider });
}
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="))!;
const active = async () => (await db.select().from(walletAddresses)).filter((r) => r.status === "active").map((r) => `${r.chain}:${r.address.slice(0, 6)}`).sort();

describe("link exactly the ticked chains (D-120)", () => {
  it("sign-up links only the ticked chains and the message names them", async () => {
    const w = newEvmWallet();
    const ch = await request(app).post("/v1/auth/challenge").set(webHeaders()).send({ purpose: "sign_in", chain: "base", address: w.address, chains: ["base", "bnb"] });
    expect(ch.body.message).toContain("Base, BNB Chain");
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web", walletProvider: "MetaMask" });
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).map((r) => [r.chain, r.walletName])).toEqual(expect.arrayContaining([["base", "MetaMask"], ["bnb", "MetaMask"]]));
    expect(await active()).toHaveLength(2);
  });

  it("omitted chains keep today's behaviour (every EVM chain, Polygon included)", async () => {
    await link(newEvmWallet(), "base", undefined);
    expect((await active()).map((r) => r.split(":")[0])).toEqual(["arbitrum", "base", "bnb", "ethereum", "polygon"]);
  });

  it("a second wallet links other chains of the same family to the same account", async () => {
    const a = await link(newEvmWallet(), "base", ["base", "bnb"]);
    const res = await link(newEvmWallet(), "ethereum", ["ethereum", "arbitrum"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(200);
    expect(await active()).toHaveLength(4);
  });

  it("a chain already linked to a different address is CHAIN_ALREADY_LINKED", async () => {
    const a = await link(newEvmWallet(), "base", ["base"]);
    const res = await link(newEvmWallet(), "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_ALREADY_LINKED");
  });

  it("same address same chain is idempotent and does not rotate the session", async () => {
    const w = newEvmWallet();
    const a = await link(w, "base", ["base"]);
    const res = await link(w, "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await db.select().from(sessions)).filter((s) => s.revokeReason === "rotated")).toHaveLength(0);
  });

  it("sign-in from any linked chain reaches the same account", async () => {
    const first = newEvmWallet();
    const a = await link(first, "base", ["base"]);
    const second = newEvmWallet();
    await link(second, "ethereum", ["ethereum"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    const again = await link(second, "ethereum", ["ethereum"]);
    expect(again.body.userId).toBe(a.body.userId);
    expect(again.body.isNewUser).toBe(false);
  });

  it("chains outside the address family are a 400", async () => {
    const res = await link(newSolanaWallet(), "solana", ["solana", "base"]);
    expect(res.status).toBe(400);
  });
});
```

Add to `sign-in.test.ts` (smart wallet case, next to the existing ERC-1271 test, reusing its setup that mocks `verifyContractSignature` true): a challenge with `chains: ["base", "arbitrum"]` verified as `erc1271` → 400 `VALIDATION_FAILED` and no rows; with `chains: ["base"]` → 200.

- [ ] **Step 2: Run and see the failures**

Run: `cd apps/api && pnpm exec vitest run test/modules/auth/link-chains.test.ts`
Expected: FAIL (strict schema rejects nothing now, but rows are still all four chains; message lacks chain names; second EVM wallet gets `CHAIN_FAMILY_ALREADY_LINKED`).

- [ ] **Step 3: Message names the chains**

`sign-in-message.service.ts`: add `chains?: readonly Chain[]` to `SignInMessageInput`; build the statement:
```ts
const statementFor = (chains?: readonly Chain[]) =>
  chains && chains.length > 0 ? `${SIGN_IN_STATEMENT} Link this address for: ${chains.map((c) => CHAINS[c].label).join(", ")}.` : SIGN_IN_STATEMENT;
```
Use `statementFor(i.chains)` for the EVM (`statement:`) and Solana messages.

- [ ] **Step 4: Challenge stores the chains**

`issueChallenge` input gains `chains?: AssetChain[]`. Validate and store:
```ts
  const family = familyOf(i.chain);
  const chains = i.chains ?? (i.purpose === "reassign_chain" ? [i.chain] : chainsInFamily(family));
  if (chains.some((c) => ASSET_CHAINS[c].family !== family) || !chains.includes(i.chain))
    throw createHttpError("Pick chains of this wallet's network family, including the connected one.", { code: "VALIDATION_FAILED" });
  // pass `chains` to buildSignInMessage and to the insert: `chains`
```
(`chainsInFamily` returns `Chain[]`; it is a subset of `AssetChain`.) Controller: pass `body.chains`.

- [ ] **Step 5: Verify registers the stored chains**

In `finalize`:
```ts
  const wanted = (ch.chains ?? chainsInFamily(familyOf(ch.chain))) as Chain[];
  if (method !== "eoa_ecdsa" && method !== "ed25519" && !(wanted.length === 1 && wanted[0] === ch.chain))
    throw createHttpError("Smart-contract wallets link one chain at a time.", { code: "VALIDATION_FAILED" });
  const rows: NewAddressRow[] = wanted.map((chain) => ({ chain, address: ch.address, method, verifiedOnChain: ch.chain, challengeId: ch.id, walletName: input.walletProvider ?? null }));
```
Add `VALIDATION_FAILED` to `TERMINAL`. Replace the add-chain family check with a per-chain check (keep the Bitcoin family rule):
```ts
  if (family === "bitcoin" && existing.some((a) => a.chainFamily === "bitcoin" && a.status === "active" && a.address !== ch.address))
    throw createHttpError("A different address in this chain family is already linked", { code: "CHAIN_FAMILY_ALREADY_LINKED" });
  const clash = rows.find((r) => existing.some((a) => a.status === "active" && a.chain === r.chain && a.address !== ch.address));
  if (clash) throw createHttpError(`${CHAINS[clash.chain].label} is already linked to another wallet. Move it first.`, { code: "CHAIN_ALREADY_LINKED" });
  const have = new Set(existing.filter((a) => a.address === ch.address && a.status === "active").map((a) => a.chain));
  const toInsert = rows.filter((r) => !have.has(r.chain));
  if (toInsert.length === 0) { await recordSignableChains(tx, ch.chain, ch.address, input.signableChains); return { userId: auth.userId, isNewUser: false, issued: null }; }
```
Add `CHAIN_ALREADY_LINKED` to `TERMINAL`. The `owner` short-circuit in add-chain (`if (owner) { ... idempotent }`) must only apply when every wanted chain is already active for that address; otherwise continue into the insert path (owner is the same user). For `sign_in` with a known owner, insert any wanted chains the owner's wallet lacks, applying the same clash check, before creating the session.

`wallets.service.ts`: `NewAddressRow` gains `walletName: string | null`; `insertAddresses` writes `walletName: r.walletName`.

`me.service.ts` address mapping adds `walletName: a.walletName ?? null`.

- [ ] **Step 6: Update test helpers and old tests**

`test/helpers/auth.ts` `challengeFor` body type gains `chains?: AssetChain[]` (forwarded as is). In `add-chain-account.test.ts`, replace the test "different address in an already-linked family → 409 CHAIN_FAMILY_ALREADY_LINKED" with: a different EVM address on a chain the user already has → 409 `CHAIN_ALREADY_LINKED`; and add: a different EVM address on a chain the user lacks → 200. Keep the Bitcoin family assertion in `test/providers/bitcoin-link.test.ts` unchanged. Fix "EOA sign-up registers 4 EVM chains" to expect 5 (Polygon).

- [ ] **Step 7: Run the auth suite**

Run: `cd apps/api && pnpm exec vitest run test/modules/auth test/modules/me test/providers/bitcoin-link.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/auth apps/api/src/modules/me apps/api/test/helpers/auth.ts apps/api/test/modules/auth apps/api/test/providers/bitcoin-link.test.ts
git commit -m "feat(api): link the ticked chains per address; CHAIN_ALREADY_LINKED (D-120)"
```

---

### Task 3: Execution and investability per chain

**Files:**
- Modify: `apps/api/src/modules/auth/wallets.service.ts` (`Addresses`, `userAddresses`, `addressOn`)
- Modify: `apps/api/src/modules/operations/investability.service.ts`, `packages/validator/src/execution.ts` (`investabilitySchema.requiredChains`)
- Test: `apps/api/test/modules/operations/per-chain-addresses.test.ts`

**Interfaces:**
- Produces: `type Addresses = Partial<Record<AssetChain, string>>`; `userAddresses(db, userId): Promise<Addresses>` (active rows; Bitcoin keyed `bitcoin`); `addressOn(addresses, chain): string` throws `CHAIN_NOT_LINKED` (409) or `BTC_ADDRESS_REQUIRED` for Bitcoin; `Investability.requiredChains: AssetChain[]`.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/modules/operations/per-chain-addresses.test.ts
import { describe, expect, it } from "vitest";
import { addressOn } from "@/modules/auth/wallets.service";

describe("addressOn per chain (D-120)", () => {
  const a = { solana: "So1", base: "0xaaa", arbitrum: "0xccc" };
  it("reads the chain's own address", () => {
    expect(addressOn(a, "base")).toBe("0xaaa");
    expect(addressOn(a, "arbitrum")).toBe("0xccc");
  });
  it("a chain without an address is CHAIN_NOT_LINKED", () => {
    expect(() => addressOn(a, "bnb")).toThrow(expect.objectContaining({ code: "CHAIN_NOT_LINKED", status: 409 }));
  });
});
```
Plus an integration test in the same file using the existing invest-plan test setup (`test/modules/operations/invest*.test.ts` fixtures: basket with a Base and an Arbitrum constituent, mocked route provider): user linked Base → `0xaaa`, Arbitrum → `0xccc`; assert the mocked provider's `quote` received `toAddress: "0xaaa"` for the Base leg and `"0xccc"` for the Arbitrum leg. And investability: a basket with an Arbitrum asset for a user without Arbitrum → reason code `CHAIN_NOT_LINKED`, `requiredChains` contains `arbitrum`. And "plan after reassign uses the new address": reassign Base (Task 3 path, balances mocked 0) then plan → Base leg `toAddress` is the new address.

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/api && pnpm exec vitest run test/modules/operations/per-chain-addresses.test.ts`
Expected: FAIL (`addressOn(a, "bnb")` returns the family address / throws NOT_ELIGIBLE).

- [ ] **Step 3: Implement**

`wallets.service.ts`:
```ts
export type Addresses = Partial<Record<AssetChain, string>>;

export async function userAddresses(db: DbOrTx, userId: string): Promise<Addresses> {
  const rows = await db.select({ chain: walletAddresses.chain, address: walletAddresses.address }).from(investmentWallets)
    .innerJoin(walletAddresses, and(eq(walletAddresses.investmentWalletId, investmentWallets.id), eq(walletAddresses.status, "active")))
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")));
  return Object.fromEntries(rows.map((r) => [r.chain, r.address]));
}

export function addressOn(addresses: Addresses, chain: AssetChain): string {
  const a = addresses[chain];
  if (a) return a;
  if (chain === "bitcoin") throw createHttpError("Link a bitcoin wallet first.", { code: "BTC_ADDRESS_REQUIRED" });
  throw createHttpError(`Link a wallet for ${ASSET_CHAINS[chain].label} first.`, { code: "CHAIN_NOT_LINKED" });
}
```
`investability.service.ts`: collect `chains` (a `Set<AssetChain>`) next to `families`; result gains `requiredChains: ["solana", ...chains]` (deduped); `eligibilityOf(db, userId, requiredChains)` checks active rows per chain:
```ts
  const linkedChains = new Set((await db.select({ chain: walletAddresses.chain }).from(investmentWallets)
    .innerJoin(walletAddresses, and(eq(walletAddresses.investmentWalletId, investmentWallets.id), eq(walletAddresses.status, "active")))
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")))).map((r) => r.chain));
  for (const c of required) {
    if (!linkedChains.has(c)) reasons.push(c === "bitcoin"
      ? { code: "BTC_ADDRESS_REQUIRED", message: "Link a Bitcoin wallet." }
      : { code: "CHAIN_NOT_LINKED", message: `Link a wallet for ${ASSET_CHAINS[c].label}.` });
  }
```
Keep `requiredFamilies` in the response (compatibility). `investabilitySchema` gains `requiredChains: z.array(assetChainSchema).optional()`.

- [ ] **Step 4: Run the operations, portfolio and rebalance suites**

Run (one at a time): `cd apps/api && pnpm exec vitest run test/modules/operations` then `pnpm exec vitest run test/modules/portfolio test/modules/rebalance test/modules/fees`
Expected: PASS. Fix fixtures that build `Addresses` as `{ evm, solana }` to the per-chain shape (`{ ethereum, base, bnb, arbitrum, polygon, solana }`), and expectations on `EVM_ADDRESS_REQUIRED` to `CHAIN_NOT_LINKED`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test packages/validator/src
git commit -m "feat(api): execution and investability read each chain's own address (D-120)"
```

---

### Task 4: Move a chain to another wallet (`reassign_chain`)

**Files:**
- Create: `apps/api/src/modules/auth/reassign.service.ts`
- Modify: `apps/api/src/modules/auth/auth.route.ts`, `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/sign-in.service.ts` (claim purposes), `packages/api-client/src/client.ts`, `packages/validator/src/auth.ts`
- Modify (stage): `apps/api/test/__snapshots__/route-table.test.ts.snap`
- Test: `apps/api/test/modules/auth/reassign-chain.test.ts`

**Interfaces:**
- Consumes: Task 1 columns; Task 3 `Addresses`/`addressOn`; `issueChallenge`, `claimChallenge`, `rejectChallenge`, `verifyEvmSignature`, `verifySolanaSignature`, `createSession`, `revokeSession`, `writeAudit` (all existing).
- Produces: `POST /v1/auth/reassign` body `{ challengeId, signature, walletProvider?, signableChains?, client }` (same as `verifyRequestSchema`) → `VerifyResponse`; service `reassignChain(input: VerifyInput): Promise<VerifyResult>`; exported pure `assertChainEmpty(i: { openOperation: boolean; heldUnits: { symbol: string }[]; onchain: { symbol: string; amount: bigint }[] }): void` throwing `CHAIN_NOT_EMPTY` / `OPERATION_IN_PROGRESS`; api-client `reassignChain(body)`.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/modules/auth/reassign-chain.test.ts
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { walletAddresses } from "@repo/db";
import { app } from "@/app";
import { assertChainEmpty } from "@/modules/auth/reassign.service";
import { webHeaders } from "../../helpers/auth";
import { resetDb, testDb } from "../../helpers/db";
import { newEvmWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);
const balances = vi.hoisted(() => ({ value: 0n }));
vi.mock("@/modules/operations/operations.service", async (orig) => ({ ...(await orig()), deploymentBalanceAt: async () => balances.value }));

async function signUp(chains: string[]) {
  const w = newEvmWallet();
  const ch = await request(app).post("/v1/auth/challenge").set(webHeaders()).send({ purpose: "sign_in", chain: chains[0], address: w.address, chains });
  const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
  return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="))!;
}
async function reassign(cookie: string, chain: string) {
  const w = newEvmWallet();
  const ch = await request(app).post("/v1/auth/challenge").set(webHeaders(cookie)).send({ purpose: "reassign_chain", chain, address: w.address });
  return request(app).post("/v1/auth/reassign").set(webHeaders(cookie)).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
}

describe("reassign a chain (only when empty)", () => {
  it("moves an empty chain, keeps history and rotates the session", async () => {
    balances.value = 0n;
    const cookie = await signUp(["base", "bnb"]);
    const res = await reassign(cookie, "base");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
    const rows = (await db.select().from(walletAddresses)).filter((r) => r.chain === "base");
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "replaced"]);
    const old = rows.find((r) => r.status === "replaced")!;
    expect(old.replacedByAddressId).toBe(rows.find((r) => r.status === "active")!.id);
  });

  it("refuses when the old address still holds a registered asset on the chain", async () => {
    balances.value = 5n;
    const cookie = await signUp(["base"]);
    const res = await reassign(cookie, "base");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_NOT_EMPTY");
  });

  it("refuses a chain that is not linked yet", async () => {
    const cookie = await signUp(["base"]);
    const res = await reassign(cookie, "arbitrum");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_NOT_LINKED");
  });
});

describe("assertChainEmpty", () => {
  it("open operation first, then ledger units, then on-chain balances", () => {
    expect(() => assertChainEmpty({ openOperation: true, heldUnits: [], onchain: [] })).toThrow(expect.objectContaining({ code: "OPERATION_IN_PROGRESS" }));
    expect(() => assertChainEmpty({ openOperation: false, heldUnits: [{ symbol: "AERO" }], onchain: [] })).toThrow(expect.objectContaining({ code: "CHAIN_NOT_EMPTY" }));
    expect(() => assertChainEmpty({ openOperation: false, heldUnits: [], onchain: [{ symbol: "AERO", amount: 1n }] })).toThrow(expect.objectContaining({ code: "CHAIN_NOT_EMPTY" }));
    expect(() => assertChainEmpty({ openOperation: false, heldUnits: [], onchain: [{ symbol: "AERO", amount: 0n }] })).not.toThrow();
  });
});
```

Add a test "plan after reassign uses the new address": reassign Base (balances mocked 0), then plan an invest with a Base asset → the Base leg `toAddress` is the new address. Add a test "reassign refused while an operation is open": create a `PLANNED` operation row for the user (reuse the operation fixture helper used in `test/modules/operations/*` tests) → 409 `OPERATION_IN_PROGRESS`.

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/api && pnpm exec vitest run test/modules/auth/reassign-chain.test.ts`
Expected: FAIL (route 404, module missing).

- [ ] **Step 3: Balance helper in operations**

`operations.service.ts` gets an exported helper next to `walletBalance` (read-only, outside transactions):
```ts
/** Balance of one deployment at an explicit address (used by reassign_chain's emptiness check). */
export async function deploymentBalanceAt(chain: AssetChain, token: string | null, owner: string): Promise<bigint> {
  return walletBalance({ [chain]: owner } as Addresses, chain, token);
}
```
(`Addresses` is per chain since Task 3.)

- [ ] **Step 4: Service**

```ts
// apps/api/src/modules/auth/reassign.service.ts
import createHttpError, { isHttpError } from "http-errors";
import { and, eq, inArray, sql } from "drizzle-orm";
import { authChallenges, db, instrumentDeployments, investmentWallets, operations, sessions, walletAddresses } from "@repo/db";
import { CHAINS, familyOf, type Chain } from "@repo/validator";
import { env } from "@/config/dotenv";
import { writeAudit } from "@/modules/audit/audit.service";
import { deploymentBalanceAt } from "@/modules/operations/operations.service";
import { heldUnitsOnChain } from "@/modules/portfolio/portfolio.service";
import { createSession, revokeSession } from "./sessions.service";
import { claimChallenge, rejectChallenge, type VerifyInput, type VerifyResult } from "./sign-in.service";
import { verifyEvmSignature, verifySolanaSignature } from "./signatures.service";

export function assertChainEmpty(i: { openOperation: boolean; heldUnits: { symbol: string }[]; onchain: { symbol: string; amount: bigint }[] }): void {
  if (i.openOperation) throw createHttpError("Finish or cancel your current operation first.", { code: "OPERATION_IN_PROGRESS" });
  const left = [...i.heldUnits.map((h) => h.symbol), ...i.onchain.filter((b) => b.amount > 0n).map((b) => b.symbol)];
  if (left.length > 0) throw createHttpError(`Sell what you hold on this chain first: ${[...new Set(left)].join(", ")}.`, { code: "CHAIN_NOT_EMPTY", assets: [...new Set(left)] });
}

/** D-120: move one chain to a new address, only when the chain is empty. The new address signs; the session rotates. */
export async function reassignChain(input: VerifyInput): Promise<VerifyResult> {
  const auth = input.auth;
  if (!auth) throw createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
  const { ch, claimId } = await claimChallenge(input.challengeId, ["reassign_chain"]);
  try {
    if (auth.sessionId !== ch.sessionId) throw createHttpError("This challenge belongs to another session", { code: "SIGNATURE_INVALID" });
    const chain = ch.chain as Chain;
    const request = { chain, address: ch.address, message: ch.message, signature: input.signature };
    const outcome = familyOf(chain) === "evm" ? await verifyEvmSignature(request) : verifySolanaSignature(request);
    if (outcome.kind === "invalid") throw createHttpError("Signature could not be verified", { code: "SIGNATURE_INVALID" });

    const [current] = await db.select().from(walletAddresses).innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
      .where(and(eq(investmentWallets.userId, auth.userId), eq(walletAddresses.chain, chain), eq(walletAddresses.status, "active")));
    if (!current) throw createHttpError(`${CHAINS[chain].label} is not linked yet. Link a wallet for it instead.`, { code: "CHAIN_NOT_LINKED" });
    if (current.wallet_addresses.address === ch.address) throw createHttpError("That wallet already holds this chain.", { code: "VALIDATION_FAILED" });

    // On-chain balances outside any transaction (RPC); the ledger and open operations are re-checked inside.
    const deployments = await db.select({ symbol: instrumentDeployments.symbol, address: instrumentDeployments.address })
      .from(instrumentDeployments).where(eq(instrumentDeployments.chain, chain));
    const onchain = await Promise.all(deployments.map(async (d) => ({ symbol: d.symbol ?? "token", amount: await deploymentBalanceAt(chain, d.address, current.wallet_addresses.address) })));

    return await db.transaction(async (tx) => {
      await tx.select({ id: investmentWallets.id }).from(investmentWallets).where(eq(investmentWallets.id, current.investment_wallets.id)).for("update");
      const [open] = await tx.select({ id: operations.id }).from(operations)
        .where(and(eq(operations.userId, auth.userId), inArray(operations.status, ["PLANNED", "IN_PROGRESS"]))).limit(1);
      assertChainEmpty({ openOperation: Boolean(open), heldUnits: await heldUnitsOnChain(tx, auth.userId, chain), onchain });

      const consumed = await tx.update(authChallenges).set({ status: "consumed", resolvedAt: sql`now()`, leaseExpiresAt: null })
        .where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing"))).returning({ id: authChallenges.id });
      if (consumed.length !== 1) throw createHttpError("This request is already being verified.", { code: "CHALLENGE_IN_PROGRESS" });

      const [created] = await tx.insert(walletAddresses).values({
        investmentWalletId: current.investment_wallets.id, chainFamily: familyOf(chain), chain, address: ch.address, verificationMethod: outcome.method,
        verifiedOnChain: chain, verificationChallengeId: ch.id, walletName: input.walletProvider ?? null,
        signableChains: input.signableChains?.filter((c) => c === chain) ?? null,
      }).returning({ id: walletAddresses.id });
      await tx.update(walletAddresses).set({ status: "replaced", replacedAt: sql`now()`, replacedByAddressId: created!.id }).where(eq(walletAddresses.id, current.wallet_addresses.id));
      await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "wallet.chain_reassigned", entityType: "investment_wallet", entityId: current.investment_wallets.id,
        requestId: input.meta.requestId, sessionId: auth.sessionId, challengeId: ch.id, metadata: { chain, from: current.wallet_addresses.address, to: ch.address } });

      if (!(await revokeSession(tx, auth.sessionId, "rotated"))) throw createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
      const issued = await createSession(tx, { userId: auth.userId, client: auth.client, pepper: env.SESSION_TOKEN_PEPPER, meta: input.meta });
      await tx.update(sessions).set({ replacedBySessionId: issued.id }).where(eq(sessions.id, auth.sessionId));
      return { userId: auth.userId, isNewUser: false, issued };
    });
  } catch (err) {
    if (isHttpError(err) && ["SIGNATURE_INVALID", "CHAIN_NOT_LINKED", "VALIDATION_FAILED"].includes(err.code)) await rejectChallenge(ch, claimId, err.code, input);
    else if (isHttpError(err)) await db.update(authChallenges).set({ status: "pending", claimId: null, leaseExpiresAt: null }).where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId)));
    throw err;
  }
}
```
Check the real column names of `instrumentDeployments` (`symbol` may live on `instruments`; join it if so) and the existing `VerifyInput`/`VerifyResult` exports.

`portfolio.service.ts` gets:
```ts
/** Instruments with position units on a chain for this user (reassign_chain's ledger check). */
export async function heldUnitsOnChain(db: DbOrTx, userId: string, chain: AssetChain): Promise<{ symbol: string }[]>
```
implemented with the same ledger query the portfolio uses for holdings, filtered to deployments on `chain` with units > 0.

- [ ] **Step 5: Route, controller, client**

`auth.route.ts`: `router.post("/reassign", requireSession, validate({ body: verifyRequestSchema }), reassignChainHandler);`
`auth.controller.ts`: `reassignChainHandler` mirrors `verifySignature` but calls `reassignChain` and `respondVerified`.
`issueChallenge` already accepts `reassign_chain` (Task 1 enum) and requires a session for it like `add_chain_account` (extend the existing `body.purpose === "add_chain_account" && !req.auth` check).
`packages/api-client/src/client.ts`: `reassignChain: (b: VerifyRequest): Promise<VerifyResponse> => request("POST", "/v1/auth/reassign", verifyResponseSchema, b),`

- [ ] **Step 6: Run tests and update the route-table snapshot**

Run: `cd apps/api && pnpm exec vitest run test/modules/auth/reassign-chain.test.ts && pnpm exec vitest run test/route-table.test.ts -u`
Expected: PASS; the snapshot gains `POST /v1/auth/reassign`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src packages/api-client/src packages/validator/src apps/api/test/modules/auth/reassign-chain.test.ts apps/api/test/__snapshots__/route-table.test.ts.snap
git commit -m "feat(api): move a chain to another wallet only when it is empty (D-120)"
```

---

### Task 5: Shared client logic (app-core)

**Files:**
- Modify: `packages/app-core/src/wallet.ts`, `packages/app-core/src/error-copy.ts`, `packages/app-core/src/wallet.test.ts`
- Modify: `packages/app-core/src/verify-flow.ts` if it lists error codes

**Interfaces:**
- Produces:
  - `linkChoices(input: { family: "evm" | "solana"; approved: AssetChain[] | undefined; addresses: WalletAddressView[]; address: string; smartWalletChain?: AssetChain }): { chain: AssetChain; state: "available" | "linked-here" | "linked-elsewhere"; walletName: string | null; preselected: boolean }[]`
  - `linkedAddressFor(addresses: WalletAddressView[], chain: AssetChain): WalletAddressView | undefined` (active row)
  - `canAddChainAccount(me)` true while any EVM or Solana chain has no active row
  - error copy for `CHAIN_ALREADY_LINKED`, `CHAIN_NOT_LINKED`, `CHAIN_NOT_EMPTY`

- [ ] **Step 1: Failing tests**

```ts
// append to packages/app-core/src/wallet.test.ts
import { linkChoices, linkedAddressFor } from "./wallet";

describe("linkChoices (D-120)", () => {
  const row = (chain: string, address: string, walletName: string | null = null, status = "active") =>
    ({ chain, chainFamily: chain === "solana" ? "solana" : "evm", address, status, verificationMethod: "eoa_ecdsa", verifiedAt: "2026-10-09T00:00:00.000Z", walletName }) as never;
  it("pre-ticks approved unlinked chains, greys chains linked elsewhere", () => {
    const out = linkChoices({ family: "evm", approved: ["ethereum", "base", "bnb"], address: "0xaaa", addresses: [row("base", "0xbbb", "Phantom")] });
    expect(out).toEqual([
      { chain: "ethereum", state: "available", walletName: null, preselected: true },
      { chain: "base", state: "linked-elsewhere", walletName: "Phantom", preselected: false },
      { chain: "bnb", state: "available", walletName: null, preselected: true },
      { chain: "arbitrum", state: "available", walletName: null, preselected: false },
      { chain: "polygon", state: "available", walletName: null, preselected: false },
    ]);
  });
  it("unknown approval list pre-ticks every available chain; a smart wallet only offers its chain", () => {
    expect(linkChoices({ family: "evm", approved: undefined, address: "0xaaa", addresses: [] }).every((c) => c.preselected)).toBe(true);
    expect(linkChoices({ family: "evm", approved: undefined, address: "0xaaa", addresses: [], smartWalletChain: "base" }).map((c) => c.chain)).toEqual(["base"]);
  });
  it("linkedAddressFor ignores replaced rows", () => {
    expect(linkedAddressFor([row("base", "0xold", null, "replaced"), row("base", "0xnew")], "base")?.address).toBe("0xnew");
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/app-core && pnpm exec vitest run src/wallet.test.ts`
Expected: FAIL (`linkChoices` not exported).

- [ ] **Step 3: Implement**

```ts
// packages/app-core/src/wallet.ts (additions)
import { ASSET_CHAINS, chainsInFamily, type AssetChain, type WalletAddressView } from "@repo/validator";

export function linkedAddressFor(addresses: readonly WalletAddressView[], chain: AssetChain): WalletAddressView | undefined {
  return addresses.find((a) => a.chain === chain && a.status === "active");
}

/** D-120 checkbox screen: every chain of the family, what is linked where, and what to pre-tick (approved by the wallet and free). */
export function linkChoices(i: { family: "evm" | "solana"; approved: readonly AssetChain[] | undefined; addresses: readonly WalletAddressView[]; address: string; smartWalletChain?: AssetChain }) {
  const chains = i.smartWalletChain ? [i.smartWalletChain] : (chainsInFamily(i.family) as AssetChain[]);
  return chains.map((chain) => {
    const row = linkedAddressFor(i.addresses, chain);
    const same = row && (i.family === "solana" ? row.address === i.address : row.address.toLowerCase() === i.address.toLowerCase());
    const state = !row ? "available" as const : same ? "linked-here" as const : "linked-elsewhere" as const;
    return { chain, state, walletName: row?.walletName ?? null, preselected: state === "available" && (i.approved === undefined || i.approved.includes(chain)) };
  });
}
```
`canAddChainAccount(me)`: `return (["ethereum", "base", "bnb", "arbitrum", "polygon", "solana"] as const).some((c) => !linkedAddressFor(me.wallet.addresses, c));`
`error-copy.ts`:
```ts
  CHAIN_ALREADY_LINKED: { title: "Chain already linked", message: "This chain is linked to another wallet. Move it first, or untick it.", recovery: "fix-input" },
  CHAIN_NOT_LINKED: { title: "Wallet needed for this chain", message: "Link a wallet for this chain in Profile, then try again.", recovery: "fix-input" },
  CHAIN_NOT_EMPTY: { title: "Chain not empty", message: "Sell what you hold on this chain first, then move it to another wallet.", recovery: "fix-input" },
```
Note: `ASSET_CHAINS` import is only needed if labels are built here; otherwise drop it.

- [ ] **Step 4: Run app-core tests**

Run: `cd packages/app-core && pnpm exec vitest run`
Expected: PASS (update the existing `canAddChainAccount` tests to the per-chain rule).

- [ ] **Step 5: Commit**

```bash
git add packages/app-core/src
git commit -m "feat(app-core): per-chain link choices, linked address lookup and error copy (D-120)"
```

---

### Task 6: Web linking UI and per-chain wallet list

**Files:**
- Create: `apps/web/components/auth/chain-picker.tsx`
- Modify: `apps/web/lib/auth/use-wallet-verification.ts`, `apps/web/components/auth/wallet-verification.tsx`, `apps/web/components/auth/verify-wallet-card.tsx`, `apps/web/components/profile/wallet-section.tsx`, `apps/web/lib/wallet/use-wallet-connector.ts`
- Test: `apps/web/test/chain-picker.test.tsx`, `apps/web/test/wallet-section.test.tsx`

**Interfaces:**
- Consumes: `linkChoices`, `linkedAddressFor` (Task 5); `api.createChallenge({ ..., chains })`, `api.reassignChain` (Task 4).
- Produces: `<ChainPicker choices onChange />`; `useWalletVerification(purpose).run(account, chains)`; wallet section "Move to another wallet" calling `run(account, [chain])` with purpose `reassign_chain` via `api.reassignChain`.

- [ ] **Step 1: Failing tests**

```tsx
// apps/web/test/chain-picker.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChainPicker } from "@/components/auth/chain-picker";

describe("ChainPicker", () => {
  it("shows pre-ticked chains, disables chains linked elsewhere and reports the selection", async () => {
    const onChange = vi.fn();
    render(<ChainPicker walletName="MetaMask" address="0xAbC0000000000000000000000000000000000001" onChange={onChange} choices={[
      { chain: "base", state: "available", walletName: null, preselected: true },
      { chain: "ethereum", state: "linked-elsewhere", walletName: "Phantom", preselected: false },
      { chain: "arbitrum", state: "available", walletName: null, preselected: false },
    ]} />);
    expect(screen.getByText(/Use MetaMask/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Base" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Ethereum/ })).toBeDisabled();
    expect(screen.getByText("linked to Phantom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Arbitrum" }));
    expect(onChange).toHaveBeenLastCalledWith(["base", "arbitrum"]);
  });
});
```
In `wallet-section.test.tsx` add: rows per chain with wallet name; "Move to another wallet" button present for a linked chain; a `CHAIN_NOT_EMPTY` reply shows "Sell what you hold on this chain first".

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && pnpm exec vitest run test/chain-picker.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: ChainPicker**

```tsx
// apps/web/components/auth/chain-picker.tsx
"use client";

import { shortAddress } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain } from "@repo/validator";
import { useEffect, useState } from "react";

export type Choice = { chain: AssetChain; state: "available" | "linked-here" | "linked-elsewhere"; walletName: string | null; preselected: boolean };

/** D-120: which chains this wallet should serve. Linked chains are shown, not selectable; one signature links the ticked ones. */
export function ChainPicker({ walletName, address, choices, onChange }: { walletName: string | null; address: string; choices: Choice[]; onChange(chains: AssetChain[]): void }) {
  const [picked, setPicked] = useState<AssetChain[]>(() => choices.filter((c) => c.preselected).map((c) => c.chain));
  useEffect(() => { onChange(picked); }, [picked, onChange]);
  return (
    <fieldset className="space-y-2 rounded-tile border border-line bg-surface-muted p-4">
      <legend className="text-sm font-medium text-ink">{`Use ${walletName ?? "this wallet"} (${shortAddress(address)}) for:`}</legend>
      {choices.map((c) => (
        <label key={c.chain} className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--c-primary)]" disabled={c.state !== "available"}
            checked={c.state === "linked-here" || picked.includes(c.chain)}
            onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.chain] : p.filter((x) => x !== c.chain)))} aria-label={ASSET_CHAINS[c.chain].label} />
          <span>{ASSET_CHAINS[c.chain].label}</span>
          {c.state === "linked-elsewhere" && <span className="text-ink-faint">{`linked to ${c.walletName ?? "another wallet"}`}</span>}
          {c.state === "linked-here" && <span className="text-ink-faint">already linked</span>}
        </label>
      ))}
    </fieldset>
  );
}
```
(The picker emits ticked chains only; the server treats `linked-here` chains as idempotent, so they need not be sent.)

- [ ] **Step 4: Wire the verification**

`use-wallet-verification.ts`: `run(account: ConnectedAccount, chains?: AssetChain[])` → `api.createChallenge({ purpose, chain: account.chain, address: account.address, chains })`; when `purpose === "reassign_chain"` call `api.reassignChain(...)` instead of `api.verify(...)`. Send `signableChains: account.signableChains` (web connector: populate from `useAppKitAccount().allAccounts` filtered by address, mapped with `signableChainsFromCaip`, same as mobile; leave undefined when empty).
`wallet-verification.tsx`/`verify-wallet-card.tsx`: when an account is connected, render `<ChainPicker>` from `linkChoices({ family, approved: account.signableChains, addresses: me?.wallet.addresses ?? [], address: account.address })`; Sign is disabled when no chain is ticked; `onSign` → `run(account, picked)`. On the sign-in screen (`me` absent) the picker shows every chain of the family.
`wallet-section.tsx`: render one row per active chain with `walletName`, and per row a "Move to another wallet" button opening the same verification UI with purpose `reassign_chain`, `chains` fixed to that row's chain (no picker), and an explanation line "Only possible when you hold nothing on {chain}."

- [ ] **Step 5: Run web tests**

Run: `cd apps/web && pnpm exec vitest run test/chain-picker.test.tsx test/wallet-section.test.tsx test/verify-wallet-card.test.tsx`
Expected: PASS (update `verify-wallet-card.test.tsx` that referenced `CHAIN_FAMILY_ALREADY_LINKED` to `CHAIN_ALREADY_LINKED`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components apps/web/lib apps/web/test
git commit -m "feat(web): pick chains when linking, per-chain wallet list and move to another wallet (D-120)"
```

---

### Task 7: Web multi-wallet signing (Reown Multiwallet)

**Files:**
- Create: `apps/web/lib/wallet/use-wallet-for-chain.ts`, `apps/web/components/layout/wallet-menu.tsx`
- Modify: `apps/web/lib/wallet/use-leg-signer.ts`, `apps/web/components/invest/leg-progress.tsx` (the "Connect X" prompt), `apps/web/components/layout/app-shell.tsx` (mount the menu)
- Test: `apps/web/test/use-wallet-for-chain.test.tsx`, `apps/web/test/use-leg-signer.test.tsx`

**Interfaces:**
- Consumes: `linkedAddressFor` (Task 5), `/me` addresses with `walletName`.
- Produces: `useWalletForChain(me)` → `{ ensure(chain: AssetChain): Promise<"ready" | "missing">, missing: { chain: AssetChain; address: string; walletName: string | null } | null }`; `useLegSigner` calls `ensure(chain)` first and throws `WrongWalletError` with `"Connect {walletName} ({short}) to sign this {Chain} step"` when missing.

- [ ] **Step 1: Failing tests**

```tsx
// apps/web/test/use-wallet-for-chain.test.tsx
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const switchConnection = vi.fn();
const switchNetwork = vi.fn();
const state = vi.hoisted(() => ({ active: "0xaaa", connections: [] as { connectorId: string; accounts: { address: string }[] }[] }));
vi.mock("@reown/appkit/react", () => ({
  useAppKitConnections: () => ({ connections: state.connections, recentConnections: [] }),
  useAppKitConnection: () => ({ connection: state.connections.find((c) => c.accounts.some((a) => a.address === state.active)), switchConnection, isPending: false, deleteConnection: vi.fn() }),
  useAppKitAccount: () => ({ address: state.active, isConnected: true }),
  useAppKitNetwork: () => ({ switchNetwork }),
}));
import { useWalletForChain } from "@/lib/wallet/use-wallet-for-chain";

const me = { wallet: { addresses: [
  { chain: "base", chainFamily: "evm", address: "0xaaa", status: "active", walletName: "MetaMask" },
  { chain: "arbitrum", chainFamily: "evm", address: "0xccc", status: "active", walletName: "Trust Wallet" },
] } } as never;

describe("useWalletForChain", () => {
  it("is ready when the active connection holds the linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }];
    const { result } = renderHook(() => useWalletForChain(me));
    expect(await result.current.ensure("base")).toBe("ready");
    expect(switchConnection).not.toHaveBeenCalled();
  });
  it("switches to the connection holding the linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }, { connectorId: "trust", accounts: [{ address: "0xccc" }] }];
    const { result } = renderHook(() => useWalletForChain(me));
    expect(await result.current.ensure("arbitrum")).toBe("ready");
    expect(switchConnection).toHaveBeenCalledWith({ connection: state.connections[1], address: "0xccc" });
  });
  it("reports missing with the wallet to connect", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }];
    const { result } = renderHook(() => useWalletForChain(me));
    expect(await result.current.ensure("arbitrum")).toBe("missing");
  });
});
```
In `use-leg-signer.test.tsx` add: `sendEvm` for a Base leg checks the Base row's address (not Ethereum's); missing wallet → `WrongWalletError` with message containing "Connect Trust Wallet".

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && pnpm exec vitest run test/use-wallet-for-chain.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the hook**

```ts
// apps/web/lib/wallet/use-wallet-for-chain.ts
"use client";

import { useAppKitAccount, useAppKitConnection, useAppKitConnections } from "@reown/appkit/react";
import { linkedAddressFor } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain, type MeResponse } from "@repo/validator";
import { useCallback } from "react";

const NAMESPACE = { evm: "eip155", solana: "solana", bitcoin: "bip122" } as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** D-121: make the wallet linked to `chain` the active connection (Reown Multiwallet); "missing" when it is not connected in this browser. */
export function useWalletForChain(me: MeResponse | undefined) {
  const { connections } = useAppKitConnections();
  const { switchConnection } = useAppKitConnection({ namespace: undefined });
  const active = useAppKitAccount();
  const ensure = useCallback(async (chain: AssetChain): Promise<"ready" | "missing"> => {
    const row = me ? linkedAddressFor(me.wallet.addresses, chain) : undefined;
    if (!row) return "missing";
    if (active.address && same(active.address, row.address)) return "ready";
    const holder = connections.find((c) => c.accounts.some((a) => same(a.address, row.address)));
    if (!holder) return "missing";
    await switchConnection({ connection: holder as never, address: row.address });
    return "ready";
  }, [me, connections, switchConnection, active.address]);
  return { ensure, namespaceOf: (chain: AssetChain) => NAMESPACE[ASSET_CHAINS[chain].family] };
}
```
(Check `useAppKitConnection`'s required props in 1.8.24: pass `{ namespace }` per family if `undefined` is not accepted, and call the hook once per family.)

- [ ] **Step 4: Use it in the signer**

`use-leg-signer.ts`: replace `linked("ethereum")` with the leg chain's row: derive `chain` from `tx.chainId` with `chainFromEvmChainId` (Polygon included after Task 1); before signing call `const r = await wallet.ensure(chain); if (r === "missing") throw new WrongWalletError(connectHint(chain));` where
```ts
const connectHint = (chain: AssetChain) => {
  const row = me ? linkedAddressFor(me.wallet.addresses, chain) : undefined;
  return `Connect ${row?.walletName ?? "the wallet"} (${row ? shortAddress(row.address) : "linked address"}) to sign this ${ASSET_CHAINS[chain].label} step`;
};
```
Same for `signSolana` (`chain = "solana"`). The address equality check stays (server checks still decide).
`leg-progress.tsx`: on `WRONG_WALLET` show the message plus a "Connect wallet" button calling `open({ view: "Connect" })`; after the connection list changes, retry the step automatically once.

- [ ] **Step 5: Wallet menu**

`wallet-menu.tsx`: a header popover listing `useAppKitConnections()` per namespace (wallet name, icon, short addresses, the linked chains each address serves from `/me`), "Reconnect" rows for linked addresses not present in `connections` (wallet name from `/me`), and "Disconnect" per connection (`useDisconnect`). Mount it in `app-shell.tsx` where the current account chip is.

- [ ] **Step 6: Run web tests**

Run: `cd apps/web && pnpm exec vitest run test/use-wallet-for-chain.test.tsx test/use-leg-signer.test.tsx test/leg-progress.test.tsx test/app-shell.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib apps/web/components apps/web/test
git commit -m "feat(web): automatic wallet selection per step and wallet menu with Reown Multiwallet (D-121)"
```

---

### Task 8: Mobile linking, wallet list and connect prompt

**Files:**
- Create: `apps/mobile/src/components/auth/chain-picker.tsx`
- Modify: `apps/mobile/src/lib/auth/use-wallet-verification.ts`, `apps/mobile/src/components/auth/wallet-verification.tsx`, `apps/mobile/src/components/auth/verify-wallet-card.tsx`, `apps/mobile/src/components/profile/wallet-section.tsx`, `apps/mobile/src/lib/wallet/use-signer.ts`, `apps/mobile/src/components/operation/leg-flow.tsx`
- Test: `apps/mobile/test/chain-picker.test.tsx`, `apps/mobile/test/wallet-section.test.tsx`, `apps/mobile/test/use-signer.test.tsx`

**Interfaces:**
- Consumes: `linkChoices`, `linkedAddressFor` (Task 5), `api.reassignChain` (Task 4).
- Produces: mobile `<ChainPicker>` (same props as web); `useSigner.sendEvm` checks the leg chain's row; `WRONG_WALLET` copy "Connect {walletName} ({short}) to sign this {Chain} step" with a "Connect wallet" button (disconnect + `open({ view: "Connect" })`).

- [ ] **Step 1: Failing tests**

```tsx
// apps/mobile/test/chain-picker.test.tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChainPicker } from "@/components/auth/chain-picker";

describe("ChainPicker (mobile)", () => {
  it("toggles available chains and keeps chains linked elsewhere locked", async () => {
    const onChange = jest.fn();
    await render(<ChainPicker walletName="MetaMask" address="0xAbC0000000000000000000000000000000000001" onChange={onChange} choices={[
      { chain: "base", state: "available", walletName: null, preselected: true },
      { chain: "ethereum", state: "linked-elsewhere", walletName: "Phantom", preselected: false },
    ]} />);
    expect(screen.getByText("linked to Phantom")).toBeOnTheScreen();
    await fireEvent(screen.getByLabelText("Base"), "valueChange", false);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByLabelText("Ethereum")).toBeDisabled();
  });
});
```
`use-signer.test.tsx`: a Base leg with Base linked to `0xaaa` and Ethereum to `0xbbb`, connected `0xaaa` → sends; connected `0xbbb` → `WrongWalletError` message contains "Connect MetaMask".
`wallet-section.test.tsx`: per-chain rows and "Move to another wallet".

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/mobile && pnpm exec jest test/chain-picker.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Mobile ChainPicker**

```tsx
// apps/mobile/src/components/auth/chain-picker.tsx
import { shortAddress } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain } from "@repo/validator";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { useTheme } from "@/lib/theme";

export type Choice = { chain: AssetChain; state: "available" | "linked-here" | "linked-elsewhere"; walletName: string | null; preselected: boolean };

/** D-120: which chains this wallet serves; one signature links the ticked ones. */
export function ChainPicker({ walletName, address, choices, onChange }: { walletName: string | null; address: string; choices: Choice[]; onChange(chains: AssetChain[]): void }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<AssetChain[]>(() => choices.filter((c) => c.preselected).map((c) => c.chain));
  useEffect(() => { onChange(picked); }, [picked, onChange]);
  return (
    <View className="gap-2 rounded-tile bg-surface-muted p-4">
      <AppText className="font-medium">{`Use ${walletName ?? "this wallet"} (${shortAddress(address)}) for:`}</AppText>
      {choices.map((c) => (
        <View key={c.chain} className="min-h-11 flex-row items-center gap-3">
          <Switch accessibilityLabel={ASSET_CHAINS[c.chain].label} disabled={c.state !== "available"}
            value={c.state === "linked-here" || picked.includes(c.chain)}
            onValueChange={(on) => setPicked((p) => (on ? [...p, c.chain] : p.filter((x) => x !== c.chain)))}
            trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor={colors.surface} />
          <AppText className="flex-1">{ASSET_CHAINS[c.chain].label}</AppText>
          {c.state === "linked-elsewhere" && <AppText variant="label" tone="faint">{`linked to ${c.walletName ?? "another wallet"}`}</AppText>}
          {c.state === "linked-here" && <AppText variant="label" tone="faint">already linked</AppText>}
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: Wire verification, wallet list and signer**

- `use-wallet-verification.ts`: `run(account, chains?)` passes `chains` to `createChallenge`; purpose `reassign_chain` uses `api.reassignChain`.
- `verify-wallet-card.tsx` / `wallet-verification.tsx`: render `<ChainPicker>` from `linkChoices(...)` above the sign button; Sign disabled with no chain ticked. This replaces the family-taken hint from `a3d3f7f` (the server now answers per chain).
- `wallet-section.tsx`: one row per active chain with wallet name; "Move to another wallet" per row (purpose `reassign_chain`, that chain only).
- `use-signer.ts`: `sendEvm` derives the chain from `tx.chainId` (`chainFromEvmChainId`) and compares with `linkedAddressFor(me.wallet.addresses, chain)`; missing or different → `new WrongWalletError(connectHint(chain))` (same text as web).
- `leg-flow.tsx`: for `WRONG_WALLET` add a "Connect wallet" button: `await disconnect(); open({ view: "Connect" })`, then the user taps the step again.

- [ ] **Step 5: Run mobile tests**

Run: `cd apps/mobile && pnpm exec jest test/chain-picker.test.tsx test/wallet-section.test.tsx test/use-signer.test.tsx test/verify-wallet-card.test.tsx`
Expected: PASS (update the `verify-wallet-card` tests from `a3d3f7f` that asserted the family-taken hint).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src apps/mobile/test
git commit -m "feat(mobile): pick chains when linking, per-chain wallets and connect prompt (D-120)"
```

---

### Task 9: Help guide and FAQ

**Files:**
- Create: `packages/app-core/src/wallet-help.ts` (shared copy), `apps/web/app/(app)/help/wallets/page.tsx`, `apps/mobile/src/components/help/wallet-help-sheet.tsx`
- Modify: link from `apps/web/components/profile/wallet-section.tsx`, `apps/web/components/auth/chain-picker.tsx`, `apps/web/components/invest/chain-coverage.tsx`, `apps/web/components/invest/leg-progress.tsx`, and the mobile equivalents
- Test: `packages/app-core/src/wallet-help.test.ts`, `apps/web/test/help-wallets.test.tsx`

**Interfaces:**
- Produces: `WALLET_HELP: readonly { id: string; question: string; answer: string[] }[]` with ids `several-wallets`, `move-chain`, `wrong-wallet`, `metamask-solana`, `import-phrase`, `lost-wallet`, `cannot-sign-chain`, `per-step-approval`.

- [ ] **Step 1: Failing test**

```ts
// packages/app-core/src/wallet-help.test.ts
import { describe, expect, it } from "vitest";
import { WALLET_HELP } from "./wallet-help";

describe("WALLET_HELP", () => {
  it("covers the eight wallet topics from the spec", () => {
    expect(WALLET_HELP.map((h) => h.id)).toEqual(["several-wallets", "move-chain", "wrong-wallet", "metamask-solana", "import-phrase", "lost-wallet", "cannot-sign-chain", "per-step-approval"]);
    expect(WALLET_HELP.find((h) => h.id === "import-phrase")!.answer.join(" ")).toContain("same address");
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/app-core && pnpm exec vitest run src/wallet-help.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the copy**

```ts
// packages/app-core/src/wallet-help.ts
/** Help guide and FAQ for wallets (spec 2026-10-09 section 5). Plain language; shared by web and mobile. */
export const WALLET_HELP = [
  { id: "several-wallets", question: "Can I use different wallets for different chains?", answer: [
    "Yes. When you link a wallet, tick the chains it should serve, for example Base and BNB Chain in MetaMask and Ethereum in Trust Wallet. One approval links all ticked chains.",
    "Each chain has one wallet at a time. Bytesac picks the right wallet for every step and asks you to connect it if it is not connected." ] },
  { id: "move-chain", question: "How do I move a chain to another wallet?", answer: [
    "Profile → Wallets → Move to another wallet. You can move a chain only when you hold nothing on it through Bytesac and no operation is open.",
    "Example: Base holds 100 AERO in MetaMask. Sell it, then move Base to Trust Wallet and approve once in Trust. New Base purchases go to Trust." ] },
  { id: "wrong-wallet", question: "What does \"Connect MetaMask to sign this step\" mean?", answer: [
    "The step uses a chain linked to a wallet that is not connected right now. Tap Connect wallet, pick that wallet, and the step continues. Nothing was sent." ] },
  { id: "metamask-solana", question: "Why can't MetaMask sign Solana steps on my phone?", answer: [
    "MetaMask's mobile app shares only EVM chains with other apps today. Use a Solana wallet such as Phantom, Solflare or Trust Wallet for Solana. Wallets like Trust, OKX and Bitget support EVM and Solana together." ] },
  { id: "import-phrase", question: "I imported my recovery phrase into another wallet. Is that enough?", answer: [
    "Check that the new wallet shows the same address as before. Wallets can derive different addresses from the same phrase, especially on Solana. Delete the old wallet only after the addresses match." ] },
  { id: "lost-wallet", question: "I lost my wallet or recovery phrase.", answer: [
    "Contact support: we can disable the address so nobody can sign in with it. We cannot move or recover your tokens: only your wallet can sign for them." ] },
  { id: "cannot-sign-chain", question: "\"Your wallet can't sign on Arbitrum\": what now?", answer: [
    "You can still invest: the tokens arrive at your address. To sell them later you need a wallet that signs on that chain, for example by linking that chain to another wallet." ] },
  { id: "per-step-approval", question: "Why do I approve every step?", answer: [
    "Bytesac never moves your funds on its own. Each step is one transaction you approve in your wallet. Signing in is a message, not a transaction, and moves no money." ] },
] as const;
```
Export from `packages/app-core/src/index.ts`.

- [ ] **Step 4: Web page and mobile sheet**

Web: `apps/web/app/(app)/help/wallets/page.tsx` renders `WALLET_HELP` as a disclosure list (`<details>` per question, anchor `#${id}`); add "How wallets work" links (`/help/wallets#move-chain` etc.) next to the move button, the chain picker, the D-119 callout and the wrong-wallet message.
Mobile: `wallet-help-sheet.tsx` renders the same list in the existing `Sheet` component; open it from the same four places.
Test `apps/web/test/help-wallets.test.tsx`: the page renders all eight questions.

- [ ] **Step 5: Run tests**

Run: `cd packages/app-core && pnpm exec vitest run src/wallet-help.test.ts && cd ../../apps/web && pnpm exec vitest run test/help-wallets.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-core/src apps/web/app apps/web/components apps/web/test apps/mobile/src
git commit -m "feat: wallet help guide and FAQ on web and mobile"
```

---

### Task 10: Docs, ADR and full gate

**Files:**
- Create: `docs/decisions/ADR-021-PER-CHAIN-ADDRESSES.md` (from `docs/decisions/ADR-TEMPLATE.md`)
- Modify: `docs/decisions/DECISION-REGISTER.md`, `docs/decisions/ADR-004-CHAIN-ACCOUNT-ASSOCIATION.md` (superseded note), `docs/domains/USER-AUTHENTICATION.md`, `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`, `docs/domains/USER-FEATURES.md`, `docs/OPEN-ITEMS.md`, `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: ADR-021**

Context (one address per family limited multi-wallet users), decision (spec sections 1-3 in ADR form: per-chain rows, tick chains, empty-only reassign, `addressOn` per chain, Reown Multiwallet on web, mobile one wallet per family until the custom layer), alternatives (keep per family; addresses + assignments tables; family default + overrides; reassign any time with former-address tracking), consequences (positions never span addresses on one chain; Polygon linkable; Bitcoin unchanged).

- [ ] **Step 2: Register and domain docs**

Register: D-032 sign-in chains add Polygon; D-033 superseded by ADR-021; D-069 "linked chains"; D-120 and D-121 → IMPLEMENTED (D-121: web; mobile custom layer still FUTURE-PLANS). ADR-004: add "Superseded in part by ADR-021 (family rule)". USER-AUTHENTICATION: replace the one-per-family bullets with per-chain linking, reassign, refusals table. INVESTMENT-REBALANCING-DRIFT-FIX: delivery and exits per chain address. USER-FEATURES: wallets page, move, help. OPEN-ITEMS: enable Multi Wallet in the Reown dashboard (Pro); device checks (web with three wallets, mobile connect prompt). HANDOFF: current state line.

- [ ] **Step 3: Full gate**

Run (background, one at a time; the API suites share one DB): `pnpm turbo run lint check-types test build --continue --concurrency=1 --force < /dev/null`, then `pnpm --filter mobile test`.
Expected: all tasks green. Re-run any API file that crashes with Windows exit `3221226505` alone (HANDOFF §5).

- [ ] **Step 4: Apply the migration to Supabase (ask first)**

The running API uses the Supabase project. Ask the user before running `node --env-file=.env ../../node_modules/.pnpm/node_modules/drizzle-kit/bin.cjs migrate` from `packages/db`; then verify the new columns read-only.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: ADR-021 per-chain addresses; register, domains, open items"
```
