# Spec 6 — Baskets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** four large tasks, tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Organization members draft versioned baskets from `ACTIVE` registry instruments; ops review frozen snapshots; managers publish approved versions; assignments with flags gate actions and keep public manager history; the public sees published baskets. Nothing invests, executes or charges.

**Architecture:** `@repo/db` `schema/baskets.ts` + migration `0008_baskets.sql` (tables, enums, disclosure template seed); `@repo/validator` `baskets.ts` (enums, state maps, JSON schemas, `validateBasketVersion`, fee caps, `basketContentHash` input shape, `diffBasketVersions`); API services `services/baskets.ts` (manager CRUD, access, assignments, manager-leaves hook), `services/basket-review.ts` (submit/withdraw/decision/publish/lifecycle/lead approval/templates), `services/public-baskets.ts`; routes `routes/baskets.ts` (manager), `routes/ops.ts` (ops), `routes/public.ts` (public); web manager wizard under `/organization/baskets`, ops under `/ops/baskets` + `/ops/disclosures`, public `/baskets`.

**Tech Stack:** Express 5, Drizzle 0.45 + Postgres, zod (via `@repo/validator`), http-errors, node:crypto (`createHash`), rate-limiter-flexible, Resend, Next.js 16, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-baskets-design.md`

## Global Constraints

- Follow existing patterns exactly: Spec 3 whole-version review (`services/organizations.ts`, `services/organization-review.ts`: `OpsCtx`, cursor pagination, self-review 403 under lock, decision + event + audit in one tx, emails after commit), Spec 4 `services/members.ts` (`requirePermission(conn, userId, orgId, permission, lock)`, `moveMembership`, `notifyMember`), Spec 5 `services/assets.ts` / `services/pricing.ts` (`getPrices`), `services/audit.ts` `writeAudit`, `middleware/{auth,validate,rate-limit}.ts`, `providers/resend.ts` (`send*Email(kind, to, data, idempotencyKey)`), public routes in `routes/public.ts` with `limits.publicProfileIp` style; tests `apps/api/test/{organizations,members,assets}/*` + `helpers/*`; web `apps/web/components/organization/*`, `components/ops/*`, `app/organizations/[id]/page.tsx`, tests `apps/web/test/*` with `org-fixtures.ts`/`asset-fixtures.tsx`.
- **No extra functions**: no one-caller helpers, no wrappers around library calls. Invoke the `ponytail` skill.
- Official docs first (Drizzle partial unique indexes + jsonb typing, Postgres `FOR UPDATE`, Next 16 App Router dynamic routes/redirects).
- Enum values exactly as spec §5. Version statuses lowercase; basket statuses uppercase. Assignment flags exactly `edit`, `submit`, `publish`, `lifecycle`, `assign`; lead always all five; co-manager default `edit`, `submit`.
- Platform allocation rules exactly: 1–20 assets; integer weights ≥ 100 bps; sum = 10000; no duplicates; `ACTIVE` instrument with ≥1 `ACTIVE` deployment; band min ≤ target ≤ max. Warning when a single weight > 5000.
- Fees exactly: percent `bps` 0–100; every fixed amount and the subscription amount ≤ 1% of `minimumInvestmentUsdc`; `DecimalString` `^\d{1,12}(\.\d{1,6})?$`; compare as integer micro-USDC with `BigInt` — never JS `number`.
- Issue codes exactly: `ORG_NOT_ELIGIBLE`, `BASKET_NAME_REQUIRED`, `DISCLOSURE_MISSING`, `ASSET_UNSUPPORTED`, `ASSET_COUNT_INVALID`, `ALLOCATION_DUPLICATE`, `ALLOCATION_WEIGHT_INVALID`, `ALLOCATION_TOTAL_INVALID`, `CONSTRAINT_VIOLATION`, `FEE_CONFIGURATION_INVALID`, `MINIMUM_INVESTMENT_INVALID`, `MANAGER_ASSIGNMENT_REQUIRED`, `REBALANCE_RATIONALE_REQUIRED`. New error codes exactly: `BASKET_VALIDATION_FAILED` (422), `VERSION_CONFLICT` (409). Reuse `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `RATE_LIMITED`.
- Only `ops_admin` approves versions, approves leads, lifts platform pauses, decides retirement, retires directly, edits disclosure templates. Ops with any membership in the org → 403 "You can't review your own organization.".
- Rate limits: basket mutations `limits.basketMutationUser` 60/60 s; public basket reads `limits.publicBasketIp` 60/60 s; ops `limits.opsUser`.
- Public responses: published content only; never `internal_note`, drafts, review data, user ids, membership ids, wallets, emails.
- Runtime DB role SELECT/INSERT/UPDATE only (no DELETE); history never deleted. Replaceable child rows (version assets, disclosure pins) are **revisioned**, never deleted (Task 1 Step 2).
- Plain-text manager/template content; no HTML rendering. No mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known flake: Windows vitest worker crash (exit 3221226505) — re-run crashed files alone; never run two suites concurrently (shared test DB). `ECONNREFUSED :54329` ⇒ `pnpm db:up`.

## Review Focus

1. **Two managers save the same draft at once** → the second save gets 409 `VERSION_CONFLICT` and nothing is overwritten; test in Task 1.
2. **Draft edited (or disclosures changed) after approval, then Publish** → publish refuses when the recomputed content hash differs from `approved_hash`; disclosure-only change re-pins and records an event but does not block; test in Task 2.
3. **Lead leaves the organization while the basket is live** → assignments end, basket `REASSIGNMENT_REQUIRED`, public page shows the notice, the old lead's next request is 403; test in Task 1 (hook) + Task 2 (public).
4. **Fixed fee equal to exactly 1% of a minimum with 6 decimals** (e.g. minimum `1234.567891`, fee `12.345678` ok, `12.345679` fail) → exact decision, no float rounding; unit test in Task 1.
5. **Crafted request by a co-manager without `publish`, or by a VIEWER, on every manager route** → 403 and nothing changes; table-driven test in Task 1 (manager routes) and Task 2 (lifecycle routes).

---

## File Structure

```
packages/validator/src/baskets.ts              NEW enums, state maps, JSON schemas, requests/responses, validateBasketVersion, diffBasketVersions, feeWithinCap
packages/validator/src/baskets.test.ts         NEW
packages/validator/src/{errors,index,organizations}.ts   new codes; export; public org baskets[]
packages/db/src/schema/baskets.ts              NEW
packages/db/src/schema/index.ts                export baskets
packages/db/migrations/0008_baskets.sql        generated + grants/RLS + disclosure template seed
apps/api/src/services/baskets.ts               NEW access, CRUD, versions, assignments, endIneligibleAssignments hook, contentHash
apps/api/src/services/basket-review.ts         NEW submit/withdraw/decide/publish/lifecycle/lead decision/templates/ops queues
apps/api/src/services/public-baskets.ts        NEW public list/detail
apps/api/src/services/{members,member-verifications}.ts   call endIneligibleAssignments
apps/api/src/services/organizations.ts         getPublicOrganization adds baskets
apps/api/src/routes/baskets.ts                 NEW manager routes (+ org-scoped create/list in organizations.ts)
apps/api/src/routes/{organizations,ops,public}.ts
apps/api/src/providers/resend.ts               + sendBasketEmail
apps/api/src/middleware/rate-limit.ts          + basketMutationUser, publicBasketIp
apps/api/src/app.ts                            mount /v1/baskets
apps/api/test/baskets/*.test.ts                NEW
packages/api-client/src/client.ts              + endpoints
packages/app-core/src/basket-status.ts         NEW labels/tones; error copy
apps/web/app/(app)/organization/baskets/[bid]/page.tsx, apps/web/components/baskets/*
apps/web/components/organization/baskets.tsx   list section
apps/web/app/baskets/page.tsx, apps/web/app/baskets/[slug]/page.tsx
apps/web/app/(ops)/ops/baskets/{page,[bid]/page}.tsx, apps/web/app/(ops)/ops/disclosures/page.tsx, apps/web/components/ops/baskets/*
apps/web/test/basket-*.test.tsx, ops-basket-*.test.tsx, public-basket*.test.tsx
docs/…                                         ADR-011 + in-place updates
```

---

### Task 1: Data, validator, manager API, assignments and manager-leaves hook

**Files:** create `packages/validator/src/baskets.ts`, `packages/validator/src/baskets.test.ts`, `packages/db/src/schema/baskets.ts`, `apps/api/src/services/baskets.ts`, `apps/api/src/routes/baskets.ts`, `apps/api/test/baskets/{helpers,drafts,access,assignments}.test.ts` (helpers as `helpers.ts`); modify `packages/validator/src/{errors,index}.ts`, `packages/db/src/schema/index.ts`, `apps/api/src/services/{members,member-verifications}.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/app.ts`, `packages/api-client/src/client.ts`, `packages/app-core/src/error-copy.ts` (copy for the two new codes); migration `0008_baskets.sql`.

**Interfaces — Produces:**
- `@repo/validator`: `BASKET_STATUSES`/`basketStatusSchema`, `BASKET_VERSION_STATUSES`, `basketCategorySchema`, `ASSIGNMENT_FLAGS = ["edit","submit","publish","lifecycle","assign"] as const`, `AssignmentFlag`, `LEAD_FLAGS`, `CO_MANAGER_DEFAULT_FLAGS = ["edit","submit"]`, `BASKET_TRANSITIONS`, `BASKET_VERSION_TRANSITIONS`, `decimalStringSchema`, `feeSchema`, `basketFeesSchema`, `basketConstraintsSchema`, `basketRebalanceSchema`, `basketAssetInputSchema`, `createBasketRequestSchema` (`{ name, category }`), `saveBasketDraftRequestSchema` (all content fields optional + `assets?` + `expectedUpdatedAt`), `createAssignmentRequestSchema`, `updateAssignmentRequestSchema`, `endAssignmentRequestSchema`, `BASKET_ISSUE_CODES`, `validateBasketVersion`, `diffBasketVersions`, `feeWithinCap`, response schemas `basketSummarySchema`, `basketDetailSchema`, `basketValidationSchema`, `basketDiffSchema`.
- `services/baskets.ts`: `requireBasketAction(conn, userId, basketId, action: AssignmentFlag | "read", lock = false): Promise<{ basket, org, membership }>`, `createBasket(ctx, orgId, body)`, `listOrgBaskets(ctx, orgId, q)`, `getBasketForMember(ctx, bid)`, `saveDraft(ctx, bid, body)`, `validateOpenVersion(ctx, bid)`, `previewOpenVersion(ctx, bid)`, `createNextVersion(ctx, bid)`, `listVersions(ctx, bid)`, `getVersionDiff(ctx, bid, vid)`, `addAssignment`, `updateAssignment`, `endAssignment`, `loadValidationInput(conn, versionId)` (Task 2 uses it), `contentHash(conn, versionId): Promise<string>` (Task 2 uses it), `endIneligibleAssignments(tx, membershipId, requestId, actorUserId | null)`.

- [ ] **Step 1: Validator.** State maps (exact):

```ts
export const BASKET_TRANSITIONS: Readonly<Record<BasketStatus, readonly BasketStatus[]>> = {
  DRAFT: ["ACTIVE", "REJECTED"],
  ACTIVE: ["PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING", "RETIRED"],
  PAUSED: ["ACTIVE", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING", "RETIRED"],
  REASSIGNMENT_REQUIRED: ["ACTIVE", "PAUSED", "RETIRED"],
  RETIREMENT_PENDING: ["ACTIVE", "PAUSED", "RETIRED"],
  RETIRED: [],
  REJECTED: [],
};
export const BASKET_VERSION_TRANSITIONS: Readonly<Record<BasketVersionStatus, readonly BasketVersionStatus[]>> = {
  draft: ["in_review"],
  in_review: ["draft", "changes_required", "approved", "rejected"],
  changes_required: ["in_review"],
  approved: ["published"],
  published: ["superseded"],
  superseded: [],
  rejected: [],
};
```

  Fee cap and validation core (subtle — exact):

```ts
const micro = (d: string): bigint => { const [i, f = ""] = d.split("."); return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0")); };
/** Fixed fee rule: amount ≤ 1% of the minimum investment, compared exactly in micro-USDC. */
export const feeWithinCap = (amountUsdc: string, minimumUsdc: string): boolean => micro(amountUsdc) * 100n <= micro(minimumUsdc);

