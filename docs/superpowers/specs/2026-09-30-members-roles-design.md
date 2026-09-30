# Spec 4 — Organization Members, Roles and Permissions (Design)

- **Date:** 2026-09-30
- **Status:** Approved in conversation (2026-09-30); written spec pending user review
- **Series:** Spec 4 of 4 — (1) Foundation + user auth ✅, (2) Manager application + screening ✅, (3) Organization onboarding ✅, (4) Members/roles
- **Builds on:** Spec 1 (wallet proof, sign-in/add-chain finalize), Spec 2 (grant-on-proof hook pattern, `/ops`, platform roles, self-review block), Spec 3 (`organizations`, `organization_memberships`, requirement templates, R2 presigned documents, public profile).
- **Sources:** `docs/source/Fund-Manager-&-Organisation-Onboarding-Flow.txt` §25–§30, §35, §39; `docs/source/Fund-Manager-Detailed-Features.txt` §10–§12; D-005.

## 1. Intent

An organization's OWNER and ADMINs invite people by wallet and role. Invitees prove the wallet with the Spec 1 signature flow and accept; ADMIN/MANAGER members also submit their own verification (fields + documents) for platform review. Permissions come from one fixed role matrix. Members can be removed (never deleted) and can leave. Ownership transfer is done only by platform ops on request through support. Verified organizations can show a public team with opt-in display names, including former members.

**Success criteria**
1. A typed wallet never links, creates or activates anyone; linking happens only through Spec 1 wallet proof.
2. Every organization route checks the acting user's permission from `ROLE_PERMISSIONS` server-side.
3. ADMIN/MANAGER memberships become `ACTIVE` only after ops approve the member's own verification; ANALYST/VIEWER become `ACTIVE` on acceptance.
4. The organization always has exactly one `OWNER`; transfer is an audited `ops_admin` action.
5. Membership history is never deleted; public team shows only opted-in names and roles.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Scope | Baskets-related member rules (manager assignment, basket state on manager removal, investor notifications, source §31–§38) deferred to the basket spec. |
| Member KYC | Member provides own fields and documents (owner never handles them); ops review. |
| Permissions | Fixed `ROLE_PERMISSIONS` matrix in `@repo/validator`, shared by API and web; configurable later if needed. |
| Ops review | Required for ADMIN and MANAGER; ANALYST/VIEWER need wallet proof + acceptance only. |
| Ownership transfer | Not self-service: owner contacts support; `ops_admin` performs it in `/ops`. |
| Public team | Opt-in `public_display_name` (+ optional title) per membership; current and former members on verified orgs. |
| Pending users | No pending user rows (Spec 2 hybrid rule): invites to unknown wallets wait for wallet proof. |
| `APPROVED` state | Not stored: ops approval sets `ACTIVE` directly (as Spec 3). |
| Invite eligibility | Only `VERIFIED` organizations can invite. |
| Private org details | Readable by every active member (`org.read`); documents remain ops-only downloads. |
| Invite expiry | 14 days (checked on read/accept; no job). |
| `REMOVAL_REQUESTED` | Used when an ADMIN asks to remove another ADMIN; OWNER confirms or cancels. |
| After transfer | Previous owner becomes `ADMIN`. |

## 3. Out of scope

Basket manager assignments and notifications, per-organization permission overrides, owner-initiated transfer, mobile screens, in-app notification center, member document retention purge.

## 4. Permission matrix (`@repo/validator`)

`ORGANIZATION_PERMISSIONS = ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage"] as const`

| Permission | OWNER | ADMIN | MANAGER | ANALYST | VIEWER |
|---|---|---|---|---|---|
| `org.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.edit` (draft, change requests, submit) | ✓ | | | | |
| `payout.manage` | ✓ | | | | |
| `members.manage` (MANAGER/ANALYST/VIEWER) | ✓ | ✓ | | | |
| `members.manage_admins` (ADMIN) | ✓ | | | | |
| `analytics.read` (future) | ✓ | ✓ | ✓ | ✓ | |
| `baskets.manage` (future) | ✓ | ✓ | ✓ | | |

- API: `requirePermission(conn, userId, orgId, permission)` replaces Spec 3's `requireOwner` (all Spec 3 owner routes map to `org.edit` or `payout.manage`; `GET /v1/organizations/:id` maps to `org.read`). Only `ACTIVE` memberships grant permissions. Missing → 403 `FORBIDDEN`; unknown org → 404.
- Nobody can invite, change, or remove an `OWNER` via member routes.
- Web hides controls using the same map; server remains authoritative.

## 5. Data model changes (`@repo/db`)

