# Spec 2 — Manager Application + Screening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** four large tasks, tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Public fund-manager application with email confirmation and private status link, a web ops area for screening with role-based access, and the `create_manager_organization` permission granted once screening is approved and the applicant proves the submitted wallet.

**Architecture:** New tables in `@repo/db`; schemas/codes in `@repo/validator`; API routes/services in the restructured `apps/api` layout (routes → services → `@repo/db`, `http-errors` with `code`, `validate` middleware, providers for Resend); a grant hook inside the existing sign-in `finalize` transaction; web pages under `apps/web/app/managers/*` and `apps/web/app/(ops)/ops/*`.

**Tech Stack:** Express 5, Drizzle 0.45 + Postgres (Supabase), zod (via `@repo/validator`), http-errors, rate-limiter-flexible, Resend, Next.js 16, TanStack Query, shadcn, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-manager-application-screening-design.md`

## Global Constraints

- Follow the restructured layout and patterns exactly: `apps/api/src/routes/contacts.ts` (router + `validate` + `requireSession`), `services/contacts.ts` (service functions taking `{ userId, sessionId, meta }` ctx), `providers/resend.ts` (Resend call with `idempotencyKey`), `middleware/rate-limit.ts` (`limits` + `consume`), `services/audit.ts` (`writeAudit`), tests with `apps/api/test/setup.ts` provider mocks and `test/helpers/*`.
- **No extra functions**: no one-caller helpers, no wrappers around library calls. Libraries over custom code.
- Check official docs for any API you use (Resend, Drizzle partial indexes/`for("update")`, Next 16 App Router).
- Typed wallet address is an identifier only — it never creates, activates or links a user.
- Status token: 32 random bytes (base64url), stored only as HMAC-SHA256 with `env.SESSION_TOKEN_PEPPER`; delivered in URL **fragment** `/managers/status#<token>`; sent to API in header `X-Application-Token`.
- Code: 6 digits, 10-minute expiry, max 5 attempts, 60 s resend cooldown (reuse `services/otp.ts`).
- Rate limits: create 5/h per IP and 3/day per email; resend 5/h per email; status/reply 30/min per IP; ops 120/min per user.
- Status names exactly: `EMAIL_PENDING`, `SUBMITTED`, `SCREENING`, `CONTACTED`, `ADDITIONAL_INFORMATION_REQUIRED`, `SCREENING_APPROVED`, `SCREENING_REJECTED`.
- New error codes exactly: `INVALID_TRANSITION` (409), `APPLICATION_EXISTS` (409), `APPLICATION_TOKEN_INVALID` (401), `REPLY_NOT_ALLOWED` (409), `FORBIDDEN` (403).
- Roles exactly `ops_reviewer`, `ops_admin`; permission exactly `create_manager_organization`.
- Web: dark design system, 44 px targets, status text+icon, lucide only; no mobile changes.
- Docs rewritten in place (never append “update” notes; never edit `docs/source/*`).

## Review Focus

1. **Applicant opens the status link on another device / after token typo** → clear "link invalid or expired" state, no stack trace; test in Task 1 (`APPLICATION_TOKEN_INVALID`).
2. **Same person submits twice (double click or re-submit)** → second create returns `APPLICATION_EXISTS` with a message to check email; test in Task 1.
3. **Ops approves while applicant is mid sign-in with that wallet** → grant happens exactly once (idempotent partial unique index); test in Task 2 (concurrent approve + sign-in).
4. **Ops reviewer loses role while page open** → next action returns 403 and UI shows "You no longer have access"; test in Task 2 (API) and Task 4 (UI).
5. **Firm applicant leaves firm name empty / invalid https website** → field-level validation errors, values preserved; test in Task 1 (schema) and Task 3 (form).

---

## File Structure

```
packages/db/src/schema/managers.ts          NEW tables + enums (applications, events, email codes, platform_roles, user_permissions)
packages/db/src/schema/index.ts             export managers
packages/db/migrations/0003_manager_applications.sql   generated + grants/RLS appended (same style as 0001)
packages/db/migrations/0002_retention_pg_cron.sql      (do not edit) → new migration 0004 replaces app.purge_expired() adding application rules
packages/validator/src/managers.ts          NEW schemas + status list + transition table (shared with web)
packages/validator/src/errors.ts            + 5 codes
packages/validator/src/me.ts                + permissions, platformRoles
apps/api/src/services/applications.ts       NEW public flow + transitions + grantIfProven
apps/api/src/services/platform-roles.ts     NEW role checks/management
apps/api/src/middleware/auth.ts             + requireRole(role)
apps/api/src/providers/resend.ts            + sendApplicationEmail(kind, …)
apps/api/src/routes/manager-applications.ts NEW public routes
apps/api/src/routes/ops.ts                  NEW ops routes
apps/api/src/routes/me.ts                   + permissions/platformRoles
apps/api/src/services/sign-in.ts            finalize: call grantIfProven
apps/api/src/middleware/rate-limit.ts       + limits for applications/ops
apps/api/src/ops/cli.ts                     + grant-role
apps/api/src/app.ts                         mount routers
apps/api/test/managers/*.test.ts            NEW tests
apps/web/app/managers/apply/page.tsx        public form + code step
apps/web/app/managers/status/page.tsx       status page (fragment token)
apps/web/app/(ops)/ops/layout.tsx           server guard (session + role)
apps/web/app/(ops)/ops/applications/page.tsx, [id]/page.tsx, apps/web/app/(ops)/ops/roles/page.tsx
apps/web/components/managers/*, apps/web/components/ops/*
apps/web/app/(app)/home/page.tsx            approved card
packages/api-client/src/client.ts           + endpoints
docs/…                                      in-place updates
```

---

### Task 1: Data, contracts, public application flow (API)

**Files:** create `packages/db/src/schema/managers.ts`, `packages/validator/src/managers.ts`, `apps/api/src/services/applications.ts`, `apps/api/src/routes/manager-applications.ts`, `apps/api/test/managers/public-flow.test.ts`, `packages/validator/src/managers.test.ts`; modify `packages/db/src/schema/index.ts`, `packages/validator/src/{errors,index}.ts`, `apps/api/src/providers/resend.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/app.ts`, `apps/api/test/setup.ts` (mock `sendApplicationEmail`), `packages/api-client/src/client.ts`; migrations `0003`, `0004`.

**Interfaces — Produces:**
- `@repo/validator`: `APPLICATION_STATUSES` tuple, `applicationStatusSchema`, `ApplicationStatus`, `APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]>` (ops transitions only), `createApplicationRequestSchema`, `confirmApplicationEmailSchema` (`{ code }` 6 digits), `applicationStatusResponseSchema`, `applicationReplySchema` (`{ message }` 1–4000 chars).
- `@repo/db`: tables `managerApplications`, `applicationEvents`, `applicationEmailCodes`, `platformRoles`, `userPermissions`; enums `applicationStatus`, `applicantType`, `applicationActor`, `applicationEventKind`, `emailCodeStatus`, `platformRole`, `userPermission`.
- API service `services/applications.ts`: `createApplication(meta, body)`, `confirmApplicationEmail(meta, id, code) → { statusToken }`, `resendApplicationCode(meta, id)`, `getApplicationStatus(token)`, `replyToApplication(meta, token, message)`, plus Task-2 exports.
- Provider: `sendApplicationEmail(kind: "code" | "status_link" | "contacted" | "info_required" | "approved" | "rejected", to, data, idempotencyKey)`.

- [ ] **Step 1: Schema** — `managers.ts` columns and indexes exactly as spec §4. Partial unique indexes: `manager_applications_open_email` on `(email)` where `status <> 'SCREENING_REJECTED'`; `manager_applications_open_wallet` on `(wallet_family, wallet_address)` same predicate (add a `wallet_family` column = chain family, so EVM chains share uniqueness); `application_email_codes_one_pending` on `(application_id)` where `status='pending'`; `platform_roles_active` on `(user_id, role)` where `revoked_at is null`; `user_permissions_active` on `(user_id, permission)` where `revoked_at is null`. `firm_name` check: `applicant_type <> 'firm' or firm_name is not null`.
- [ ] **Step 2: Migrations** — `pnpm --filter @repo/db db:generate --name=manager_applications`; append to `0003` grants (SELECT/INSERT/UPDATE to `bytesac_api`), `ENABLE ROW LEVEL SECURITY` + `api_all` policy for each new table (copy `0001` style). Create custom `0004_purge_applications.sql` that `CREATE OR REPLACE FUNCTION app.purge_expired()` with the **existing body from 0002 verbatim** plus: delete `application_email_codes` resolved > 90 days; delete `manager_applications` in `EMAIL_PENDING` older than 24 h (cascade their codes first). Keep `SECURITY DEFINER` + pinned `search_path` as in 0002.
- [ ] **Step 3: Validator** — statuses, transitions, schemas, error codes. Transition table (exact):

```ts
export const APPLICATION_STATUSES = ["EMAIL_PENDING", "SUBMITTED", "SCREENING", "CONTACTED", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** Transitions ops may perform. EMAIL_PENDING→SUBMITTED (confirm) and ADDITIONAL_INFORMATION_REQUIRED→SCREENING (applicant reply) are system/applicant-only. */
export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  EMAIL_PENDING: [],
  SUBMITTED: ["SCREENING", "SCREENING_REJECTED"],
  SCREENING: ["CONTACTED", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"],
  CONTACTED: ["SCREENING", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["SCREENING", "SCREENING_REJECTED"],
  SCREENING_APPROVED: [],
  SCREENING_REJECTED: [],
};
```

  `createApplicationRequestSchema`: strictObject with `applicantType`, `fullName` (2–120), `firmName` (optional, 2–160; `superRefine` requires it for firm), `email` (z.email, trimmed/lowercased), `phone` (optional, starts with "+"), `country` (2 uppercase letters), `website` (optional `z.url()` with `https:` protocol), `professionalBackground`/`investmentExperience`/`reason`/`intendedBaskets` (20–4000), `qualifications` (optional ≤4000), `walletChain` (chainSchema), `walletAddress` (1–128). Tests in `managers.test.ts`: firm without firmName fails; http website fails; valid individual passes; transition table has no self-loops and terminal states empty.
- [ ] **Step 4: Service (public)** — in `services/applications.ts`:
  - `createApplication`: canonicalize address with `canonicalizeAddress` (400 on invalid); rate limits (create per IP/email); insert `EMAIL_PENDING`; map unique violations on the two open indexes to `createHttpError(409, "An application for this email or wallet is already in progress. Check your email.", { code: "APPLICATION_EXISTS" })`; create pending code row with `hashOtp(env.OTP_HMAC_SECRET, codeId, code)`; `sendApplicationEmail("code", …, idempotencyKey = "application-code/<codeId>")`; event `status_changed` (null→EMAIL_PENDING, actor applicant). Return `{ applicationId }`.
  - `confirmApplicationEmail`: same attempt logic as `services/contacts.ts` verify (atomic attempt increment, expiry, `OTP_*` codes); on success in one tx: code `verified`, application `SUBMITTED`, `email_confirmed_at`, `submitted_at`, `status_token_hash = HMAC(pepper, token)`, event, audit `application.submitted`; then send `status_link` email with `${env.AUTH_URI}/managers/status#${token}`; return `{ statusToken: token }`.
  - `resendApplicationCode`: only in `EMAIL_PENDING`; 60 s cooldown (DB time) → `OTP_COOLDOWN`; supersede pending; new code + email.
  - `getApplicationStatus(token)`: lookup by hash (constant-time irrelevant — lookup by hash equality is fine); missing → `createHttpError(401, "This status link is invalid or has expired.", { code: "APPLICATION_TOKEN_INVALID" })`; return `{ status, submittedAt, applicantType, fullName, latestMessage (last event with message_to_applicant), canReply: status === "ADDITIONAL_INFORMATION_REQUIRED" && no applicant_reply after the latest info request }`.
  - `replyToApplication`: `canReply` else `REPLY_NOT_ALLOWED`; tx: event `applicant_reply`, status `SCREENING`, audit.
- [ ] **Step 5: Routes** — `routes/manager-applications.ts` (public, no session): `POST /`, `POST /:id/confirm-email`, `POST /:id/resend-code`, `GET /status`, `POST /reply` (token from `req.header("x-application-token")`, 401 if absent). Mount at `/v1/manager-applications` in `app.ts`. CSRF: existing `csrfGuard` applies to cookie-less browser mutations only for auth entry paths — add `/v1/manager-applications` POSTs to the Origin-required list when the request has no bearer token (browser form); update `middleware/security.ts` accordingly and its test.
- [ ] **Step 6: Provider** — `sendApplicationEmail` in `providers/resend.ts` beside `sendOtpEmail`, one Resend call, subject/text per kind (plain text, factual copy; approved email says: “Sign in to Bytesac with wallet <shortAddress> on <chain label> to finish.”); errors → for `code` kind 503 `OTP_DELIVERY_FAILED`; for status kinds log with `logger.warn` and do not throw.
- [ ] **Step 7: API client** — add `createApplication`, `confirmApplicationEmail`, `resendApplicationCode`, `getApplicationStatus(token)`, `replyToApplication(token, message)` (token sent as `X-Application-Token`).
- [ ] **Step 8: Tests** (`test/managers/public-flow.test.ts`, real DB, mocked Resend): create→email code captured→confirm→statusToken; status with token OK, without/garbage token → 401 `APPLICATION_TOKEN_INVALID`; duplicate open email → 409 `APPLICATION_EXISTS`; same EOA address on another EVM chain → 409; wrong code ×5 → `OTP_ATTEMPTS_EXCEEDED`; resend cooldown; reply only in `ADDITIONAL_INFORMATION_REQUIRED` (409 otherwise) and only once; rate-limit deny → 429; CSRF: browser POST without Origin → 403; `select app.purge_expired()` removes a 25-h-old `EMAIL_PENDING` app and keeps a `SUBMITTED` one; typed address never creates a user (users count unchanged).
- [ ] **Step 9: Gate + commit** — `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`; commit `feat(api): add public fund manager application flow`.

---

### Task 2: Ops API, roles, wallet-proof grant, CLI

**Files:** create `apps/api/src/services/platform-roles.ts`, `apps/api/src/routes/ops.ts`, `apps/api/test/managers/ops.test.ts`, `apps/api/test/managers/grant.test.ts`; modify `services/applications.ts`, `services/sign-in.ts`, `middleware/auth.ts`, `routes/me.ts`, `packages/validator/src/{me,managers}.ts`, `ops/cli.ts`, `app.ts`, `packages/api-client/src/client.ts`.

**Interfaces — Produces:**
- `requireRole(role: "ops_reviewer" | "ops_admin")` Express middleware (after `requireSession`); `ops_admin` satisfies `ops_reviewer`. Missing → `createHttpError(403, "You don't have access to this area.", { code: "FORBIDDEN" })`.
- `services/applications.ts`: `listApplications({ status?, q?, cursor? })`, `getApplicationDetail(id)`, `transitionApplication(ctx, id, { to, internalNote?, messageToApplicant? })`, `addApplicationNote(ctx, id, note)`, `grantIfProven(tx, { userId, chain, address, method })`.
- `services/platform-roles.ts`: `activeRoles(db, userId)`, `grantRole(ctx|ops, userId, role)`, `revokeRole(ctx, roleRowId)`.
- `GET /v1/me` adds `permissions: string[]`, `platformRoles: string[]`.

- [ ] **Step 1: Grant hook (subtle — exact logic)** in `services/applications.ts`:

```ts
/** Grants create_manager_organization when a proven user owns the submitted wallet of an approved application. Runs inside the caller's transaction. */
export async function grantIfProven(tx: Tx, i: { userId: string; chain: Chain; address: string; method: VerificationMethod; requestId: string }): Promise<void> {
  const family = familyOf(i.chain);
  const [app] = await tx.select().from(managerApplications).where(and(
    eq(managerApplications.status, "SCREENING_APPROVED"),
    isNull(managerApplications.walletProvenAt),
    eq(managerApplications.walletFamily, family),
    eq(managerApplications.walletAddress, i.address),
    // Smart-contract wallets are proven per chain; an ECDSA/ed25519 key proves every chain of its family.
    i.method === "erc1271" || i.method === "erc6492" ? eq(managerApplications.walletChain, i.chain) : sql`true`,
  )).for("update");
  if (!app) return;
  await tx.insert(userPermissions).values({ userId: i.userId, permission: "create_manager_organization", sourceApplicationId: app.id }).onConflictDoNothing();
  await tx.update(managerApplications).set({ userId: i.userId, walletProvenAt: sql`now()`, updatedAt: sql`now()` }).where(eq(managerApplications.id, app.id));
  await tx.insert(applicationEvents).values({ applicationId: app.id, actorType: "system", kind: "permission_granted", requestId: i.requestId });
  await writeAudit(tx, { actorType: "system", action: "permission.granted", entityType: "user", entityId: i.userId, requestId: i.requestId, metadata: { permission: "create_manager_organization", applicationId: app.id } });
}
```

  Call it in `services/sign-in.ts` `finalize` after addresses are confirmed for the user (both sign-in paths, existing owner and new user, and after add-chain insert), passing `{ userId, chain: ch.chain, address: ch.address, method, requestId: input.meta.requestId }`. Skip when owner address is disabled or user not active (those paths already throw before). The `onConflictDoNothing` target is the `user_permissions_active` partial index (use `onConflictDoNothing()` without target if Drizzle cannot target a partial index; verify in Drizzle docs).
- [ ] **Step 2: Approval-time grant** — in `transitionApplication` when `to === "SCREENING_APPROVED"`: in the same tx, `findAddressOwner(tx, app.walletChain, app.walletAddress)`; if owner exists, `status === "active"` and `userStatus === "active"`, call `grantIfProven` with the owner and the verification method of the owner's matching address row (read `verificationMethod` from `walletAddresses` for that chain/address).
- [ ] **Step 3: Transitions** — `transitionApplication`: `SELECT … FOR UPDATE` the application; validate `to ∈ APPLICATION_TRANSITIONS[current]` else `INVALID_TRANSITION`; update status (+ `decided_at/decided_by_user_id` for approve/reject); event with internal note/message; audit `application.status_changed`; after commit send status email for `CONTACTED | ADDITIONAL_INFORMATION_REQUIRED | SCREENING_APPROVED | SCREENING_REJECTED` (idempotencyKey `application-status/<eventId>`). `addApplicationNote`: event `note` + audit. `listApplications`: cursor = base64url of `submitted_at|id`, page 25, order `submitted_at desc, id desc`, `q` matches email/full name/firm name `ILIKE` (parameterized), excludes `EMAIL_PENDING`. `getApplicationDetail`: application + events (asc).
- [ ] **Step 4: Roles** — `requireRole` reads active roles per request (no caching). `platform-roles.ts` grant/revoke with audit (`platform_role.granted/revoked`); revoke refuses when it would leave zero active `ops_admin` (`INVALID_TRANSITION` with message "At least one ops admin must remain.").
- [ ] **Step 5: Routes** — `routes/ops.ts`: `router.use(requireSession)`, rate limit per user; `GET /applications`, `GET /applications/:id`, `POST /applications/:id/transition`, `POST /applications/:id/notes` with `requireRole("ops_reviewer")`; `GET /roles`, `POST /roles` `{ userId, role }`, `DELETE /roles/:id` with `requireRole("ops_admin")`. Mount `/v1/ops`. `me.ts` adds permissions/roles; validator `meResponseSchema` extended.
- [ ] **Step 6: CLI** — `ops:grant-role --user <uuid> --role ops_admin|ops_reviewer --operator <name>` in `ops/cli.ts` + package.json script; audited with `actorType: "ops"`.
- [ ] **Step 7: API client** — ops endpoints + `me` shape.
- [ ] **Step 8: Tests** — `ops.test.ts`: no role → 403 on every ops route; reviewer can list/detail/transition/note, cannot manage roles; admin can grant/revoke; last-admin guard; invalid transition → 409; list excludes `EMAIL_PENDING`, pagination cursor stable, `q` search; status emails triggered for the four statuses (mock assertions); role revoked → next request 403. `grant.test.ts`: approve when EOA owner exists → permission immediately; approve then sign-in with EOA on a different EVM chain → granted; smart wallet (fake RPC valid) proven on another chain → not granted, on same chain → granted; Solana; disabled address/suspended user → never; concurrent `approve` + `sign-in` → exactly one `user_permissions` row; typed address never creates users.
- [ ] **Step 9: Gate + commit** — full api/validator/api-client tests; commit `feat(api): add ops screening, platform roles and wallet-proof permission grant`.

---

### Task 3: Web public pages + Home card

**Files:** create `apps/web/app/managers/apply/page.tsx`, `apps/web/app/managers/status/page.tsx`, `apps/web/components/managers/application-form.tsx`, `apps/web/components/managers/status-view.tsx`, tests `apps/web/test/application-form.test.tsx`, `apps/web/test/status-view.test.tsx`; modify `apps/web/app/(app)/home/page.tsx`, `packages/app-core/src/` (add `APPLICATION_STATUS_LABEL: Record<ApplicationStatus, { label: string; tone: "success"|"warning"|"danger"|"neutral" }>` in a new `application-status.ts`, exported).

- [ ] **Step 1: Apply page** — client component form (shadcn Input/Label/Button, native `<select>` styled or shadcn select if present) validated with `createApplicationRequestSchema.safeParse` for field errors; firm toggle shows firm name; wallet chain select (5 chains) + address; note under address: “We'll ask you to sign in with this wallet after approval. Entering it here doesn't prove ownership.” Submit → `api.createApplication` → code step reusing `OtpInput` + `useCountdown` from `@repo/app-core` → on confirm show “Check your email for your private status link.” with the link also shown once (from `statusToken`). Errors via `describeError`; values preserved.
- [ ] **Step 2: Status page** — reads `window.location.hash.slice(1)`; missing/invalid → friendly invalid state; shows status badge (`APPLICATION_STATUS_LABEL`), submitted date, latest ops message, reply textarea when `canReply` (1–4000 chars) → success state. Never put the token in query strings or logs.
- [ ] **Step 3: Home card** — when `me.permissions` includes `create_manager_organization`: card “You're approved to create a manager organization — coming soon.”; otherwise a subtle link “Become a fund manager” → `/managers/apply`.
- [ ] **Step 4: Tests** — form: firm without firm name shows error; http website error; successful submit shows code step; code step wrong code shows error; status view: invalid token state, info-required shows reply box, reply success; home card visibility.
- [ ] **Step 5: Gate + commit** — `pnpm --filter web lint check-types test build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add fund manager application and status pages`.

---

### Task 4: Web ops area + docs

**Files:** create `apps/web/app/(ops)/ops/layout.tsx`, `apps/web/app/(ops)/ops/applications/page.tsx`, `apps/web/app/(ops)/ops/applications/[id]/page.tsx`, `apps/web/app/(ops)/ops/roles/page.tsx`, `apps/web/components/ops/{applications-table,application-detail,transition-form,roles-manager}.tsx`, tests `apps/web/test/ops-*.test.tsx`; docs.

- [ ] **Step 1: Ops layout** — server component: `getServerMe()`; no session → redirect `/sign-in?reason=expired`; no ops role → render “You don't have access to this area.” (no redirect loop); nav: Applications, Roles (admin only), back to Home.
- [ ] **Step 2: Applications list** — TanStack Query `["ops","applications",status,q,cursor]`; status filter chips, search input (debounced 300 ms with `setTimeout` in effect), table on desktop / cards on mobile, “Load more” cursor.
- [ ] **Step 3: Detail** — applicant fields, wallet (chain + address, “not proven” / “proven” badge from `walletProvenAt`), events timeline (internal notes styled distinctly with “Internal” label), transition form showing **only** `APPLICATION_TRANSITIONS[status]` targets with optional internal note + message to applicant (message required for `ADDITIONAL_INFORMATION_REQUIRED`), note form. On 403 show access-lost state.
- [ ] **Step 4: Roles** — list active roles (user id, role, granted at), grant form (user id + role), revoke with confirm dialog; last-admin error shown inline.
- [ ] **Step 5: Tests** — transition form only offers allowed targets; info-required requires message; 403 shows access-lost; roles grant/revoke calls and last-admin error display.
- [ ] **Step 6: Docs (in place)** — `DECISION-REGISTER.md`: rewrite D-004 to the hybrid wallet-proof rule; add rows for ops surface (web `/ops`, platform roles), applicant communication (email + status link), abuse protection (email confirmation + limits); new `docs/decisions/ADR-007-MANAGER-APPLICATION-SCREENING.md`; `docs/domains/MANAGER-ORGANISATION-ONBOARDING.md` application-flow section rewritten; `ARCHITECTURE.md` §4 Manager application and §7 persistence names; `apps/api/README.md` (ops CLI `grant-role`, Supabase: no new extension).
- [ ] **Step 7: Gate + commit** — `pnpm turbo run lint check-types test build` (Docker up); commit `feat(web): add ops screening area` and `docs: record fund manager application decisions`.

---

## Self-Review Notes

- Spec coverage: §4 → T1 S1–2; §5 → T1 S3, T2 S3; §6 → T2 S1–2; §7 public → T1, ops/me/CLI → T2; §8 → T1 S6, T2 S3; §9 → T3/T4; §10 → constraints + T1/T2 tests; §11 → tests per task; §13 open items stay open (copy/sender domain; re-apply allowed).
- Names consistent: `APPLICATION_TRANSITIONS`, `grantIfProven`, `requireRole`, `sendApplicationEmail`, `APPLICATION_STATUS_LABEL`.