export function validateBasketVersion(i: BasketValidationInput): { issues: BasketIssue[]; warnings: BasketIssue[] } {
  const issues: BasketIssue[] = [];
  const warnings: BasketIssue[] = [];
  const add = (list: BasketIssue[], code: BasketIssueCode, section: BasketSection, message: string, field?: string) => list.push({ code, section, field, message });
  const v = i.version;
  if (!i.orgVerified) add(issues, "ORG_NOT_ELIGIBLE", "basics", "Your organization must be verified.");
  if (!v.name?.trim() || !v.shortDescription?.trim()) add(issues, "BASKET_NAME_REQUIRED", "basics", "Add a name and a short description.");
  if (!v.strategyRisks?.trim()) add(issues, "DISCLOSURE_MISSING", "risks", "Describe the strategy's risks.", "strategyRisks");
  if (i.assets.length < 1 || i.assets.length > 20) add(issues, "ASSET_COUNT_INVALID", "assets", "Choose between 1 and 20 assets.");
  const seen = new Set<string>();
  let total = 0, stable = 0, rwa = 0;
  for (const a of i.assets) {
    if (seen.has(a.instrumentId)) add(issues, "ALLOCATION_DUPLICATE", "assets", "Each asset can appear only once.", a.instrumentId);
    seen.add(a.instrumentId);
    if (a.instrument.status !== "ACTIVE" || !a.instrument.hasActiveDeployment) add(issues, "ASSET_UNSUPPORTED", "assets", "This asset is not available for baskets.", a.instrumentId);
    if (a.instrument.status === "PAUSED" || a.instrument.status === "DEPRECATED") add(warnings, "ASSET_UNSUPPORTED", "assets", "This asset is paused or deprecated in the registry.", a.instrumentId);
    const w = a.targetWeightBps;
    const bandOk = (a.minWeightBps ?? 0) <= w && w <= (a.maxWeightBps ?? 10_000);
    if (!Number.isInteger(w) || w < 100 || !bandOk) add(issues, "ALLOCATION_WEIGHT_INVALID", "assets", "Each weight must be a whole number of at least 1% and inside its band.", a.instrumentId);
    if (w > 5000) add(warnings, "CONSTRAINT_VIOLATION", "assets", "One asset is more than half of the basket.", a.instrumentId);
    if (v.constraints.maxWeightPerAssetBps !== undefined && w > v.constraints.maxWeightPerAssetBps) add(issues, "CONSTRAINT_VIOLATION", "constraints", "An asset is above the maximum weight per asset.", a.instrumentId);
    total += w;
    if (a.instrument.assetType === "STABLECOIN") stable += w;
    if (a.instrument.assetType.startsWith("TOKENIZED_")) rwa += w;
  }
  if (total !== 10_000) add(issues, "ALLOCATION_TOTAL_INVALID", "assets", `Weights add up to ${total / 100}%; they must add up to 100%.`);
  if (v.constraints.maxStablecoinBps !== undefined && stable > v.constraints.maxStablecoinBps) add(issues, "CONSTRAINT_VIOLATION", "constraints", "Stablecoins are above the stablecoin cap.");
  if (v.constraints.maxRwaBps !== undefined && rwa > v.constraints.maxRwaBps) add(issues, "CONSTRAINT_VIOLATION", "constraints", "Tokenized assets are above the RWA cap.");
  const min = v.minimumInvestmentUsdc;
  if (!min || micro(min) <= 0n) add(issues, "MINIMUM_INVESTMENT_INVALID", "fees", "Set a minimum investment above zero.", "minimumInvestmentUsdc");
  else {
    if (v.minimumIncrementUsdc && (micro(v.minimumIncrementUsdc) <= 0n || micro(v.minimumIncrementUsdc) > micro(min))) add(issues, "MINIMUM_INVESTMENT_INVALID", "fees", "The increment must be above zero and not above the minimum.", "minimumIncrementUsdc");
    const fixed = [v.fees.entry, v.fees.management, v.fees.rebalance].flatMap((f) => (f.type === "fixed" ? [f.amountUsdc] : []));
    if (v.fees.subscription) fixed.push(v.fees.subscription.amountUsdc);
    if (fixed.some((amount) => !feeWithinCap(amount, min))) add(issues, "FEE_CONFIGURATION_INVALID", "fees", "A fixed fee can't be more than 1% of the minimum investment.");
  }
  if ([v.fees.entry, v.fees.management, v.fees.rebalance].some((f) => f.type === "percent" && (f.bps < 0 || f.bps > 100))) add(issues, "FEE_CONFIGURATION_INVALID", "fees", "A percentage fee can't be more than 1%.");
  if (!i.hasActiveLead) add(issues, "MANAGER_ASSIGNMENT_REQUIRED", "managers", "Assign a lead manager.");
  if (i.versionNumber >= 2 && !v.rationale?.trim()) add(issues, "REBALANCE_RATIONALE_REQUIRED", "review", "Explain why this version changes the basket.", "rationale");
  if (!v.thesis?.trim() || !v.methodology?.trim()) add(warnings, "BASKET_NAME_REQUIRED", "thesis", "Investors understand a basket better with a thesis and methodology.");
  return { issues, warnings };
}
```

  Adjust field names to the schemas you define; keep the logic. `diffBasketVersions(prev, next)` returns `{ added: {instrumentId, weightBps}[], removed: {instrumentId, weightBps}[], changed: {instrumentId, fromBps, toBps}[], bandChanged: instrumentId[], constraints: boolean, rebalance: boolean, fees: boolean, minimums: boolean }` (plain comparisons; `prev` null ⇒ everything `added`). Tests: every blocking code (one input each); warnings; Review Focus 4 cap cases (`1234.567891` minimum: `12.345678` ok, `12.345679` fail; percent 100 ok, 101 rejected by schema); state maps (terminal states empty; `approved` only → `published`); diff added/removed/changed.
- [ ] **Step 2: Schema + migration.** Tables per spec §5 in `schema/baskets.ts`. Because the runtime role has no DELETE, `basket_version_assets` gets an extra `revision` int column and `basket_versions` gets `assets_revision` int (default 0): saving assets inserts the new rows with `revision = assets_revision + 1` and bumps `assets_revision` in the same tx; every read filters `revision = assets_revision`. Unique `(version_id, revision, instrument_id)`. Same pattern for pins: `basket_version_disclosures` gets `revision` and `basket_versions.disclosures_revision` (PK `(version_id, revision, template_id)`). Migration: `pnpm --filter @repo/db db:generate --name=baskets`; append grants (SELECT/INSERT/UPDATE) + RLS `api_all` (copy the block from `0007_assets.sql`) and the 7 disclosure template seed rows (spec §5; body text begins "Placeholder — final wording pending compliance review."). Regenerate → "No schema changes". Migrate dev DB.
- [ ] **Step 3: Access (subtle — exact core):**

```ts
/** Loads the basket and checks the acting user may perform `action` (spec §7). OWNER/ADMIN act on every basket; others need an ACTIVE assignment with the flag, on an ACTIVE membership that still holds baskets.manage. "read" = any ACTIVE member with org.read. */
export async function requireBasketAction(conn: DbOrTx, userId: string, basketId: string, action: AssignmentFlag | "read", lock = false) {
  const q = conn.select().from(baskets).where(eq(baskets.id, basketId));
  const [basket] = lock ? await q.for("update") : await q;
  if (!basket) throw createHttpError(404, "Basket not found", { code: "NOT_FOUND" });
  const { org, membership } = await requirePermission(conn, userId, basket.organizationId, "org.read");
  if (action === "read" || membership.role === "OWNER" || membership.role === "ADMIN") return { basket, org, membership };
  if (!ROLE_PERMISSIONS[membership.role].includes("baskets.manage")) throw createHttpError(403, "You don't have access to this basket.", { code: "FORBIDDEN" });
  const [assignment] = await conn.select({ permissions: basketAssignments.permissions }).from(basketAssignments)
    .where(and(eq(basketAssignments.basketId, basketId), eq(basketAssignments.membershipId, membership.id), eq(basketAssignments.status, "ACTIVE")));
  if (!assignment?.permissions.includes(action)) throw createHttpError(403, "You don't have access to this basket.", { code: "FORBIDDEN" });
  return { basket, org, membership };
}
```

- [ ] **Step 4: Manager services.** `createBasket`: `requirePermission(…, "baskets.manage", lock=true)`; org `VERIFIED` else 409 `INVALID_TRANSITION` "Your organization must be verified to create baskets."; slug = name lowercased, non-alphanumerics → `-`, trimmed, ≤80, plus `-` + 6 random base36 chars (`crypto.randomBytes`), retry on unique violation once; insert basket `DRAFT`, version 1 `draft` with defaults (`constraints {}`, `rebalance { reviewFrequency: "none" }`, fees all `{ type: "percent", bps: 0 }`, `subscription: null`), lead assignment `ACTIVE` with `LEAD_FLAGS`, `started_at now()`; events + audit. `saveDraft`: `requireBasketAction(…, "edit", lock=true)`; open version must be `draft|changes_required` (else 409); `expectedUpdatedAt !== version.updatedAt.toISOString()` → 409 `VERSION_CONFLICT` "This draft changed since you opened it."; update fields; assets per Step 2; return detail + validation. `validateOpenVersion`/`previewOpenVersion` (`read`). `createNextVersion` (`edit`): basket has a published version and no open version (409 otherwise); clone the published version's fields + current assets into `version_number + 1` `draft` (rationale empty). `listVersions`, `getVersionDiff` (`read`; diff vs the previous published version). `loadValidationInput(conn, versionId)` joins current-revision assets with `instruments` status/type and an `EXISTS` of an `ACTIVE` deployment, `hasActiveLead`, `orgVerified`. `contentHash(conn, versionId)`: `createHash("sha256").update(JSON.stringify(canonical)).digest("hex")` where `canonical` = version content fields in a fixed key order (write the object literal with sorted keys), assets sorted by `instrumentId` with `[instrumentId, targetWeightBps, minWeightBps, maxWeightBps, rationale]`, and the pinned template ids sorted.
- [ ] **Step 5: Assignments.** `addAssignment` (`assign`; lock basket): target membership same org, `ACTIVE`, role holds `baskets.manage` (else 409 "This member can't manage baskets."); role `lead` ⇒ flags `LEAD_FLAGS`; if the basket has a published version (`current_version_id` not null) ⇒ status `PENDING_APPROVAL` (existing lead stays), else `ACTIVE` and any existing lead ends (`end_reason: "replaced"`); co-manager flags default `CO_MANAGER_DEFAULT_FLAGS`, `ACTIVE`; unique violations → 409 `INVALID_TRANSITION` "This member is already assigned." `updateAssignment` (co-managers only; lead flags immutable → 409). `endAssignment` (`assign` or self-ending own assignment): `ENDED` + reason; ending the last `ACTIVE` lead of a published `ACTIVE|PAUSED` basket ⇒ `REASSIGNMENT_REQUIRED` (as the hook below).
- [ ] **Step 6: Manager-leaves hook (subtle — exact):**

```ts
/** Ends basket assignments of a membership that can no longer manage baskets (not ACTIVE, or role without baskets.manage). Idempotent; call after any membership status/role write, inside that transaction. */
export async function endIneligibleAssignments(tx: Tx, membershipId: string, requestId: string, actorUserId: string | null): Promise<string[]> {
  const [m] = await tx.select({ status: organizationMemberships.status, role: organizationMemberships.role }).from(organizationMemberships).where(eq(organizationMemberships.id, membershipId));
  if (m && m.status === "ACTIVE" && ROLE_PERMISSIONS[m.role].includes("baskets.manage")) return [];
  const ended = await tx.update(basketAssignments).set({ status: "ENDED", endedAt: sql`now()`, endReason: "membership_changed", updatedAt: sql`now()` })
    .where(and(eq(basketAssignments.membershipId, membershipId), inArray(basketAssignments.status, ["ACTIVE", "PENDING_APPROVAL"]))).returning();
  const reassign: string[] = [];
  for (const a of ended) {
    await tx.insert(basketEvents).values({ basketId: a.basketId, assignmentId: a.id, kind: "assignment_ended", actorType: "system", actorUserId, reason: "membership_changed", requestId });
    const [b] = await tx.select().from(baskets).where(eq(baskets.id, a.basketId)).for("update");
    const [lead] = await tx.select({ id: basketAssignments.id }).from(basketAssignments).where(and(eq(basketAssignments.basketId, a.basketId), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "ACTIVE")));
    if (b && !lead && (b.status === "ACTIVE" || b.status === "PAUSED")) {
      await tx.update(baskets).set({ status: "REASSIGNMENT_REQUIRED", previousStatus: b.status, updatedAt: sql`now()` }).where(eq(baskets.id, b.id));
      await tx.insert(basketEvents).values({ basketId: b.id, kind: "reassignment_required", fromStatus: b.status, toStatus: "REASSIGNMENT_REQUIRED", actorType: "system", actorUserId, requestId });
      reassign.push(b.id);
    }
    await writeAudit(tx, { actorType: actorUserId ? "user" : "system", actorUserId, action: "basket.assignment_ended", entityType: "basket_assignment", entityId: a.id, requestId, metadata: { basketId: a.basketId } });
  }
  return reassign; // caller sends "reassignment_required" emails after commit (Task 2 wires sendBasketEmail)
}
```

  Call it at the end of `moveMembership` (members.ts) and after the role writes in `changeRole` (members.ts), `decideMemberVerification` role switch and `transferOwnership` (member-verifications.ts) — same tx, same request id. Match column/field names to the schema; keep logic.
- [ ] **Step 7: Routes + client.** `routes/organizations.ts`: `POST/GET /v1/organizations/:id/baskets`. `routes/baskets.ts` (`requireSession`, `limits.basketMutationUser` on non-GET): `GET /:bid`, `PATCH /:bid/draft`, `POST /:bid/validate`, `GET /:bid/preview`, `POST /:bid/versions`, `GET /:bid/versions`, `GET /:bid/versions/:vid/diff`, assignment routes. Mount `/v1/baskets` in `app.ts`. API client methods.
- [ ] **Step 8: Tests.** `drafts.test.ts`: create requires `baskets.manage` + VERIFIED org (409 otherwise); creator is lead with all flags; save returns validation (warnings, never blocks); asset replacement keeps old revision rows (no DELETE) and reads only the current revision; `VERSION_CONFLICT` on stale `expectedUpdatedAt` with nothing overwritten (Review Focus 1); edit of a frozen version (seed `in_review`) → 409; next version refused without a published version; clone copies content + assets; diff output. `access.test.ts`: table-driven — OWNER, ADMIN, lead, co-manager (default flags), co-manager without `edit`, MANAGER member without assignment, ANALYST, VIEWER, outsider × `GET`, `PATCH draft`, `validate`, `versions POST`, `assignments POST` → expected status (Review Focus 5). `assignments.test.ts`: assignee must be ACTIVE with baskets.manage (ANALYST → 409); lead replacement on unpublished basket ends old lead; on published basket → `PENDING_APPROVAL` and old lead stays; lead flags immutable; hook: remove lead's membership (Spec 4 route) → assignments `ENDED`, published basket (seed `current_version_id` + `ACTIVE`) → `REASSIGNMENT_REQUIRED` with `previous_status`; role downgrade to ANALYST ends assignments; old lead's next PATCH → 403 (Review Focus 3); grants: no DELETE on new tables.
- [ ] **Step 9: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`; commit `feat(api): add baskets data, validation, drafts and assignments`.

