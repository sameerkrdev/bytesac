# Spec 4 — Members, Roles and Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** four large tasks, tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Owners/admins invite members by wallet and role; invitees prove the wallet and accept; ADMIN/MANAGER members submit their own verification for ops review; one fixed permission matrix guards every organization route; removal/leave keep history; ops_admin transfers ownership; verified orgs show an opt-in public team.

**Architecture:** Extend Spec 3 tables in `@repo/db` (membership lifecycle enum migration, invite columns, member verifications, events, `member` template subject); matrix + lifecycle + schemas in `@repo/validator`; `requirePermission` replaces `requireOwner`; a wallet-proof hook beside Spec 2 `grantIfProven` in the Spec 1 finalize transaction links pending invites; member documents reuse the Spec 3 R2 presigned flow; web adds members/invitation/membership pages and ops member review.

**Tech Stack:** Express 5, Drizzle 0.45 + Postgres, zod (via `@repo/validator`), http-errors, rate-limiter-flexible, Resend, AWS SDK S3 (R2, already installed), Next.js 16, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-members-roles-design.md`

## Global Constraints

- Follow Spec 2/3 patterns exactly: `apps/api/src/services/organizations.ts` (`OwnerCtx`, `requireOwner(conn, userId, orgId, lock)`, `editableVersion`, `resolveTemplate`, `missingRequirements`, `presignDocument`/`confirmDocument` R2 flow, `notifyOwner`), `services/organization-review.ts` (`OpsCtx`, self-review 403 under the org lock, decisions with event + audit in one tx, emails after commit), `services/applications.ts` `grantIfProven` (wallet-proof matching rules), `services/sign-in.ts` finalize call sites of `grantIfProven` (lines ~182 and ~208), `routes/organizations.ts`, `routes/ops.ts`, `providers/resend.ts`, `middleware/rate-limit.ts`, tests in `apps/api/test/organizations/*` + `helpers.ts`, `test/managers/grant.test.ts`.
- **No extra functions**: no one-caller helpers, no wrappers around library calls. Invoke the `ponytail` skill.
- Official docs first for Postgres enum type changes (`ALTER TABLE … ALTER COLUMN … TYPE … USING`), Drizzle migrations/partial indexes, Next 16 App Router.
- Membership statuses exactly: `PENDING_WALLET_VERIFICATION`, `INVITED`, `PENDING_DOCUMENTS`, `UNDER_REVIEW`, `CHANGES_REQUIRED`, `ACTIVE`, `REJECTED`, `REMOVAL_REQUESTED`, `REVOKED`. Verification statuses: `draft`, `in_review`, `changes_required`, `approved`, `rejected`. Template subjects: `individual`, `firm`, `member`.
- Permissions exactly: `org.read`, `org.edit`, `payout.manage`, `members.manage`, `members.manage_admins`, `analytics.read`, `baskets.manage`, with the spec §4 matrix.
- New error code exactly: `INVITE_EXISTS` (409). Reuse `FORBIDDEN`, `INVALID_TRANSITION`, `REQUIREMENTS_INCOMPLETE`, `DOCUMENT_REJECTED`, `VALIDATION_FAILED`, `NOT_FOUND`.
- Invite expiry 14 days, enforced on read/accept (no job). Invites only for `VERIFIED` orgs. Role `OWNER` never invitable, removable or able to leave.
- Member document keys `incoming/members/<membershipId>/<documentId>` → `documents/members/<membershipId>/<documentId>`; same type/size/magic-byte rules as Spec 3.
- Rate limits: invitations 20/h per org; member mutations 60/min per user; member document presign 30/h per membership; ops as Spec 2.
- Invite email/wallet are identifiers only; linking only via Spec 1 wallet proof (EOA/ed25519 any chain of family; ERC-1271/6492 only invited chain); disabled addresses / non-active users never link.
- Member verification details/documents: member (metadata only) and ops only; owners/admins see status only. Public team: opted-in names, role, dates only.
- Runtime DB role keeps no DELETE; history never deleted.
- Web: dark design system, 44 px, status text+icon, lucide only; no mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known flake: Windows vitest worker crash (exit 3221226505) on a random api file — re-run crashed files; not a code failure.

## Review Focus

1. **Invitee proves the wallet while the inviter cancels the invite** → exactly one outcome (either `INVITED` then `REVOKED`, or `REVOKED` and no link); test in Task 1 (concurrent hook + cancel).
2. **ADMIN tries to demote/remove the OWNER or another ADMIN through crafted requests** → 403 (or `REMOVAL_REQUESTED` for ADMIN-on-ADMIN removal) and nothing changes; table-driven test in Task 1.
3. **Member with a pending role upgrade keeps using the app** → keeps the old role's permissions until ops approve; test in Task 2.
4. **Invite opened after 14 days** → shown as expired, cannot be accepted, status `REVOKED`; test in Task 1 (API) and Task 3 (UI).
5. **Spec 3 owner flows after the matrix refactor** → OWNER still edits/submits/manages payout; ADMIN/MANAGER/ANALYST/VIEWER get read-only workspace and 403 on mutations; test in Task 1 (existing Spec 3 suites green + new denials).

---

## File Structure

```
packages/db/src/schema/enums.ts                 membership_status replaced; template_subject; membership_event_kind/actor; verification status enum
packages/db/src/schema/organizations.ts         memberships extended; organization_documents.membership_id; templates subject column
packages/db/src/schema/members.ts               NEW member_verifications, member_verification_documents, membership_events
packages/db/src/schema/index.ts                 export members
packages/db/migrations/0006_members.sql         generated + hand-edited enum/column type changes + data mapping + grants/RLS + member template seed
packages/db/src/testing.ts                      truncate list includes new tables
packages/validator/src/members.ts               NEW matrix, lifecycle, schemas
packages/validator/src/organizations.ts         template subject type; public org team
packages/validator/src/{errors,me,index}.ts     INVITE_EXISTS; me.organizations role/status
apps/api/src/services/members.ts                NEW requirePermission, invites, accept/decline/leave/cancel/remove/role, linkInvitesIfProven, public team rows
apps/api/src/services/member-verifications.ts   NEW member verification + ops review + transfer
apps/api/src/services/organizations.ts          requireOwner → requirePermission; getPublicOrganization adds team; resolveTemplate by subject
apps/api/src/services/payout-wallets.ts         requirePermission("payout.manage")
apps/api/src/services/sign-in.ts                call linkInvitesIfProven beside grantIfProven
apps/api/src/routes/organizations.ts            + members routes
apps/api/src/routes/memberships.ts              NEW invitee/member routes (+ GET /v1/me/invitations mounted in me.ts)
apps/api/src/routes/ops.ts                      + members queue/decision/download, transfer-ownership
apps/api/src/routes/me.ts                       invitations, organizations role/status
apps/api/src/providers/resend.ts                + sendMembershipEmail(kind, …)
apps/api/src/middleware/rate-limit.ts           + limits
apps/api/test/members/*.test.ts                 NEW
packages/api-client/src/client.ts               + endpoints
packages/app-core/src/membership-status.ts      NEW labels + permission helper export
apps/web/components/organization/members.tsx, apps/web/app/(app)/invitations/[mid]/page.tsx, apps/web/app/(app)/organization/membership/[mid]/page.tsx, apps/web/components/members/*
apps/web/app/(ops)/ops/members/page.tsx, [mid]/page.tsx, apps/web/components/ops/{members-table,member-review,transfer-ownership}.tsx
apps/web/app/organizations/[id]/page.tsx        team sections
docs/…                                          ADR-009 + in-place updates
```

---

### Task 1: Data, matrix, lifecycle, invites and member management (API)

**Files:** create `packages/db/src/schema/members.ts`, `packages/validator/src/members.ts`, `packages/validator/src/members.test.ts`, `apps/api/src/services/members.ts`, `apps/api/src/routes/memberships.ts`, `apps/api/test/members/{lifecycle,permissions,link}.test.ts`, `apps/api/test/members/helpers.ts`; modify `packages/db/src/schema/{enums,organizations,index}.ts`, `packages/db/src/testing.ts`, `packages/validator/src/{errors,index,organizations}.ts`, `apps/api/src/services/{organizations,payout-wallets,sign-in}.ts`, `apps/api/src/routes/{organizations,me}.ts`, `apps/api/src/providers/resend.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/app.ts`, `apps/api/test/setup.ts`, `packages/api-client/src/client.ts`; migration `0006_members.sql`.

**Interfaces — Produces:**
- `@repo/validator`: `MEMBERSHIP_STATUSES`, `membershipStatusSchema`, `MembershipStatus`, `ORGANIZATION_PERMISSIONS`, `OrganizationPermission`, `ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly OrganizationPermission[]>>`, `REVIEWED_ROLES = ["ADMIN", "MANAGER"] as const`, `inviteMemberRequestSchema` (`{ walletChain, walletAddress, role (not OWNER), email }`), `changeRoleRequestSchema`, `memberViewSchema`, `invitationViewSchema`, `membershipProfileRequestSchema` (`publicDisplayName` 2–80 | null, `publicTitle` ≤80 | null).
- `services/members.ts`: `requirePermission(conn: DbOrTx, userId: string, orgId: string, permission: OrganizationPermission, lock = false): Promise<{ org: OrganizationRow; membership: MembershipRow }>`, `listMembers(ctx, orgId)`, `inviteMember(ctx, orgId, body)`, `cancelInvite(ctx, orgId, mid)`, `changeRole(ctx, orgId, mid, role)`, `removeMember(ctx, orgId, mid)`, `confirmRemoval(ctx, orgId, mid)`, `cancelRemoval(ctx, orgId, mid)`, `listMyInvitations(userId)`, `acceptInvitation(ctx, mid)`, `declineInvitation(ctx, mid)`, `leaveOrganization(ctx, mid)`, `updateMembershipProfile(ctx, mid, body)`, `linkInvitesIfProven(tx, { userId, chain, address, method, requestId })`, `openMemberVerification(tx, membershipId)` (used by Task 2 too).
- `sendMembershipEmail(kind: "invited" | "accepted" | "verification_changes_required" | "verification_approved" | "verification_rejected" | "removed" | "ownership_transferred", to, data, idempotencyKey)`.

- [ ] **Step 1: Schema** — spec §5 exactly. Replace `membershipStatus` enum values; add `templateSubject` enum and switch `verification_requirement_templates.organization_type` → `subject` (`template_subject`); `organization_documents.membership_id` nullable FK; memberships columns/partial uniques/check as spec; new `members.ts` tables.
- [ ] **Step 2: Migration** — `pnpm --filter @repo/db db:generate --name=members`, then hand-edit the enum/type changes (drizzle cannot map values). Exact SQL shape:

```sql
CREATE TYPE "app"."membership_status_v2" AS ENUM('PENDING_WALLET_VERIFICATION','INVITED','PENDING_DOCUMENTS','UNDER_REVIEW','CHANGES_REQUIRED','ACTIVE','REJECTED','REMOVAL_REQUESTED','REVOKED');
-- drop partial indexes/checks that reference the old status column first (recreate after)
ALTER TABLE "app"."organization_memberships" ALTER COLUMN "status" TYPE "app"."membership_status_v2"
  USING (CASE "status"::text WHEN 'active' THEN 'ACTIVE' WHEN 'revoked' THEN 'REVOKED' END)::"app"."membership_status_v2";
DROP TYPE "app"."membership_status";
ALTER TYPE "app"."membership_status_v2" RENAME TO "membership_status";
CREATE TYPE "app"."template_subject" AS ENUM('individual','firm','member');
ALTER TABLE "app"."verification_requirement_templates" RENAME COLUMN "organization_type" TO "subject";
ALTER TABLE "app"."verification_requirement_templates" ALTER COLUMN "subject" TYPE "app"."template_subject" USING "subject"::text::"app"."template_subject";
```

  Keep the generated snapshot consistent (regenerate after editing the schema so `db:generate` reports no diff). Append grants (SELECT/INSERT/UPDATE) + RLS `api_all` for new tables; seed `member` template row per spec §5. Verify on a fresh DB and on a DB migrated to 0005 with existing OWNER rows (test in Step 9).
- [ ] **Step 3: Validator** — matrix (exact):

```ts
export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly OrganizationPermission[]>> = {
  OWNER: ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage"],
  ADMIN: ["org.read", "members.manage", "analytics.read", "baskets.manage"],
  MANAGER: ["org.read", "analytics.read", "baskets.manage"],
  ANALYST: ["org.read", "analytics.read"],
  VIEWER: ["org.read"],
};
```

  Tests: matrix equals spec §4 table; OWNER not in invitable roles; profile schema accepts null clears; invite schema rejects OWNER.
- [ ] **Step 4: `requirePermission` refactor** — implement in `services/members.ts`: load org (404) and the user's `ACTIVE` membership (optional `FOR UPDATE` on org when `lock`); permission ∉ `ROLE_PERMISSIONS[role]` → 403 `FORBIDDEN` "You don't have access to this organization.". Replace every `requireOwner` call (12 sites) with the mapped permission: org detail → `org.read`; draft/documents/submit/change-request → `org.edit`; payout routes → `payout.manage`. Delete `requireOwner`. `getOrganizationForOwner` renamed `getOrganizationForMember`, returning the same detail (private details included, per spec §2) plus `myRole` and `myPermissions`; `listMyOrganizations` returns open memberships with role/status.
- [ ] **Step 5: Invites + lifecycle** — `inviteMember`: `requirePermission(…, role === "ADMIN" ? "members.manage_admins" : "members.manage", lock=true)`; org must be `VERIFIED` (409 `INVALID_TRANSITION` "Your organization must be verified before inviting members."); canonicalize address; `findAddressOwner` → active address + active user ⇒ `INVITED` with `user_id`, else `PENDING_WALLET_VERIFICATION`; `invite_expires_at = now() + interval '14 days'`; unique violations (open invite index / open membership index) → 409 `INVITE_EXISTS` "This wallet already has an open invitation or membership."; event `invited` + audit; after commit email `invited` to `invited_email`. Expiry helper logic inline in `listMyInvitations`/`acceptInvitation`/`listMembers`: open invites with `invite_expires_at <= now()` → `REVOKED` + event `expired` (single `UPDATE … RETURNING` then events). `acceptInvitation`: membership `FOR UPDATE`, own (`user_id = ctx.userId`), status `INVITED`, not expired; ANALYST/VIEWER → `ACTIVE` (`activated_at`); ADMIN/MANAGER → approved `member_verifications` exists for this user in this org ? `ACTIVE` : `PENDING_DOCUMENTS` + `openMemberVerification`; event `accepted`; email `accepted` to inviter. `declineInvitation` → `REJECTED`. `cancelInvite` (same permission as inviting that role) on `PENDING_WALLET_VERIFICATION|INVITED` → `REVOKED`. `changeRole`, `removeMember`, `confirmRemoval`, `cancelRemoval`, `leaveOrganization`, `updateMembershipProfile` exactly per spec §6/§9 rules (upgrade into `REVIEWED_ROLES` without approved verification → `requested_role` + `openMemberVerification`; OWNER immovable → 409 `INVALID_TRANSITION` "Contact support to transfer ownership first."). All in one tx with `membership_events` + audit.
- [ ] **Step 6: Wallet-proof hook (subtle — exact logic)**:

```ts
/** Links open invites for a wallet the user just proved. Runs inside the Spec 1 finalize transaction. */
export async function linkInvitesIfProven(tx: Tx, i: { userId: string; chain: Chain; address: string; method: VerificationMethod; requestId: string }): Promise<void> {
  const invites = await tx.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.status, "PENDING_WALLET_VERIFICATION"),
    eq(organizationMemberships.invitedWalletFamily, familyOf(i.chain)),
    eq(organizationMemberships.invitedWalletAddress, i.address),
    gt(organizationMemberships.inviteExpiresAt, sql`now()`),
    i.method === "erc1271" || i.method === "erc6492" ? eq(organizationMemberships.invitedWalletChain, i.chain) : sql`true`,
  )).for("update");
  for (const m of invites) {
    const [open] = await tx.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(
      eq(organizationMemberships.organizationId, m.organizationId), eq(organizationMemberships.userId, i.userId),
      notInArray(organizationMemberships.status, ["REJECTED", "REVOKED"])));
    const to = open ? "REVOKED" : "INVITED";
    await tx.update(organizationMemberships).set({ status: to, userId: open ? null : i.userId, updatedAt: sql`now()` }).where(eq(organizationMemberships.id, m.id));
    await tx.insert(membershipEvents).values({ membershipId: m.id, organizationId: m.organizationId, actorType: "system", kind: open ? "cancelled" : "linked", fromStatus: m.status, toStatus: to, reason: open ? "duplicate" : null, requestId: i.requestId });
    await writeAudit(tx, { actorType: "system", action: open ? "membership.invite_revoked" : "membership.linked", entityType: "organization_membership", entityId: m.id, requestId: i.requestId, metadata: { userId: i.userId } });
  }
}
```

  Call it in `services/sign-in.ts` directly after each `grantIfProven` call (same arguments). Callers already reject disabled addresses / non-active users before this point (verify, and keep it that way).
- [ ] **Step 7: Routes** — `routes/organizations.ts` add members routes (spec §10 org table); `routes/memberships.ts` (`requireSession`, member-mutation limit): accept/decline/leave/profile; `GET /v1/me/invitations` in `routes/me.ts`; `/me.organizations` role + status; limits per Global Constraints. Mount `/v1/memberships`.
- [ ] **Step 8: API client** — members/invitations/membership methods + types.
- [ ] **Step 9: Tests** — `permissions.test.ts` table-driven: for each role × each org route (Spec 3 owner routes + members routes) expected allow/deny (Review Focus 2, 5); ADMIN inviting ADMIN → 403; ADMIN remove ADMIN → `REMOVAL_REQUESTED`; OWNER confirm → `REVOKED`; OWNER remove/leave → 409. `lifecycle.test.ts`: invite on non-VERIFIED org → 409; invite existing user → `INVITED`; duplicate → 409 `INVITE_EXISTS`; accept VIEWER → `ACTIVE`; accept MANAGER → `PENDING_DOCUMENTS` + open verification; decline → `REJECTED`; cancel → `REVOKED`; expired (set `invite_expires_at` in the past) → `REVOKED` on read, accept 409 (Review Focus 4); downgrade immediate; upgrade sets `requested_role`, permissions unchanged; leave → `REVOKED`, history rows present; migration mapping: seed a 0005-style OWNER `active` row via raw SQL before running 0006 in a dedicated test DB — or assert `ACTIVE` OWNER rows exist for Spec 3 fixtures after migrate (choose the cheaper correct option; document it). `link.test.ts`: unknown wallet → `PENDING_WALLET_VERIFICATION` → EOA sign-in on another EVM chain links; smart wallet (fake RPC) links only on invited chain; Solana; disabled address / suspended user never link; already-member user → invite `REVOKED` (`duplicate`); concurrent sign-in hook + `cancelInvite` → single consistent outcome (Review Focus 1, deterministic two-transaction pattern from `test/managers/grant.test.ts`); typed address never creates users.
- [ ] **Step 10: Gate + commit** — `pnpm db:up`; `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`; then repo-wide `pnpm turbo run lint check-types test` (web/mobile fixtures for `/me`); commit `feat(api): add organization members, permission matrix and invitations`.

---

### Task 2: Member verification, ops review, ownership transfer, public team

**Files:** create `apps/api/src/services/member-verifications.ts`, `apps/api/test/members/{verification,transfer,public-team}.test.ts`; modify `services/members.ts`, `services/organizations.ts` (`getPublicOrganization`, `resolveTemplate` by subject), `routes/memberships.ts`, `routes/ops.ts`, `providers/resend.ts`, `packages/validator/src/{members,organizations}.ts`, `packages/api-client/src/client.ts`.

**Interfaces — Consumes:** Task 1 `requirePermission`, `openMemberVerification`, tables; Spec 3 `resolveTemplate`, catalog, R2 flow (`presignDocument`/`confirmDocument` code paths), `OpsCtx`.
**Produces:** `getMemberVerification(ctx, mid)`, `updateMemberVerification(ctx, mid, { details })`, `presignMemberDocument(ctx, mid, body)`, `confirmMemberDocument(ctx, mid, docId)`, `unlinkMemberDocument(ctx, mid, docId)`, `submitMemberVerification(ctx, mid)`, `listMembersForReview(q)`, `getMemberForReview(mid)`, `decideMemberVerification(ctx, mid, body)`, `memberDocumentDownloadUrl(ctx, mid, docId)`, `transferOwnership(ctx, orgId, { targetMembershipId, reason })`; public org `team`.

- [ ] **Step 1: Template subject** — `resolveTemplate(conn, subject: TemplateSubject, jurisdiction: string | null)`; org callers pass org type; member callers pass `"member"` and the org's jurisdiction. `missingRequirements` for members: fields from `details` + documents linked to the verification.
- [ ] **Step 2: Member verification services** — own membership only (`user_id = ctx.userId`), verification editable in `draft|changes_required`; `details` merge with `null` clears (catalog keys of the `member` template only; reuse the Spec 3 catalog validation path); documents: reuse the Spec 3 presign/confirm code by extracting nothing new — call the same S3 commands with member keys (`incoming/members/<mid>/<docId>` → `documents/members/<mid>/<docId>`), set `organization_documents.membership_id`, link via `member_verification_documents` (soft unlink `removed_at`), same `DOCUMENT_REJECTED` rules; if the Spec 3 confirm body would be duplicated verbatim, lift it into one exported function taking `{ docRow, finalKey, link: (tx) => Promise<void> }` used by both (two callers → allowed). `submitMemberVerification`: completeness → 422 `REQUIREMENTS_INCOMPLETE`; verification `in_review`; membership `PENDING_DOCUMENTS|CHANGES_REQUIRED → UNDER_REVIEW` (upgrades: membership stays `ACTIVE`); events + audit.
- [ ] **Step 3: Ops review** — queue: memberships `UNDER_REVIEW` plus `ACTIVE` with `requested_role` and verification `in_review`; cursor as Spec 3; detail: membership, org summary (public name, status), verification details, documents metadata, events. `decideMemberVerification` (membership `FOR UPDATE`; self-review 403 if the ops user has any membership in that org) exactly per spec §7 including upgrade branches; message required for `changes_required` (validator refine); emails `verification_*` after commit. Download → 302 presigned GET attachment 300 s, audited.
- [ ] **Step 4: Transfer (exact core)**:

```ts
export async function transferOwnership(ctx: OpsCtx, orgId: string, i: { targetMembershipId: string; reason: string }): Promise<void> {
  const emails = await db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
    if (!org) throw createHttpError(404, "Organization not found", { code: "NOT_FOUND" });
    // self-review: ctx.userId has any membership in orgId → 403 FORBIDDEN
    const [owner] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.role, "OWNER"), eq(organizationMemberships.status, "ACTIVE"))).for("update");
    const [target] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, i.targetMembershipId), eq(organizationMemberships.organizationId, orgId))).for("update");
    if (!owner || !target || target.id === owner.id || target.status !== "ACTIVE") throw createHttpError(409, "Pick an active member of this organization.", { code: "INVALID_TRANSITION" });
    // target must have an approved member_verifications row → else 409 INVALID_TRANSITION "This member must complete verification first."
    await tx.update(organizationMemberships).set({ role: "ADMIN", updatedAt: sql`now()` }).where(eq(organizationMemberships.id, owner.id)); // old owner first: one-OWNER partial unique
    await tx.update(organizationMemberships).set({ role: "OWNER", requestedRole: null, updatedAt: sql`now()` }).where(eq(organizationMemberships.id, target.id));
    // membership_events ownership_transferred on both (from_role/to_role, reason), audit organization.ownership_transferred { reason, from, to }
    return [owner.userId!, target.userId!];
  });
  // after commit: sendMembershipEmail("ownership_transferred", …) to both users' verified email contacts
}
```

  Route `POST /v1/ops/organizations/:id/transfer-ownership` with `requireRole("ops_admin")`; body `{ targetMembershipId: uuid, reason: 10–1000 chars }`.
- [ ] **Step 5: Public team** — `getPublicOrganization` adds `team` per spec §9 (ordered: role rank OWNER→VIEWER, then name; former by `to` desc); validator `publicOrganizationSchema` extended.
- [ ] **Step 6: API client + emails** — methods for all Task 2 routes; `sendMembershipEmail` kinds wired (plain factual text; recipients: member's verified email contact; `invited` uses `invited_email`).
- [ ] **Step 7: Tests** — `verification.test.ts`: accept MANAGER → verification draft; incomplete submit → 422 exact missing; upload/confirm member doc (mock R2) → linked, owner of org cannot read member details (403/absent); submit → `UNDER_REVIEW`; ops changes_required (no message → 400) → `CHANGES_REQUIRED` → resubmit → approve → `ACTIVE`; reject → `REJECTED`; ops member of org → 403; upgrade: VIEWER → MANAGER request keeps VIEWER permissions (Review Focus 3) → approve switches role; download 302 attachment. `transfer.test.ts`: reviewer 403; admin OK; target without approved verification → 409; exactly one OWNER after, old owner `ADMIN`; events on both; concurrent transfers → one wins, one 409/serialized. `public-team.test.ts`: only opted-in `ACTIVE` in current, `REVOKED` with `activated_at` in former with dates, never ids/wallets/emails; non-VERIFIED org 404.
- [ ] **Step 8: Gate + commit** — full api/validator/api-client gate; commit `feat(api): add member verification, ops member review, ownership transfer and public team`.

---

### Task 3: Web members, invitations, member page, public team

**Files:** create `apps/web/components/organization/members.tsx`, `apps/web/app/(app)/invitations/[mid]/page.tsx`, `apps/web/app/(app)/organization/membership/[mid]/page.tsx`, `apps/web/components/members/{invitation,membership-profile,member-verification}.tsx`, `packages/app-core/src/membership-status.ts`, tests `apps/web/test/members-*.test.tsx`; modify `apps/web/app/(app)/organization/page.tsx` (role-aware), `apps/web/app/(app)/home/page.tsx`, `apps/web/app/organizations/[id]/page.tsx`, `packages/app-core/src/{index,error-copy}.ts`.

- [ ] **Step 1: app-core** — `MEMBERSHIP_STATUS_LABEL`, `MEMBER_VERIFICATION_STATUS_LABEL` (label + tone), `INVITE_EXISTS` copy; re-export `ROLE_PERMISSIONS` usage via `@repo/validator` (no duplicate matrix).
- [ ] **Step 2: Workspace by role** — `/organization` uses `myPermissions`: editors (OWNER) unchanged; others see read-only fields/documents metadata/payout status; OWNER sees "To transfer ownership, contact support."
- [ ] **Step 3: Members section** — visible with `org.read`; list (public name or "No public name", role, status badge, verification status for reviewed roles); with `members.manage`: invite form (chain select, address, role select excluding OWNER and excluding ADMIN unless `members.manage_admins`, email) with schema validation and `INVITE_EXISTS` inline; per-row actions (cancel invite, change role, remove); removal requests with OWNER confirm/cancel; confirm dialogs for destructive actions.
- [ ] **Step 4: Invitations** — Home card per `GET /v1/me/invitations` item → `/invitations/[mid]`: org public name, role, inviter-free copy, expiry date; ADMIN/MANAGER note "You'll be asked to verify your identity before joining."; accept → redirects to membership page (reviewed roles) or `/organization`; decline; expired/revoked state.
- [ ] **Step 5: Membership page** — `/organization/membership/[mid]`: public name/title form (null clears), verification section reusing Spec 3 `organization-fields` / `organization-documents` components with member endpoints (pass endpoint functions as props if the components hard-code org calls; smallest change), submit checklist, status + ops message, leave organization (confirm; hidden for OWNER).
- [ ] **Step 6: Public team** — `/organizations/[id]` adds Current team and Former members lists (role label, dates); empty sections hidden.
- [ ] **Step 7: Tests** — members section gating per role; invite validation + `INVITE_EXISTS`; remove confirm; OWNER removal-request confirm; invitation accept (both role classes) / decline / expired; membership page profile save + verification submit + changes-required message; public team rendering; read-only workspace for VIEWER.
- [ ] **Step 8: Gate + commit** — `pnpm --filter web lint check-types test build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add organization members, invitations and member verification`.

---

### Task 4: Web ops members + transfer, docs

**Files:** create `apps/web/app/(ops)/ops/members/page.tsx`, `apps/web/app/(ops)/ops/members/[mid]/page.tsx`, `apps/web/components/ops/{members-table,member-review,transfer-ownership}.tsx`, tests `apps/web/test/ops-member-*.test.tsx`; modify `apps/web/app/(ops)/ops/layout.tsx` (nav "Members"), `apps/web/components/ops/organization-review.tsx` (transfer button for ops_admin); docs.

- [ ] **Step 1: Queue** — table/cards like `organizations-table.tsx`; columns org name, member public name or "—", role / requested role, status, submitted.
- [ ] **Step 2: Review** — membership + org summary, verification details (catalog labels), documents with Download, events timeline (internal notes labelled), decision form (approve / changes required with required message / reject, internal note), access-lost state on 403.
- [ ] **Step 3: Transfer dialog** — on `/ops/organizations/[id]` for `ops_admin` only (from `me.platformRoles`): select target among active members with approved verification (from ops org detail — extend its API response with memberships if missing, in this task's API touch: `getOrganizationForReview` adds `members: { id, role, status, publicDisplayName, verificationApproved }[]`), reason textarea (10–1000), confirm; errors inline.
- [ ] **Step 4: Tests** — decision form requires message for changes; transfer dialog hidden for reviewer, submits for admin, shows 409 inline; queue renders both new and upgrade entries.
- [ ] **Step 5: Docs (in place)** — new `docs/decisions/ADR-009-ORGANIZATION-MEMBERS.md` (spec §2 decisions + consequences); `DECISION-REGISTER.md`: rewrite D-005 membership part; add rows for permission matrix, member verification for reviewed roles, ops-only ownership transfer, public team opt-in, invite linking by wallet proof; `docs/domains/MANAGER-ORGANISATION-ONBOARDING.md` "Members and roles" rewritten to implemented behavior; `docs/domains/FUND-MANAGER-FEATURES.md` roles section aligned; `ARCHITECTURE.md` §4 + §7 (`member_verifications`, `member_verification_documents`, `membership_events`); `apps/api/README.md` (no new env; ownership transfer is an ops action); `docs/superpowers/HANDOFF.md` §2 Spec 4 row + §5.
- [ ] **Step 6: Gate + commit** — `pnpm db:up`; `pnpm turbo run lint check-types test build`; commits `feat(web): add ops member review and ownership transfer` and `docs: record organization members decisions`.

---

## Self-Review Notes

- Spec coverage: §4 → T1 S3–S4; §5 → T1 S1–S2; §6 → T1 S5–S6; §7 → T2 S1–S3; §8 → T2 S4, T4 S3; §9 → T2 S5, T3 S6; §10 → T1 S7, T2; §11 → T1 S5, T2 S6; §12 → T3/T4; §13 → constraints + tests; §14 → per-task tests; §16 stays open.
- Names consistent: `ROLE_PERMISSIONS`, `requirePermission`, `linkInvitesIfProven`, `openMemberVerification`, `transferOwnership`, `sendMembershipEmail`, `MEMBERSHIP_STATUS_LABEL`.
- Task 4 Step 3 touches the API (`getOrganizationForReview` members list) — small, owned by implementer #2 with a test in `apps/api/test/organizations/review.test.ts`.