- **`organization_memberships`** (Spec 3 table, extended):
  - `status` enum replaced by `membership_status`: `PENDING_WALLET_VERIFICATION`, `INVITED`, `PENDING_DOCUMENTS`, `UNDER_REVIEW`, `CHANGES_REQUIRED`, `ACTIVE`, `REJECTED`, `REMOVAL_REQUESTED`, `REVOKED`. Data migration: `active → ACTIVE`, `revoked → REVOKED`.
  - `user_id` becomes nullable (null while `PENDING_WALLET_VERIFICATION`); new `invited_wallet_chain`, `invited_wallet_family`, `invited_wallet_address` (canonical), `invited_email` (lowercased, unverified, notification only), `invited_by_user_id`, `invite_expires_at`, `requested_role` (nullable), `removal_requested_by_user_id`, `public_display_name` (2–80, nullable), `public_title` (≤80, nullable), `activated_at` (first time `ACTIVE`), `decided_by_user_id`, `updated_at`.
  - Partial uniques: one open membership (status not in `REJECTED`,`REVOKED`) per `(organization_id, user_id)` where `user_id is not null`; one open invite per `(organization_id, invited_wallet_family, invited_wallet_address)` where status in (`PENDING_WALLET_VERIFICATION`,`INVITED`); exactly one `OWNER` with status `ACTIVE` per org (`(organization_id)` where `role='OWNER' and status='ACTIVE'`).
  - Checks: `user_id is not null or status in ('PENDING_WALLET_VERIFICATION','REVOKED')`.
- **`member_verifications`**: `id`, `membership_id`, `status` (`draft`,`in_review`,`changes_required`,`approved`,`rejected`), `details` jsonb, `submitted_at`, `decided_at`, `decided_by_user_id`, `created_at`, `updated_at`. One open (draft/in_review/changes_required) per membership.
- **`member_verification_documents`**: `id`, `verification_id`, `document_id` (→ `organization_documents`, reused with nullable `membership_id` column added there; `organization_id` kept), `created_at`, `removed_at` (soft unlink).
- **`verification_requirement_templates`**: `organization_type` column widened to a `template_subject` enum (`individual`,`firm`,`member`); seed row `member`: fields `legalName, dateOfBirth, residentialAddress, professionalHistory`; documents `government_id, proof_of_address`.
- **`membership_events`** (append-only): `id`, `membership_id`, `organization_id`, `actor_type` (`member`,`org`,`ops`,`system`), `actor_user_id`, `kind` (`invited`,`linked`,`accepted`,`declined`,`cancelled`,`expired`,`verification_submitted`,`verification_decided`,`role_changed`,`role_requested`,`removal_requested`,`removal_cancelled`,`removed`,`left`,`ownership_transferred`,`profile_updated`), `from_status`, `to_status`, `from_role`, `to_role`, `decision`, `message_to_member`, `internal_note`, `reason`, `request_id`, `created_at`.
- Grants/RLS as Spec 3; runtime role no DELETE.

## 6. Membership lifecycle (`MEMBERSHIP_TRANSITIONS`)

```
invite, wallet has no active owner user   → PENDING_WALLET_VERIFICATION
invite, wallet owned by an active user    → INVITED (user_id set)
PENDING_WALLET_VERIFICATION ──wallet proven (sign-in / add-chain hook)──▶ INVITED
INVITED ──accept── ANALYST|VIEWER ─▶ ACTIVE
               └── ADMIN|MANAGER ─▶ PENDING_DOCUMENTS (or ACTIVE if the user already has an approved member verification in this org)
PENDING_DOCUMENTS ──member submits verification──▶ UNDER_REVIEW
UNDER_REVIEW ──ops──▶ ACTIVE | CHANGES_REQUIRED (message required) | REJECTED
CHANGES_REQUIRED ──member resubmits──▶ UNDER_REVIEW
INVITED | PENDING_* ──invitee declines──▶ REJECTED
PENDING_WALLET_VERIFICATION | INVITED ──inviter cancels, or expired on read/accept──▶ REVOKED
ACTIVE (non-owner) ──remove (per matrix) or member leaves──▶ REVOKED
ACTIVE ADMIN ──another ADMIN requests removal──▶ REMOVAL_REQUESTED ──OWNER confirms──▶ REVOKED ; ──OWNER cancels──▶ ACTIVE
```
- Wallet-proof hook (in the Spec 1 finalize transaction, same matching rules as Spec 2 `grantIfProven`): lock open `PENDING_WALLET_VERIFICATION` invites by wallet family + address; EOA/ed25519 proof matches any chain of the family, ERC-1271/6492 only the invited chain; set `user_id`, status `INVITED`, event `linked`. Disabled addresses / non-active users never link. If the user already has an open membership in that org, the invite becomes `REVOKED` (event reason `duplicate`).
- Invite: allowed only when the org is `VERIFIED`; inviter needs `members.manage` (or `members.manage_admins` for role `ADMIN`); role `OWNER` not invitable; email sent to `invited_email` with the organization's public name and a sign-in link.
- Expiry: `invite_expires_at = created + 14 days`; any read or accept of an expired open invite first moves it to `REVOKED` (event `expired`).
- Role change on `ACTIVE`: downgrade (or change within ANALYST/VIEWER, or within ADMIN/MANAGER when an approved verification exists) applies immediately (`role_changed`); upgrade from ANALYST/VIEWER to ADMIN/MANAGER without an approved member verification sets `requested_role` (`role_requested`), keeps the current role, and opens a verification; ops approval then sets `role = requested_role`. Changing to/from `ADMIN` requires `members.manage_admins`.
- OWNER cannot be removed and cannot leave (409 `INVALID_TRANSITION` "Contact support to transfer ownership first.").
- All transitions lock the membership row (`FOR UPDATE`); invalid → 409 `INVALID_TRANSITION`; every change writes `membership_events` + audit in one transaction.