---

### Task 2: Review, publication, lifecycle, lead approval, disclosures, public API, emails

**Files:** create `apps/api/src/services/basket-review.ts`, `apps/api/src/services/public-baskets.ts`, `apps/api/test/baskets/{review,publish,lifecycle,disclosures,public}.test.ts`; modify `apps/api/src/services/{baskets,organizations}.ts`, `apps/api/src/routes/{baskets,ops,public}.ts`, `apps/api/src/providers/resend.ts`, `apps/api/src/middleware/rate-limit.ts`, `packages/validator/src/{baskets,organizations}.ts`, `packages/api-client/src/client.ts`.

**Interfaces — Consumes:** Task 1 `requireBasketAction`, `loadValidationInput`, `contentHash`, `endIneligibleAssignments` return value, `validateBasketVersion`, `diffBasketVersions`, state maps; Spec 5 `getPrices`. **Produces:** `submitVersion(ctx, bid)`, `withdrawVersion(ctx, bid)`, `publishVersion(ctx, bid)`, `pauseBasket(ctx, bid, reason)`, `resumeBasket(ctx, bid)`, `requestRetirement(ctx, bid, reason)`, `listBasketsForOps(q)`, `getBasketForOps(ctx, bid)`, `decideVersion(ctx, bid, vid, body)`, `decideLead(ctx, bid, aid, body)`, `platformPause`, `platformResume`, `platformRetire`, `decideRetirement`, `listDisclosureTemplates`, `createDisclosureTemplate`, `retireDisclosureTemplate`, `listPublicBaskets(q)`, `getPublicBasket(slug)`, `sendBasketEmail(kind, to, data, idempotencyKey)`.

