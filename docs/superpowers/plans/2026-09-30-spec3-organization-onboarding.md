# Spec 3 — Organization Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** four large tasks, tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Permission holders create one individual/firm organization, complete template-driven fields, upload private documents to R2, prove a Solana payout wallet, and submit; ops review organizations, change requests and payout replacements in `/ops`; verified organizations get a public profile.

**Architecture:** New tables in `@repo/db`; field catalog, templates schema, state machines and request/response schemas in `@repo/validator`; API services/routes in the Spec 2 layout (`routes → services → @repo/db`, `http-errors` with `code`, `validate` middleware, `requireSession`/`requireRole`, `writeAudit`); R2 behind `providers/r2.ts`; payout proof reuses the Spec 1 challenge lifecycle with purpose `payout_wallet`; web pages under `apps/web/app/(app)/organization`, `apps/web/app/organizations/[id]`, `apps/web/app/(ops)/ops/organizations/*`.

**Tech Stack:** Express 5, Drizzle 0.45 + Postgres, zod (via `@repo/validator`), http-errors, rate-limiter-flexible, Resend, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (new, pinned exact, newest version allowed by the repo's minimum-release-age policy), Next.js 16, TanStack Query, Reown AppKit (Solana), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-organization-onboarding-design.md`

## Global Constraints

- Follow Spec 2 patterns exactly: `apps/api/src/services/applications.ts` (`OpsCtx { userId, meta }`, `SELECT … FOR UPDATE` transitions, event + audit in one tx, emails after commit, self-review 403), `routes/ops.ts` (`requireSession` + `requireRole("ops_reviewer")` + per-user limit), `routes/manager-applications.ts`, `providers/resend.ts` (`idempotencyKey`), `middleware/rate-limit.ts` (`limits` + `consume`), `services/audit.ts`, tests with `apps/api/test/setup.ts` provider mocks and `test/helpers/*`, `test/managers/helpers.ts`.
- **No extra functions**: no one-caller helpers, no wrappers around library calls. Libraries over custom code. Invoke the `ponytail` skill.
- Check official docs for every API used (AWS SDK v3 S3 `PutObjectCommand`/`HeadObjectCommand`/`GetObjectCommand` with `Range`/`CopyObjectCommand`/`DeleteObjectCommand`, `getSignedUrl` + `signableHeaders`, Cloudflare R2 S3 compatibility page, Drizzle partial indexes / jsonb / arrays, Next 16 App Router, Reown AppKit Solana `signMessage`).
- Statuses exactly — organization: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `CHANGES_REQUIRED`, `RESUBMITTED`, `VERIFIED`, `REJECTED`; version: `draft`, `in_review`, `changes_required`, `approved`, `rejected`, `superseded`; payout wallet: `UNVERIFIED`, `VERIFYING`, `VERIFIED`, `REPLACEMENT_PENDING`, `REVOKED`; document: `pending_upload`, `uploaded`, `rejected_file`; membership role: `OWNER`, `ADMIN`, `MANAGER`, `ANALYST`, `VIEWER`; membership status `active`, `revoked`.
- New error codes exactly: `ORGANIZATION_EXISTS` (409), `REQUIREMENTS_INCOMPLETE` (422, `details.missing: { fields: string[]; documents: string[]; payoutWallet: boolean }`), `DOCUMENT_REJECTED` (422).
- Documents: `application/pdf`, `image/jpeg`, `image/png`; max `10 * 1024 * 1024` bytes; presigned URLs expire in 300 s; keys `incoming/<orgId>/<documentId>` → `documents/<orgId>/<documentId>`; magic bytes `%PDF-`, `FF D8 FF`, `89 50 4E 47 0D 0A 1A 0A`; downloads `attachment`; `scan_status = not_scanned`.
- Payout challenge statement exactly: `Verify payout wallet for Bytesac organization <orgId>. This does not sign you in or authorize any transfer.`
- Rate limits: owner mutations 60/min per user; document presign 30/h per org; public profile 60/min per IP; ops 120/min per user (reuse Spec 2 ops limit); payout challenge reuses Spec 1 challenge limits.
- Presigned URLs, R2 keys, private details and document metadata never logged.
- Web: dark design system, 44 px targets, status text+icon, lucide only; no mobile changes.
- Docs rewritten in place (never append "update" notes; never edit `docs/source/*`).
- Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.

## Review Focus

1. **Owner uploads, then abandons the confirm (tab closed)** → no `uploaded` row, no linked document, submit still lists the type as missing; test in Task 1 (presign without confirm → `missing.documents` contains the type).
2. **Owner uploads a renamed `.exe` as `application/pdf`** → confirm rejects (`DOCUMENT_REJECTED`), object deleted, row `rejected_file`; test in Task 1.
3. **Owner re-uses a sign-in challenge id on the payout verify route (or a payout challenge on `/v1/auth/verify`)** → refused, nothing linked or verified; test in Task 2.
4. **Ops approve a payout replacement while the owner starts another one** → exactly one `VERIFIED` wallet per org afterwards (partial unique + row lock); test in Task 2.
5. **Change request pending while an investor opens the public profile** → sees the current approved version only; test in Task 2 (public response equals version N until approval) and Task 3 (profile page renders public fields only).

---

## File Structure

```
packages/db/src/schema/organizations.ts          NEW tables (organizations, memberships, versions, documents, version_documents, requirement templates, payout wallets, events)
packages/db/src/schema/enums.ts                  + org enums; challenge_purpose + 'payout_wallet'
packages/db/src/schema/identity.ts               auth_challenges + organization_id (nullable)
packages/db/src/schema/index.ts                  export organizations
packages/db/migrations/0005_organizations.sql    generated + grants/RLS appended (0001/0003 style) + template seed rows
packages/validator/src/organizations.ts          NEW catalog, doc types, machines, schemas
packages/validator/src/errors.ts                 + 3 codes
packages/validator/src/auth.ts                   challengePurposeSchema stays ["sign_in","add_chain_account"] (public auth API unchanged)
packages/validator/src/me.ts                     + organizations
apps/api/src/env.ts                              + R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
apps/api/src/providers/r2.ts                     NEW S3 client + bucket
apps/api/src/providers/resend.ts                 + sendOrganizationEmail(kind, …)
apps/api/src/services/organizations.ts           NEW owner flow, submit, change requests, public view
apps/api/src/services/organization-review.ts     NEW ops list/detail/transition/decisions/notes/download
apps/api/src/services/payout-wallets.ts          NEW enter/challenge/verify
apps/api/src/services/sign-in.ts                 extract claimChallenge(id, purposes) shared with payout verify; sign-in claim excludes payout_wallet
apps/api/src/services/sign-in-message.ts         buildSignInMessage accepts optional statement
apps/api/src/routes/organizations.ts             NEW owner routes
apps/api/src/routes/public.ts                    NEW GET /v1/public/organizations/:id
apps/api/src/routes/ops.ts                       + organization routes
apps/api/src/routes/me.ts                        + organizations
apps/api/src/middleware/rate-limit.ts            + limits
apps/api/src/app.ts                              mount routers
apps/api/test/setup.ts                           mock providers/r2 and sendOrganizationEmail
apps/api/test/organizations/*.test.ts            NEW
packages/api-client/src/client.ts                + endpoints
packages/app-core/src/organization-status.ts     NEW labels/tones
apps/web/app/(app)/organization/page.tsx, apps/web/components/organization/*
apps/web/app/organizations/[id]/page.tsx
apps/web/app/(ops)/ops/organizations/page.tsx, [id]/page.tsx, apps/web/components/ops/organization-*.tsx
apps/web/app/(app)/home/page.tsx                 card
docs/…                                           in-place updates + ADR-008
```

---

### Task 1: Data, contracts, R2, owner draft + documents (API)

**Files:** create `packages/db/src/schema/organizations.ts`, `packages/validator/src/organizations.ts`, `packages/validator/src/organizations.test.ts`, `apps/api/src/providers/r2.ts`, `apps/api/src/services/organizations.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/test/organizations/owner-flow.test.ts`, `apps/api/test/organizations/helpers.ts`; modify `packages/db/src/schema/{enums,identity,index}.ts`, `packages/validator/src/{errors,index}.ts`, `apps/api/src/env.ts` (+ `.env.example`), `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/app.ts`, `apps/api/test/setup.ts`, `packages/api-client/src/client.ts`, `apps/api/package.json`; migration `0005_organizations.sql`.

**Interfaces — Produces:**
- `@repo/validator`: `ORGANIZATION_TYPES`, `ORGANIZATION_STATUSES`, `ORGANIZATION_TRANSITIONS: Readonly<Record<OrganizationStatus, readonly OrganizationStatus[]>>` (ops only), `VERSION_STATUSES`, `PAYOUT_WALLET_STATUSES`, `ORGANIZATION_FIELDS: Readonly<Record<OrganizationFieldKey, { label: string; visibility: "public" | "private"; schema: z.ZodType }>>`, `ORGANIZATION_DOCUMENT_TYPES: Readonly<Record<DocumentTypeKey, { label: string }>>`, `DOCUMENT_CONTENT_TYPES`, `MAX_DOCUMENT_BYTES`, `createOrganizationRequestSchema`, `updateDraftRequestSchema`, `presignDocumentRequestSchema`, `organizationDetailSchema` (owner view), `publicOrganizationSchema`, `missingRequirementsSchema`.
- `@repo/db`: tables `organizations`, `organizationMemberships`, `organizationVersions`, `organizationDocuments`, `organizationVersionDocuments`, `verificationRequirementTemplates`, `organizationPayoutWallets`, `organizationEvents` + enums.
- `providers/r2.ts`: `export const r2 = new S3Client({ region: "auto", endpoint: \`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com\`, credentials })`, `export const R2_BUCKET = env.R2_BUCKET`.
- `services/organizations.ts`: `createOrganization(ctx, body)`, `listMyOrganizations(userId)`, `getOrganizationForOwner(ctx, id)`, `updateDraft(ctx, id, body)`, `presignDocument(ctx, id, body)`, `confirmDocument(ctx, id, docId)`, `unlinkDocument(ctx, id, docId)`, `resolveTemplate(conn, type, jurisdiction)`, `missingRequirements(conn, org, version)`; owner guard `requireOwner(conn, userId, orgId)` (used by every owner service and Task 2's payout service); `export interface OwnerCtx { userId: string; sessionId: string; meta: RequestMeta }` (built in routes from `req.auth` + `req.meta`, like Spec 2 `OpsCtx`).

- [ ] **Step 1: Schema** — exactly spec §5 columns, enums, checks and partial uniques, except `organization_version_documents` is `id`, `version_id`, `document_id`, `created_at`, `removed_at` (soft unlink; partial unique `(version_id, document_id)` where `removed_at is null`) so the runtime role keeps no DELETE (D-038). Add `organization_id uuid null` to `auth_challenges` and `'payout_wallet'` to `challenge_purpose`; add check `auth_challenges_org_for_payout`: `purpose <> 'payout_wallet' OR (organization_id IS NOT NULL AND session_id IS NOT NULL)`.
- [ ] **Step 2: Migration** — `pnpm --filter @repo/db db:generate --name=organizations`; append grants (SELECT/INSERT/UPDATE to `bytesac_api`), `ENABLE ROW LEVEL SECURITY` + `api_all` policy per new table (copy 0003); append seed rows for the two default templates exactly as spec §4 (`jurisdiction` null). Note: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block on older Postgres — verify drizzle-kit output runs under the repo's migrator (`packages/db/src/migrate.ts`); split into `0005` (enum value) + `0006` if needed.
- [ ] **Step 3: Validator** — catalog, doc types, machines and schemas. Machines (exact):

```ts
export const ORGANIZATION_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "RESUBMITTED", "VERIFIED", "REJECTED"] as const;
/** Ops transitions. DRAFT→SUBMITTED and CHANGES_REQUIRED→RESUBMITTED are owner submits. */
export const ORGANIZATION_TRANSITIONS: Readonly<Record<OrganizationStatus, readonly OrganizationStatus[]>> = {
  DRAFT: [],
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["CHANGES_REQUIRED", "VERIFIED", "REJECTED"],
  CHANGES_REQUIRED: [],
  RESUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  VERIFIED: [],
  REJECTED: [],
};
```

  `updateDraftRequestSchema`: `z.strictObject({ publicProfile: z.record(...).optional(), privateDetails: ... })` where each key must be a catalog key of the matching visibility and each value passes that field's schema (use `superRefine` iterating entries; unknown key → issue at its path). Catalog schemas per spec §4 (`dateOfBirth`: ISO date, age ≥ 18 computed from `Date.now()` in the refine; `website`: `z.url()` with `https:`). Transition request schema reuses Spec 2's refine pattern: `messageToOwner` required when `to === "CHANGES_REQUIRED"`; version decision schema requires it for `changes_required`. Tests in `organizations.test.ts`: every template-seed key exists in the catalog (import the seed arrays from a shared constant `DEFAULT_TEMPLATES` exported here and used by the migration seed SQL comment/test only — the SQL literal must match; assert equality in the test by reading `0005_organizations.sql` text); unknown key rejected; private key under publicProfile rejected; http website rejected; transitions have no self-loops, terminal states empty; CHANGES_REQUIRED without message fails.
- [ ] **Step 4: R2 provider + env** — env vars via envalid `str()` (tests set dummies in `test/setup.ts` env); `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` pinned exact in `apps/api/package.json`. `vi.mock("../src/providers/r2")` in setup with an in-memory `send` fake keyed by command name (store bodies per key so HEAD/GET-range/Copy/Delete behave) and `getSignedUrl` mocked to return `https://r2.test/<key>?sig`.
- [ ] **Step 5: Template resolution (exact)**:

```ts
export async function resolveTemplate(conn: DbOrTx, type: OrganizationType, jurisdiction: string) {
  const [t] = await conn.select().from(verificationRequirementTemplates)
    .where(and(eq(verificationRequirementTemplates.organizationType, type), isNull(verificationRequirementTemplates.retiredAt),
      or(eq(verificationRequirementTemplates.jurisdiction, jurisdiction), isNull(verificationRequirementTemplates.jurisdiction))))
    .orderBy(sql`${verificationRequirementTemplates.jurisdiction} is null`) // jurisdiction-specific first
    .limit(1);
  if (!t) throw createHttpError(500, "No verification template configured", { code: "INTERNAL" });
  return t;
}
```

  `missingRequirements(conn, org, version)` returns `{ fields, documents, payoutWallet }`: fields = required keys absent/invalid in `publicProfile ∪ privateDetails` (validate each with the catalog schema); documents = required types without a linked `uploaded` document on `version`; `payoutWallet` = true when no `VERIFIED` payout wallet row (Task 2 fills wallets; here it is simply the query). Unknown template key → throw 500 (config error), covered by a test that inserts a bad template.
- [ ] **Step 6: Owner services** —
  - `createOrganization`: requires active `create_manager_organization` in `userPermissions` (403 `FORBIDDEN`); one tx: insert org `DRAFT`, version 1 `draft` (empty jsonb), OWNER membership, event, audit `organization.created`; unique violation on the open-org index → 409 `ORGANIZATION_EXISTS` "You already have an organization in progress.".
  - `requireOwner`: active `OWNER` membership else 403 `FORBIDDEN` "You don't have access to this organization."; unknown org → 404 `NOT_FOUND`.
  - Editable version = the org's version in (`draft`,`changes_required`); none → 409 `INVALID_TRANSITION` "This organization can't be edited right now.".
  - `updateDraft`: merge given keys into the version's jsonb (`publicProfile`/`privateDetails`), `updated_at`.
  - `presignDocument`: limit per org; validates content type/size (schema); insert `pending_upload` row with `r2_key = incoming/<orgId>/<docId>`; `getSignedUrl(r2, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) })`; return `{ documentId, uploadUrl, headers: { "Content-Type": contentType } }`.
  - `confirmDocument` (exact core):

```ts
const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key })).catch(() => null);
const first = head && head.ContentLength === doc.sizeBytes && head.ContentType === doc.contentType
  ? Buffer.from(await (await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key, Range: "bytes=0-7" }))).Body!.transformToByteArray())
  : null;
const MAGIC: Record<DocumentContentType, number[]> = { "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] };
const ok = first !== null && MAGIC[doc.contentType].every((b, i) => first[i] === b);
if (!ok) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key })).catch(() => undefined);
  await db.update(organizationDocuments).set({ status: "rejected_file" }).where(eq(organizationDocuments.id, doc.id));
  throw createHttpError(422, "This file doesn't match its type or size. Upload a PDF, JPEG or PNG up to 10 MB.", { code: "DOCUMENT_REJECTED" });
}
const finalKey = `documents/${orgId}/${doc.id}`;
await r2.send(new CopyObjectCommand({ Bucket: R2_BUCKET, CopySource: `${R2_BUCKET}/${doc.r2Key}`, Key: finalKey }));
await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key }));
// tx: row uploaded (r2Key = finalKey, uploadedAt now()), replace same-type link in the editable version, event document_uploaded, audit
```

    Only `pending_upload` rows of this org can be confirmed (else 409 `INVALID_TRANSITION`).
  - `unlinkDocument`: set `removed_at = now()` on the active link in the editable version (document row and object stay); event + audit. Replacing a same-type link on confirm also soft-removes the old link. All link reads filter `removed_at is null`.
  - `getOrganizationForOwner`: org, editable + current version, linked documents metadata (id, type, contentType, size, status, uploadedAt — **never** `r2Key`), payout wallets (Task 2 rows), resolved template, `missing`, latest `message_to_owner` event.
- [ ] **Step 7: Routes** — `routes/organizations.ts` (`router.use(requireSession)`, owner-mutation limit): `POST /`, `GET /mine`, `GET /:id`, `PATCH /:id/draft`, `POST /:id/documents`, `POST /:id/documents/:docId/confirm`, `DELETE /:id/draft/documents/:docId`. Mount `/v1/organizations`.
- [ ] **Step 8: API client** — matching methods (`createOrganization`, `myOrganizations`, `getOrganization`, `updateOrganizationDraft`, `presignOrganizationDocument`, `confirmOrganizationDocument`, `unlinkOrganizationDocument`).
- [ ] **Step 9: Tests** (`test/organizations/owner-flow.test.ts`, real DB, mocked R2): create without permission → 403; create → DRAFT + OWNER membership + version 1; second create → 409 `ORGANIZATION_EXISTS`; after setting first org `REJECTED` directly in DB → create allowed; non-member GET/PATCH → 403; PATCH unknown key → 400; presign bad type / 11 MB → 400; presign → fake PUT (write bytes into the fake store) → confirm PDF → `uploaded`, linked, response has no `r2Key`; confirm with PNG bytes declared as PDF → 422 `DOCUMENT_REJECTED`, object deleted, row `rejected_file`; presign without upload → confirm → 422; `missing` lists all firm template fields/documents initially and shrinks as filled (Review Focus 1); jurisdiction-specific template wins over default (insert one for `SG`); owner re-uploads same type → link replaced; unlink removes link only.
- [ ] **Step 10: Gate + commit** — `pnpm db:up`; `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`; commit `feat(api): add organization drafts, templates and R2 document upload`.

---

### Task 2: Payout wallet proof, submit, change requests, ops review, public API

**Files:** create `apps/api/src/services/payout-wallets.ts`, `apps/api/src/services/organization-review.ts`, `apps/api/src/routes/public.ts`, `apps/api/test/organizations/{payout,review,public}.test.ts`; modify `services/organizations.ts`, `services/sign-in.ts`, `services/sign-in-message.ts`, `routes/organizations.ts`, `routes/ops.ts`, `routes/me.ts`, `providers/resend.ts`, `middleware/rate-limit.ts`, `app.ts`, `packages/validator/src/{organizations,me}.ts`, `packages/api-client/src/client.ts`, `apps/api/test/setup.ts`.

**Interfaces — Consumes:** Task 1 services/tables/schemas; Spec 1 `verifySolanaSignature`, `buildSignInMessage`, `issueChallenge` internals; Spec 2 `OpsCtx`, `requireRole`, ops router.
**Produces:** `enterPayoutWallet(ctx, orgId, address)`, `issuePayoutChallenge(ctx, orgId)`, `verifyPayoutWallet(ctx, orgId, { challengeId, signature })`; `submitOrganization(ctx, orgId)`, `createChangeRequest(ctx, orgId)`, `submitChangeRequest(ctx, orgId)`, `getPublicOrganization(id)`; `listOrganizationsForReview(q)`, `getOrganizationForReview(id)`, `transitionOrganization(ctx, id, body)`, `decideVersion(ctx, id, versionId, body)`, `decidePayoutWallet(ctx, id, walletId, body)`, `addOrganizationNote(ctx, id, note)`, `documentDownloadUrl(ctx, id, docId)`; `sendOrganizationEmail(kind, to, data, idempotencyKey)` with kinds `changes_required | verified | rejected | change_request_decided | payout_replacement_requested | payout_replacement_decided`; `/me.organizations`.

- [ ] **Step 1: Challenge sharing (subtle)** — in `services/sign-in.ts` extract the Phase A claim into `export async function claimChallenge(challengeId: string, purposes: readonly ChallengePurpose[]): Promise<{ ch: ChallengeRow; claimId: string }>` (same `UPDATE … WHERE` plus `inArray(authChallenges.purpose, purposes)`; the not-found branch also treats a row whose purpose is not in `purposes` as `CHALLENGE_NOT_FOUND`). `verifyChallenge` calls it with `["sign_in", "add_chain_account"]` (Review Focus 3). Widen the `ChallengePurpose` type used by the db enum only — the public `challengePurposeSchema` stays `["sign_in","add_chain_account"]`. `buildSignInMessage` gains optional `statement` (defaults to `SIGN_IN_STATEMENT`).
- [ ] **Step 2: Payout wallet service (exact core)**:

```ts
// enterPayoutWallet: requireOwner; canonicalizeAddress("solana", raw); org must be DRAFT | CHANGES_REQUIRED | VERIFIED.
// tx: revoke any row in (UNVERIFIED, VERIFYING) for the org (status REVOKED, deactivated_at now()), insert UNVERIFIED, event, audit.
// A REPLACEMENT_PENDING row blocks a new entry: 409 INVALID_TRANSITION "A payout wallet change is already awaiting review."

export async function issuePayoutChallenge(ctx: OwnerCtx, orgId: string): Promise<ChallengeResponse> {
  await requireOwner(db, ctx.userId, orgId);
  const [w] = await db.select().from(organizationPayoutWallets)
    .where(and(eq(organizationPayoutWallets.organizationId, orgId), inArray(organizationPayoutWallets.status, ["UNVERIFIED", "VERIFYING"])));
  if (!w) throw createHttpError(409, "Enter a payout wallet address first.", { code: "INVALID_TRANSITION" });
  // same limits/time/nonce as issueChallenge; message via buildSignInMessage({ …, statement: `Verify payout wallet for Bytesac organization ${orgId}. This does not sign you in or authorize any transfer.` })
  // insert auth_challenges { purpose: "payout_wallet", chain: "solana", address: w.address, organizationId: orgId, sessionId: ctx.sessionId, … }
  // update wallet → VERIFYING
}

export async function verifyPayoutWallet(ctx: OwnerCtx, orgId: string, i: { challengeId: string; signature: string }): Promise<void> {
  await requireOwner(db, ctx.userId, orgId);
  const { ch, claimId } = await claimChallenge(i.challengeId, ["payout_wallet"]);
  if (ch.organizationId !== orgId || ch.sessionId !== ctx.sessionId) { /* mark rejected + audit like TERMINAL path */ throw createHttpError(400, "Signature could not be verified", { code: "SIGNATURE_INVALID" }); }
  const outcome = verifySolanaSignature({ address: ch.address, message: ch.message, signature: i.signature });
  if (outcome.kind === "invalid") { /* mark rejected + audit */ throw createHttpError(400, "Signature could not be verified", { code: "SIGNATURE_INVALID" }); }
  await db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
    // consume challenge (status processing + claimId guard) — 0 rows → CHALLENGE_IN_PROGRESS
    const [w] = await tx.select().from(organizationPayoutWallets).where(and(eq(organizationPayoutWallets.organizationId, orgId), eq(organizationPayoutWallets.address, ch.address), eq(organizationPayoutWallets.status, "VERIFYING"))).for("update");
    if (!w) throw createHttpError(409, "Start the payout wallet check again.", { code: "INVALID_TRANSITION" });
    const [active] = await tx.select().from(organizationPayoutWallets).where(and(eq(organizationPayoutWallets.organizationId, orgId), eq(organizationPayoutWallets.status, "VERIFIED"))).for("update");
    if (active && org!.status === "VERIFIED") {
      await tx.update(organizationPayoutWallets).set({ status: "REPLACEMENT_PENDING", verifiedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, w.id));
      // event + audit payout_wallet.replacement_requested; after commit email payout_replacement_requested
    } else {
      if (active) await tx.update(organizationPayoutWallets).set({ status: "REVOKED", deactivatedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, active.id));
      await tx.update(organizationPayoutWallets).set({ status: "VERIFIED", verifiedAt: sql`now()`, activatedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, w.id));
      // event + audit payout_wallet.verified
    }
  });
}
```

  Owner routes: `POST /:id/payout-wallet`, `POST /:id/payout-wallet/challenge`, `POST /:id/payout-wallet/verify`. Payout verify must not change sessions or wallet_addresses.
- [ ] **Step 3: Submit + change requests** — `submitOrganization`: tx, org `FOR UPDATE`; status `DRAFT` → `SUBMITTED` or `CHANGES_REQUIRED` → `RESUBMITTED`, else `INVALID_TRANSITION`; `missingRequirements` non-empty → 422 `REQUIREMENTS_INCOMPLETE` with `details.missing`; version → `in_review`, `submitted_at`; event + audit. `createChangeRequest`: org `VERIFIED`, no open version (partial unique → 409 `INVALID_TRANSITION` "A change request is already open."); new version `version_number = max + 1`, copy current version jsonb and links. `submitChangeRequest`: version `draft|changes_required` → `in_review` with the same field/document completeness check (payout wallet not required).
- [ ] **Step 4: Ops review service** — self-review: acting user with any row in `organization_memberships` for the org → 403 `FORBIDDEN` "You can't review your own organization." (checked under the org row lock in every mutation; reads allowed).
  - `transitionOrganization`: org `FOR UPDATE`; `to ∈ ORGANIZATION_TRANSITIONS[status]` else 409; on `CHANGES_REQUIRED` version `in_review → changes_required`; on `VERIFIED` version → `approved`, `current_version_id`, `verified_at`, `decided_by_user_id`; on `REJECTED` version → `rejected`, `decided_*`; event (note/message) + audit `organization.status_changed`; after commit email for `CHANGES_REQUIRED | VERIFIED | REJECTED` (idempotencyKey `organization-status/<eventId>`).
  - `decideVersion`: org `VERIFIED`, version `in_review` and not the initial one; `approved` → previous current `superseded`, switch `current_version_id`; `changes_required` (message required) / `rejected`; event `version_decided` + audit; email `change_request_decided`.
  - `decidePayoutWallet`: org `FOR UPDATE`, wallet `REPLACEMENT_PENDING` `FOR UPDATE`; `approved` → current `VERIFIED` → `REVOKED` + `deactivated_at`, new → `VERIFIED` + `activated_at` (update the old row first to respect the one-VERIFIED partial unique); `rejected` → new `REVOKED`; event + audit; email `payout_replacement_decided` (Review Focus 4).
  - `listOrganizationsForReview({ queue, status?, q?, cursor? })`: `organizations` queue excludes `DRAFT`; `change_requests` = orgs with a version `in_review` whose org is `VERIFIED`; `payout_changes` = orgs with a `REPLACEMENT_PENDING` wallet; `q` ILIKE on display name (`public_profile->>'displayName'` of latest version) or `private_details->>'legalName'/'legalCompanyName'`; cursor base64url `updated_at|id`, page 25.
  - `getOrganizationForReview`: org, all versions (jsonb), documents (metadata incl. link to version ids), payout wallets (all rows), events asc, owner user id + their auth wallet addresses.
  - `documentDownloadUrl`: `getSignedUrl(r2, new GetObjectCommand({ Bucket, Key, ResponseContentDisposition: \`attachment; filename="${documentType}.${ext}"\` }), { expiresIn: 300 })`; route responds `302` to it; audit `organization_document.downloaded`.
  - Routes in `routes/ops.ts` with `requireRole("ops_reviewer")` exactly as spec §9 ops table.
- [ ] **Step 5: Public + me** — `routes/public.ts` `GET /v1/public/organizations/:id` (per-IP limit, no session): `VERIFIED` only else 404; returns `{ id, type, jurisdiction, verifiedAt, profile }` where `profile` keeps only catalog keys with `visibility === "public"` from the **current** version. `/me` adds `organizations: [{ id, role, status }]` for active memberships; extend `meResponseSchema` and fix web/mobile `me` fixtures (`organizations: []`).
- [ ] **Step 6: Emails** — `sendOrganizationEmail` beside `sendApplicationEmail`: plain factual text per kind; recipient = owner's verified email contact (query Spec 1 `contacts` where verified email for the owner); none → `logger.info` skip; failures `logger.warn`, never throw.
- [ ] **Step 7: API client** — owner payout/submit/change-request methods, public profile, ops methods, `me` shape.
- [ ] **Step 8: Tests** — `payout.test.ts`: enter → challenge → sign with a test ed25519 key (reuse `test/helpers/wallets.ts`) → `VERIFIED`; typed address alone never `VERIFIED`; payout challenge id on `/v1/auth/verify` → `CHALLENGE_NOT_FOUND`, no session/user created; sign-in challenge id on payout verify → `CHALLENGE_NOT_FOUND`; challenge from another session → `SIGNATURE_INVALID`; pre-verification re-prove replaces (old `REVOKED`); verified org re-prove → `REPLACEMENT_PENDING`, old still `VERIFIED`; concurrent `decidePayoutWallet(approved)` + owner `enterPayoutWallet` → exactly one `VERIFIED` row. `review.test.ts`: full journey create → fill → docs → wallet → submit → UNDER_REVIEW → CHANGES_REQUIRED (no message → 400) → owner edits → RESUBMITTED → UNDER_REVIEW → VERIFIED (current version set, emails mocked for three statuses); submit incomplete → 422 exact `missing`; invalid transition → 409; no role → 403 on every ops route; member-of-org ops user → 403 on mutations; queues filter correctly; download → 302 with `attachment` URL, owner cannot hit ops download (403). `public.test.ts`: DRAFT/UNDER_REVIEW → 404; VERIFIED → only public keys (assert every private key absent); change request pending → public equals old version until `decideVersion(approved)`, then new (Review Focus 5); rate-limit deny → 429.
- [ ] **Step 9: Gate + commit** — full api/validator/api-client/db gate; commit `feat(api): add payout wallet proof, organization review and public profile`.

---

### Task 3: Web owner workspace, Home card, public profile

**Files:** create `apps/web/app/(app)/organization/page.tsx`, `apps/web/components/organization/{create-organization,organization-fields,organization-documents,payout-wallet,submit-checklist,change-request}.tsx`, `apps/web/app/organizations/[id]/page.tsx`, `packages/app-core/src/organization-status.ts`, tests `apps/web/test/organization-*.test.tsx`; modify `apps/web/app/(app)/home/page.tsx`, `packages/app-core/src/{index,error-copy}.ts`.

- [ ] **Step 1: app-core** — `ORGANIZATION_STATUS_LABEL`, `VERSION_STATUS_LABEL`, `PAYOUT_WALLET_STATUS_LABEL`: `Record<…, { label: string; tone: "success" | "warning" | "danger" | "neutral" }>`; error copy for the 3 new codes.
- [ ] **Step 2: Workspace** — `/organization` client page using TanStack Query `["organization", id]` (id from `me.organizations[0]`):
  - No org + permission → create step (type radio, jurisdiction 2-letter input as Spec 2 country) → `createOrganization`.
  - Fields: render template-required + optional catalog fields for the org type in "Public profile" and "Private details (never shown publicly)" sections; client validation with the catalog schemas for field errors; save → `updateOrganizationDraft`; values preserved on error.
  - Documents: one row per required type (+ optional `license_registration`): choose file → check type/size client-side → `presignOrganizationDocument` → `fetch(uploadUrl, { method: "PUT", body: file, headers })` → `confirmOrganizationDocument`; states idle/uploading/uploaded/rejected; remove from draft.
  - Payout wallet: address input → `enterPayoutWallet` → "Connect & sign" uses the existing AppKit Solana connection to `signMessage` the challenge message (follow `components/auth/*` sign-in signing code) → `verifyPayoutWallet`; shows status badge and history list.
  - Submit checklist from `missing`; submit button disabled until empty; `REQUIREMENTS_INCOMPLETE` refreshes the list.
  - Read-only with status banner while `SUBMITTED | UNDER_REVIEW | RESUBMITTED`; `CHANGES_REQUIRED` shows the ops message and re-enables editing + "Resubmit".
  - `VERIFIED`: "View public profile" link, "Edit profile" → `createChangeRequest` then same field/document editors on the draft version with its own status + submit; "Change payout wallet" (shows `REPLACEMENT_PENDING` notice).
- [ ] **Step 3: Public profile** — `/organizations/[id]` server component fetching `GET /v1/public/organizations/:id` via the server API base used by `lib/server-me.ts`; 404 → `notFound()`; shows verified badge (icon + text), type, jurisdiction, public fields, verified date. No private data reachable.
- [ ] **Step 4: Home card** — replace the Spec 2 "coming soon" card: permission + no org → "Create your organization" → `/organization`; org exists → status card (label + tone) → `/organization`.
- [ ] **Step 5: Tests** — create step submits; field error shown for http website, values kept; document upload happy path (mock fetch + client) and rejected state; payout wallet flow calls enter → challenge → sign → verify (mock signer); submit checklist lists missing items and disables submit; read-only banner when `UNDER_REVIEW`; `CHANGES_REQUIRED` shows message; public profile renders public fields only; home card variants.
- [ ] **Step 6: Gate + commit** — `pnpm --filter web lint check-types test build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add organization workspace and public profile`.

---

### Task 4: Web ops organizations area + docs

**Files:** create `apps/web/app/(ops)/ops/organizations/page.tsx`, `apps/web/app/(ops)/ops/organizations/[id]/page.tsx`, `apps/web/components/ops/{organizations-table,organization-review,organization-change-request,organization-payout-change}.tsx`, tests `apps/web/test/ops-organization-*.test.tsx`; modify `apps/web/app/(ops)/ops/layout.tsx` (nav "Organizations"); docs.

- [ ] **Step 1: List** — tabs Organizations / Change requests / Payout wallet changes (`queue`), status chips (Organizations tab), search (300 ms debounce as Spec 2), table desktop / cards mobile, load more (`useInfiniteQuery`, same pattern as `applications-table.tsx`).
- [ ] **Step 2: Detail** — owner summary (user id + auth wallets); "Public profile" and "Private details" panels rendered from catalog labels; documents list with Download (link to the ops download route, opens in new tab); payout wallet panel with full history (status badges, activated/deactivated dates); review form showing **only** `ORGANIZATION_TRANSITIONS[status]` targets, message to owner (required for `CHANGES_REQUIRED`), internal note; note form; timeline with internal notes labelled "Internal"; 403 → access-lost state (reuse `ops-error.tsx`).
- [ ] **Step 3: Change request view** — current vs proposed side by side per catalog field, changed rows marked (text + icon), added/removed documents listed; decision buttons approve / changes required (message required) / reject.
- [ ] **Step 4: Payout change view** — current vs new wallet (address, verified time) with approve / reject + note.
- [ ] **Step 5: Tests** — review form offers only allowed targets; changes-required needs message; diff marks changed fields; payout decision calls the client; 403 shows access-lost.
- [ ] **Step 6: Docs (in place)** — new `docs/decisions/ADR-008-ORGANIZATION-ONBOARDING.md` (decisions table from spec §2 + consequences); `DECISION-REGISTER.md`: rewrite D-005 (org lifecycle + versions + one open org per creator), D-006 (payout wallet proof + replacement review), D-019 (R2 presigned direct PUT, `incoming/` lifecycle, no scanner); add rows for requirement templates, whole-profile versioning, document safety; `docs/domains/MANAGER-ORGANISATION-ONBOARDING.md` "Organization and wallet" rewritten to the implemented behavior; `ARCHITECTURE.md` §4 manager/org section + §7 persistence names (`organization_versions`, `organization_version_documents`, `verification_requirement_templates`, `organization_payout_wallets`, `organization_events`) + §8 R2 row; `apps/api/README.md` R2 setup (bucket, token, CORS PUT from web origins, lifecycle `incoming/` 1 day, env vars); `docs/superpowers/HANDOFF.md` §2 Spec 3 row.
- [ ] **Step 7: Gate + commit** — `pnpm db:up`; `pnpm turbo run lint check-types test build`; commits `feat(web): add ops organization review` and `docs: record organization onboarding decisions`.

---

## Self-Review Notes

- Spec coverage: §4 → T1 S3/S5; §5 → T1 S1–2; §6 → T1 S3, T2 S2–4; §7 → T1 S4/S6, T2 S4 (download); §8 → T2 S1–2; §9 owner → T1/T2, public/ops/me → T2; §10 → T2 S6; §11 → T3/T4; §12 → constraints + T1/T2 tests; §13 → per-task tests; §15/§16 → T4 docs.
- Names consistent: `ORGANIZATION_TRANSITIONS`, `requireOwner`, `claimChallenge`, `resolveTemplate`, `missingRequirements`, `sendOrganizationEmail`, `ORGANIZATION_STATUS_LABEL`.