## 7. Member verification

- Opened automatically when a membership enters `PENDING_DOCUMENTS` or a role upgrade is requested.
- Member edits `details` (catalog keys from the `member` template; `null` clears a key, as Spec 3), uploads documents through the Spec 3 presigned flow with keys `incoming/members/<membershipId>/<documentId>` → `documents/members/<membershipId>/<documentId>`, then submits (completeness check → 422 `REQUIREMENTS_INCOMPLETE`).
- Visibility: member sees own details and document metadata; ops see all and download (attachment, 300 s); organization owner/admins see only the verification status.
- Ops decision under the membership lock: `approved` → verification `approved`, membership `ACTIVE` (or role switch for an upgrade); `changes_required` (message required) → membership `CHANGES_REQUIRED` (or stays `ACTIVE` for an upgrade with the verification `changes_required`); `rejected` → membership `REJECTED` (upgrade: `requested_role` cleared, stays `ACTIVE`). Self-review blocked for ops who are members of the org.
- The OWNER's own verification is covered by organization verification.

## 8. Ownership transfer (ops only)

- `POST /v1/ops/organizations/:id/transfer-ownership` `{ targetMembershipId, reason }` — `ops_admin` only; self-review blocked. Target must be `ACTIVE` in the same org with an approved member verification (ADMIN/MANAGER path). One transaction (org row locked): current owner → `ADMIN`, target → `OWNER` (update old first to respect the one-OWNER partial unique), events `ownership_transferred` on both, audit with reason, emails to both after commit.
- Owner UI shows "To transfer ownership, contact support."

## 9. Public team

- Public organization response (Spec 3 endpoint) adds `team: { current: { displayName, title, role }[], former: { displayName, title, role, from, to }[] }` from memberships with `public_display_name` set: current = `ACTIVE`; former = `REVOKED` with `activated_at` set. Never wallets, emails, user ids.
- Member sets name/title via `PATCH /v1/memberships/:mid/profile` (own membership, any non-terminal status; takes effect publicly once `ACTIVE`).

## 10. API

**Org members** (session; permissions per §4)
| Method & path | Permission |
|---|---|
| `GET /v1/organizations/:id/members` | `org.read` (invite wallet/email visible only with `members.manage`) |
| `POST /v1/organizations/:id/members/invitations` `{ walletChain, walletAddress, role, email }` | `members.manage` / `members.manage_admins` for ADMIN |
| `POST /v1/organizations/:id/members/:mid/cancel` | same as invite for that role |
| `POST /v1/organizations/:id/members/:mid/role` `{ role }` | per §6 |
| `POST /v1/organizations/:id/members/:mid/remove` | `members.manage` (non-admin targets) / `members.manage_admins`; ADMIN on ADMIN → `REMOVAL_REQUESTED` |
| `POST /v1/organizations/:id/members/:mid/removal/confirm`, `/removal/cancel` | OWNER |

**Invitee / member** (own membership only)
| Method & path | Purpose |
|---|---|
| `GET /v1/me/invitations` | Open `INVITED` memberships for the user (expired → revoked on read). |
| `POST /v1/memberships/:mid/accept`, `/decline`, `/leave` | Lifecycle. |
| `PATCH /v1/memberships/:mid/profile` `{ publicDisplayName?, publicTitle? }` | Public name. |
| `GET /v1/memberships/:mid/verification`, `PATCH …/verification` `{ details }`, `POST …/verification/documents`, `POST …/verification/documents/:docId/confirm`, `DELETE …/verification/documents/:docId`, `POST …/verification/submit` | Member verification. |