- [ ] **Step 1: Submit / withdraw.** `submitVersion` (`submit`, lock): basket status ∈ `DRAFT|ACTIVE` (paused/reassignment/retirement → 409 "This basket can't take new versions right now."); open version `draft|changes_required`; `validateBasketVersion(await loadValidationInput(tx, vid))` issues → 422 `BASKET_VALIDATION_FAILED` `details.issues`; pin disclosures: active templates where `condition = always`, or `has_stablecoin` when any asset is `STABLECOIN`, or `has_rwa` when any is `TOKENIZED_*` — written as a new pin revision (bump `disclosures_revision`); reads and hashing use only the current pin revision; `content_hash = contentHash(tx, vid)`; status `in_review`, `submitted_by/at`; event + audit; email `submitted` after commit. `withdrawVersion` (`submit`): `in_review` with no `basket_reviews` row of decision other than `escalated` → `draft`.
- [ ] **Step 2: Decision.** `decideVersion` (ops): lock basket; version `in_review`; self-review 403 if the ops user has any `organization_memberships` row in the org; `approved` requires `ops_admin` (403 otherwise) and a fresh `contentHash` equal to `content_hash` (else 409 "The submission changed; ask the manager to resubmit."); `changes_required`/`rejected` require `messageToManager`, `escalated` requires `internalNote` (validator refine); insert `basket_reviews` (`reviewed_hash = content_hash`); version → `changes_required` | `approved` (`approved_hash`, `approved_by/at`) | `rejected` (and basket `DRAFT → REJECTED` when `version_number = 1` and no published version); `escalated` leaves status; event + audit; emails after commit.
- [ ] **Step 3: Publish (subtle — exact core):**

```ts
export async function publishVersion(ctx: OwnerCtx, basketId: string): Promise<BasketDetail> {
  const email = await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, basketId, "publish", true);
    const [v] = await tx.select().from(basketVersions).where(and(eq(basketVersions.basketId, basketId), inArray(basketVersions.status, ["approved", "published"]))).orderBy(desc(basketVersions.versionNumber)).limit(1);
    if (v?.status === "published" && basket.currentVersionId === v.id) return null; // idempotent
    if (!v || v.status !== "approved") throw createHttpError(409, "There is no approved version to publish.", { code: "INVALID_TRANSITION" });
    if (basket.status !== "DRAFT" && basket.status !== "ACTIVE") throw createHttpError(409, "This basket can't publish right now.", { code: "INVALID_TRANSITION" });
    const repinned = await repinDisclosures(tx, v.id); // inline in the implementation (one caller): re-select templates as at submit; if the set differs from the current pin revision, write a new pin revision and return true
    const hash = await contentHash(tx, v.id);
    if (!repinned && hash !== v.approvedHash) throw createHttpError(409, "This version changed after approval.", { code: "INVALID_TRANSITION" });
    if (basket.currentVersionId) await tx.update(basketVersions).set({ status: "superseded", updatedAt: sql`now()` }).where(eq(basketVersions.id, basket.currentVersionId));
    await tx.update(basketVersions).set({ status: "published", contentHash: hash, publishedByUserId: ctx.userId, publishedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(basketVersions.id, v.id));
    await tx.update(baskets).set({ currentVersionId: v.id, status: basket.status === "DRAFT" ? "ACTIVE" : basket.status, slug: /* new slug when name changed; old slug inserted into basket_slug_aliases */ basket.slug, updatedAt: sql`now()` }).where(eq(baskets.id, basketId));
    // events: published (+ disclosures_repinned when repinned); writeAudit basket.version_published { versionId, hash }
    return { basketId, versionNumber: v.versionNumber };
  });
  // after commit: sendBasketEmail("published", …) when email !== null
  return getBasketForMember(ctx, basketId);
}
```

  `repinDisclosures` is written inline (it has one caller — do not create the function; the call above is illustrative). When re-pinned, the hash changes only by the template ids, so compare the hash computed **before** re-pinning against `approved_hash` and block only on a content mismatch (Review Focus 2). Slug change: if the version name differs from the previous published name, compute a new slug (Task 1 rule), insert the old slug into `basket_slug_aliases`.