**Ops** (session + `ops_reviewer`; transfer `ops_admin`)
| Method & path | Purpose |
|---|---|
| `GET /v1/ops/members?status=&cursor=` | Queue (default `UNDER_REVIEW` + open upgrade verifications). |
| `GET /v1/ops/members/:mid` | Membership, org summary, verification details, documents, events. |
| `POST /v1/ops/members/:mid/decision` `{ decision, messageToMember?, internalNote? }` | §7. |
| `GET /v1/ops/members/:mid/documents/:docId/download` | 302 presigned GET. |
| `POST /v1/ops/organizations/:id/transfer-ownership` | §8. |

**Existing:** `/me.organizations` entries carry `role` and `status` for open memberships; public organization endpoint adds `team`.

**Errors:** reuse `FORBIDDEN`, `INVALID_TRANSITION`, `REQUIREMENTS_INCOMPLETE`, `DOCUMENT_REJECTED`, `VALIDATION_FAILED`, `NOT_FOUND`; new `INVITE_EXISTS` (409) for a duplicate open invite / open membership.

**Rate limits:** invitations 20/h per org; member mutations 60/min per user; verification document presign 30/h per membership.

## 11. Emails (Resend, idempotency key per event)

Invitation (to `invited_email`), invitation accepted (to inviter), verification changes required / approved / rejected (to member's verified email contact, else skipped), removed (to member), ownership transferred (to both). Failures logged, never roll back.

## 12. Web

- `/organization` gains **Members** (permission-gated): list with role, status badge, public name; invite form (chain, address, role, email); role change; remove / cancel invite; removal requests (OWNER confirm/cancel); "Contact support to transfer ownership" note for OWNER.
- Home: card per pending invitation → `/invitations/[mid]` (org public name, role, accept/decline; ADMIN/MANAGER explains the verification step).
- `/organization/membership/[mid]`: member's own page — public name/title, verification fields and documents (reusing Spec 3 components), submit, status/message; leave organization.
- `/organization` for non-owner members: read-only workspace per `org.read`.
- Ops: `/ops/members` queue + `/ops/members/[mid]` review (details, documents, decision form); "Transfer ownership" dialog on `/ops/organizations/[id]` (ops_admin only, target select, reason required).
- Public profile: Current team / Former members sections.

## 13. Security & privacy

- Permission checks server-side on every route; only `ACTIVE` memberships grant permissions; losing a role is effective next request.
- Invite wallet/email are identifiers only; linking only via Spec 1 proof with EOA vs smart-wallet chain rules.
- Member verification details/documents visible only to the member (metadata) and ops.
- Self-review blocked for ops who have any membership in the organization.
- Exactly-one-OWNER enforced by partial unique index; transfer ops_admin only, audited with reason.
- History never deleted; every change audited with request id.

## 14. Testing

- **Unit:** `ROLE_PERMISSIONS` expectations per role; `MEMBERSHIP_TRANSITIONS` valid/invalid; template subject resolution for `member`.
- **Integration:** invite existing user → `INVITED`; invite unknown wallet → `PENDING_WALLET_VERIFICATION` → sign-in with EOA on another EVM chain links; smart wallet links only on invited chain; Solana; disabled address / suspended user never link; concurrent hook + cancel → consistent single outcome; accept ANALYST → `ACTIVE`; accept MANAGER → verification loop → ops approve → `ACTIVE`; changes required + resubmit; reject; role upgrade path keeps old role until approval; ADMIN cannot manage ADMIN/OWNER; ADMIN remove ADMIN → `REMOVAL_REQUESTED` → OWNER confirm; OWNER cannot leave/be removed; expiry on read; duplicate invite → 409 `INVITE_EXISTS`; every permission denied for each lower role on each org route (table-driven); Spec 3 owner routes still work and now honor the matrix; transfer: reviewer 403, admin OK, exactly one OWNER, old owner ADMIN; public team shows only opted-in names, former members with dates, no private fields; data migration maps existing `active` OWNER rows to `ACTIVE`.
- **Web:** members section (gating by role, invite form validation, remove/removal request), invitation accept/decline, member verification page, ops member review, transfer dialog, public team sections.

## 15. Execution shape

Four large tasks, one review at the end (same model as Specs 2–3): (1) DB migration incl. status mapping + validator (matrix, lifecycle) + `requirePermission` refactor of Spec 3 routes + invite/accept/decline/cancel/remove/leave/role API + wallet-proof hook; (2) member verification API + ops review + transfer + public team + emails + `/me`; (3) web members section, invitations, member page, read-only workspace, Home cards, public team; (4) web ops members + transfer dialog + docs (ADR-009, decision register, domain/architecture docs, HANDOFF).

## 16. Open items

- Basket manager assignment/notification rules (basket spec).
- Member document retention period (compliance).
- Whether per-organization permission overrides are ever needed.