- [ ] **Step 4: Lifecycle + lead approval.** Manager: `pauseBasket` (`lifecycle`; `ACTIVE → PAUSED`, `pause_kind manager`, reason), `resumeBasket` (`PAUSED → ACTIVE`, 403 when `pause_kind = platform`), `requestRetirement` (`ACTIVE|PAUSED → RETIREMENT_PENDING`, `previous_status`). Ops: `platformPause` (reviewer; `ACTIVE|PAUSED → PAUSED` with `pause_kind platform`), `platformResume` (admin; `PAUSED → ACTIVE`), `platformRetire` (admin; per `BASKET_TRANSITIONS` → `RETIRED`), `decideRetirement` (admin; `RETIREMENT_PENDING → RETIRED | previous_status`), `decideLead` (admin; `PENDING_APPROVAL` lead → `ACTIVE` (`started_at`, `decided_by`), previous `ACTIVE` lead → `ENDED` `replaced`; basket `REASSIGNMENT_REQUIRED → previous_status`; rejected → `REJECTED`). Self-review 403 on all ops decisions. Every transition validated against `BASKET_TRANSITIONS`, locked, event + audit, emails after commit. Wire Task 1 hook callers to send `reassignment_required` emails after their commits.
- [ ] **Step 5: Disclosure templates (admin).** List grouped by key; create = next `version` for `key` (new key starts at 1), previous active → `retired`; retire. Audit each.
- [ ] **Step 6: Public API.** `routes/public.ts` with `limits.publicBasketIp`: `GET /v1/public/baskets` (listed statuses per spec §8, order `published_at desc, id`, cursor), `GET /v1/public/baskets/:slug` (alias → `{ redirectTo }`; `RETIRED` served; draft-only/`REJECTED`/unknown → 404) built from an explicit select list: published version content, current-revision allocation joined with instrument name/symbol/type, `ACTIVE` deployment chains, prices via `getPrices`, pinned disclosures (title/body), version history (published/superseded versions: number, `published_at`, rationale, diff vs previous), manager history (assignments `ACTIVE`/`ENDED` with `started_at`: membership `public_display_name` or "Team member", role, from/to), org public name + id, status, `hasAssetWarning` (any allocation instrument `PAUSED|DEPRECATED`). `getPublicOrganization` adds `baskets: { slug, name, status }[]`.
- [ ] **Step 7: Emails + client.** `sendBasketEmail` kinds: `submitted`, `changes_required`, `approved`, `rejected`, `published`, `platform_paused`, `platform_resumed`, `retirement_decided`, `retired`, `reassignment_required`, `lead_approved`, `lead_rejected`; recipients: active leads' + org OWNER's verified email contacts; idempotency key `basket:<eventId>`; failures logged. API client methods for all Task 2 routes (manager, ops, public).
- [ ] **Step 8: Tests.** `review.test.ts`: submit invalid → 422 exact issue codes; valid → `in_review`, hash stored, disclosures pinned by asset types (stablecoin → `stablecoin_depeg`; tokenized → `rwa_issuer_transfer_redemption`); withdraw before decision; reviewer approve → 403; admin approve; approve after hash drift (update a column directly) → 409; changes_required without message → 400; escalate needs internal note; ops member of org → 403; v1 reject → basket `REJECTED`; internal notes absent from manager `GET`. `publish.test.ts`: publish → basket `ACTIVE`, version `published`; repeat publish → 200 no change; publish after content edit post-approval → 409; template retired/replaced between submit and publish → re-pinned + event, publish OK (Review Focus 2); version 2 publish supersedes v1; rename → new slug + alias. `lifecycle.test.ts`: table-driven flags for submit/withdraw/publish/pause/resume/retirement-request (Review Focus 5); manager pause/resume; platform pause → manager resume 403 → admin resume; submit while paused → 409; retirement request → decline restores previous status, approve → `RETIRED`; lead replacement on published basket → admin approve → previous lead ended, `REASSIGNMENT_REQUIRED` restored to previous status; reviewer on admin routes → 403. `disclosures.test.ts`: create next version retires previous; reviewer → 403. `public.test.ts`: list excludes `DRAFT`/`REJECTED`/`RETIRED`; `RETIRED` detail served; `REASSIGNMENT_REQUIRED` detail carries the notice status (Review Focus 3); alias redirect; response contains no `internalNote`, review data, user/membership ids, emails (recursive key allow-list assertion); prices present; org public profile lists baskets; rate limit 429.
- [ ] **Step 9: Gate + commit.** Filtered gate as Task 1, then repo-wide `pnpm turbo run lint check-types test`; commit `feat(api): add basket review, publication, lifecycle and public API`.

---

### Task 3: Web manager workspace, wizard and public pages

**Files:** create `apps/web/components/organization/baskets.tsx`, `apps/web/app/(app)/organization/baskets/[bid]/page.tsx`, `apps/web/components/baskets/{basket-wizard,allocation-editor,fees-editor,assignments-panel,review-feedback,version-history,basket-view}.tsx`, `apps/web/app/baskets/page.tsx`, `apps/web/app/baskets/[slug]/page.tsx`, `packages/app-core/src/basket-status.ts`; modify `apps/web/app/(app)/organization/page.tsx` (Baskets section), `apps/web/app/organizations/[id]/page.tsx` (baskets list), `packages/app-core/src/index.ts`.

- [ ] **Step 1: app-core.** `BASKET_STATUS_LABEL`, `BASKET_VERSION_STATUS_LABEL`, `BASKET_CATEGORY_LABEL`, `ASSIGNMENT_FLAG_LABEL`, `BASKET_ISSUE_LABEL` (label + tone shape as existing maps). Import `validateBasketVersion` from `@repo/validator` for live feedback (no duplicate rules).
- [ ] **Step 2: Baskets section.** In `/organization` (visible with `org.read`): status tabs Drafts / In review / Changes required / Active / Paused / Retired; rows name, status (text + icon), current version, updated, open; "Create basket" (name + category dialog) when `myPermissions` has `baskets.manage` and org `VERIFIED`, else explanation.
- [ ] **Step 3: Wizard.** `/organization/baskets/[bid]`: section nav with completion markers (from validation `section`s): Basics, Thesis, Assets & allocation (registry search via `GET /v1/assets`; per row weight % input showing bps, optional band, rationale, remove; summary total / remaining / count / largest; no auto-normalize), Constraints, Rebalance (frequency, drift, fixed consent notice), Managers (`assignments-panel`: list with role, flags, status incl. "Awaiting platform approval"; add member select from members list; edit co-manager flags; end), Fees & minimum (`fees-editor`: per fee percent/fixed toggle, cap hint "Up to 1%" / "Up to <1% of minimum> USDC", subscription toggle), Risks & disclosures (manager text; pinned or would-be-pinned platform notices read-only), Review & preview (validation panel grouped by section; preview via `GET …/preview` rendered with `basket-view` and labelled "Preview — not public"). Explicit Save sending `expectedUpdatedAt`; on 409 `VERSION_CONFLICT` show "This draft changed since you opened it. Reload to continue."; reviewer section comments (`review-feedback`) beside sections; action bar per state and flags: Submit, Withdraw, Publish (confirm), New version (then rationale field + diff via `version-history`), Pause (reason), Resume, Request retirement (reason, confirm). Read-only rendering for `read`-only users and frozen versions. 403 → access-lost state.
- [ ] **Step 4: Public pages.** `/baskets` server component: cards (name, org name, category, asset count, minimum, status badge, published date) + "Load more" cursor. `/baskets/[slug]`: `redirectTo` → Next `redirect()`/`permanentRedirect()`; `basket-view` sections: overview/thesis, allocation table with price (stale badge / "Price unavailable"), constraints, rebalance disclosures + consent notice, fees and minimums, disclosures, version history with diffs and rationale, manager history (current / former), org link; status notice banners; disabled "Investing opens soon" button; `hasAssetWarning` notice. Org public profile lists baskets. Plain-text rendering only.
- [ ] **Step 5: Gate + commit.** `pnpm --filter web lint check-types build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add basket workspace, wizard and public basket pages`.

---

### Task 4: Web ops, web tests, docs

**Files:** create `apps/web/app/(ops)/ops/baskets/page.tsx`, `apps/web/app/(ops)/ops/baskets/[bid]/page.tsx`, `apps/web/app/(ops)/ops/disclosures/page.tsx`, `apps/web/components/ops/baskets/{baskets-queue,basket-review,disclosure-templates}.tsx`, tests `apps/web/test/{basket-wizard,basket-allocation,basket-fees,basket-access,public-basket,ops-basket-review,ops-basket-lifecycle,ops-disclosures}.test.tsx`, `docs/decisions/ADR-011-BASKETS.md`; modify `apps/web/app/(ops)/ops/layout.tsx` (nav Baskets, Disclosures), docs listed below.

- [ ] **Step 1: Ops queue + review.** `/ops/baskets` tabs review / escalated / leads / retirements (like `organizations-table.tsx`). `/ops/baskets/[bid]`: snapshot of the submitted version (`basket-view`), diff vs published, org + manager context, validation, previous reviews (internal notes labelled "Internal"), checklist A–G (pass/fail/n/a + note), section comments, decision form (approve shown only for `ops_admin`; changes required / reject require manager message; escalate requires internal note), lead approval card, platform pause/resume/retire and retirement decision with confirm dialogs (admin-only controls hidden for reviewers), self-review notice on 403.
- [ ] **Step 2: Disclosures.** `/ops/disclosures` (admin): templates grouped by key with versions and status; "New version" form (title, body, condition); retire with confirm.
- [ ] **Step 3: Web tests** (mock style as `ops-member-*.test.tsx`, fixtures in `org-fixtures.ts`): wizard save sends `expectedUpdatedAt` and shows the conflict banner on 409; validation panel groups issues by section; allocation editor total/remaining and no auto-normalize; fee toggle shows caps and flags a fixed fee above 1% of the minimum; controls hidden by flags (co-manager without publish sees no Publish); read-only for VIEWER; public page renders status notices, disabled invest button, price unavailable, manager history; alias redirect; ops decision form rules (message/internal note requirements, approve hidden for reviewer); lead approval; platform resume hidden for reviewer; disclosure new version form.
- [ ] **Step 4: Docs (in place).** ADR-011 (basket/version split, publish-after-approval, assignment flags, manager-leaves policy with ops lead approval, fee caps, disclosures pinned, allocation rules, review duties, pause/retire, public pages, no investment; consequences; open items from spec §14). `DECISION-REGISTER.md`: rewrite D-007, D-008, D-028 (rebalance = manager-proposed version, explicit consent); add `D-057` basket access (flags), `D-058` fee caps, `D-059` disclosure templates, `D-060` manager-leaves policy, `D-061` public basket pages. `docs/domains/BASKET-CREATION.md` implemented behavior; `docs/domains/FUND-MANAGER-FEATURES.md` basket/manager sections aligned; `ARCHITECTURE.md` data model + flows; `apps/api/README.md` (no new env); HANDOFF §2 Spec 6 row + §5.
- [ ] **Step 5: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test build`; commits `feat(web): add ops basket review and disclosure templates`, `test(web): cover basket pages`, `docs: record basket decisions`.

---

## Self-Review Notes

- Spec coverage: §2 → constraints; §4 → T1 S1, T2 S1–S4; §5 → T1 S2; §6 → T1 S1; §7 → T1 S3, S5, S6, T2 S2/S4; §8 → T1 S7, T2 S6–S7; §9 → T2 S7; §10 → T3, T4 S1–S2; §11 → constraints + public tests; §12 → per-task tests; §13 → task split; §14 → ADR-011.
- No-DELETE constraint forced one design detail not in the spec: asset rows and disclosure pins are revisioned (`revision` + `assets_revision` / `disclosures_revision`). Both recorded here and to be recorded in ADR-011.
- Names consistent: `requireBasketAction`, `loadValidationInput`, `contentHash`, `endIneligibleAssignments`, `validateBasketVersion`, `diffBasketVersions`, `feeWithinCap`, `publishVersion`, `decideVersion`, `decideLead`, `sendBasketEmail`, `BASKET_VALIDATION_FAILED`, `VERSION_CONFLICT`.
