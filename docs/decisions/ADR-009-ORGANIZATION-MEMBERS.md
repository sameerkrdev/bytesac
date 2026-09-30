# ADR-009: Organization members, roles, permissions and ownership transfer

- **Status:** APPROVED
- **Date:** 2026-09-30
- **Owners:** Backend / Platform
- **Related:** D-005, D-038, D-042, D-048, D-049, D-050, D-051, D-052; ADR-004, ADR-007, ADR-008; `docs/superpowers/specs/2026-09-30-members-roles-design.md`

## Context
After organization verification (ADR-008) the `OWNER` must be able to bring in colleagues with scoped authority. Invitations name a wallet that may not belong to any Bytesac user yet; typing an address must never link, create or activate anyone. Some roles act on behalf of the organization and need their own identity verification; the organization must always have exactly one owner; history must survive removal.

## Decision
| Topic | Decision |
|---|---|
| Scope | Invitations, roles, permissions, member verification, removal and leaving, ownership transfer and the public team. Basket manager assignments, basket state when a manager leaves and investor notifications are deferred to the basket spec (source §31 to §38). |
| Permissions | One fixed matrix, `ROLE_PERMISSIONS` in `@repo/validator`, shared by the API and the web app (permissions `org.read`, `org.edit`, `payout.manage`, `members.manage`, `members.manage_admins`, `analytics.read`, `baskets.manage`). Only an `ACTIVE` membership grants permissions; `requirePermission` replaces the Spec 3 owner check on every organization route, and losing a role is effective on the next request. The matrix is not configurable per organization in release 1. |
| Invitations | Only `VERIFIED` organizations invite, by wallet chain and address plus role and email (an identifier for notification only). The role `OWNER` is never invitable; inviting an `ADMIN` needs `members.manage_admins`. Invites last 14 days, enforced on read and accept (no job); an expired open invite moves to `REVOKED`. |
| Invite linking | A wallet with no active owning user leaves the invite `PENDING_WALLET_VERIFICATION`; it becomes `INVITED` only when the wallet is proven through the Spec 1 sign-in or add-chain transaction (same matching rules as the Spec 2 grant: EOA and ed25519 proof matches any chain of the family, ERC-1271/6492 only the invited chain; disabled addresses and non-active users never link). A wallet already owned by an active user makes the invite `INVITED` at once. A typed address never creates or links a user. |
| Lifecycle | One transition table, `MEMBERSHIP_TRANSITIONS`: `PENDING_WALLET_VERIFICATION`, `INVITED`, `PENDING_DOCUMENTS`, `UNDER_REVIEW`, `CHANGES_REQUIRED`, `ACTIVE`, `REJECTED`, `REMOVAL_REQUESTED`, `REVOKED`. There is no stored `APPROVED`: ops approval sets `ACTIVE`. Every transition locks the membership row, writes a `membership_events` row and an audit row in one transaction; history is never deleted. |
| Reviewed roles | `ADMIN` and `MANAGER` become `ACTIVE` only after ops approve the member's own verification (fields and documents from the `member` template, private to the member and ops; the organization sees only the status). `ANALYST` and `VIEWER` become `ACTIVE` on acceptance. A user whose verification is already approved in that organization skips the review. Upgrading an `ANALYST`/`VIEWER` to a reviewed role keeps the old role and its permissions in `requested_role` until ops approve. |
| Removal | `members.manage` removes non-admin members; removing an `ADMIN` needs `members.manage_admins`. An `ADMIN` asking to remove another `ADMIN` creates `REMOVAL_REQUESTED`, which the `OWNER` confirms or cancels. Nobody can remove, demote or cancel the `OWNER` through member routes (an `ADMIN` trying gets 403; the `OWNER` acting on the own row gets 409 "Contact support to transfer ownership first."). The `OWNER` cannot leave. |
| Ownership transfer | Not self-service. An `ops_admin` transfers ownership in `/ops` to an `ACTIVE` member with an approved member verification, with a reason (10 to 1000 characters). One transaction under the organization lock makes the old owner an `ADMIN` and the target the `OWNER` (events on both, audit with the reason, emails after commit). A partial unique index keeps exactly one `ACTIVE` `OWNER` per organization. Ops users who are members of the organization cannot act on it. |
| Public team | Opt-in: a member sets a public name (2 to 80 characters) and an optional title; the public profile of a verified organization shows current members (`ACTIVE`) and former members (`REVOKED` after having been active) with role and dates, never wallets, emails or ids. |
| Data | `organization_memberships` is extended (nullable `user_id` while the wallet is unproven, invite columns, `requested_role`, public name and title, `activated_at`); new `member_verifications`, `member_verification_documents` and `membership_events`; member documents reuse `organization_documents` with a nullable `membership_id`, under `incoming/members/<membershipId>/` and `documents/members/<membershipId>/` with the Spec 3 type, size and magic-byte rules. |
| Clients | Web only: members section, invitation page, membership page, read-only workspace for non-owners, public team, ops member review and transfer dialog. Mobile is unchanged. |

### Deviations recorded during implementation
- `/me.organizations` and `/organizations/mine` keep `status` as the organization status and add `membershipId` and `membershipStatus`; they list memberships in `PENDING_DOCUMENTS`, `UNDER_REVIEW`, `CHANGES_REQUIRED`, `ACTIVE` and `REMOVAL_REQUESTED`. Open invitations come from `GET /v1/me/invitations`.
- `REMOVAL_REQUESTED` members have no permissions but may still leave. Declining is allowed from `INVITED`, `PENDING_DOCUMENTS` and `CHANGES_REQUIRED`.
- The organization detail returns `myRole` and `myPermissions`; the web app hides controls from them and the server stays authoritative.
- The member verification view never carries payout wallet data; an incomplete submit is 422 `REQUIREMENTS_INCOMPLETE` with `details.missing { fields, documents }`; the transfer route returns 204.
- `GET /v1/memberships/:mid` returns the caller's own membership (role, status, public name) so the membership page can load it for members who cannot yet read the organization.
- The ops organization detail lists open memberships with an approved-verification flag (transfer targets), and the ops member queue shows the member's public name.

## Alternatives considered
- A configurable permission matrix per organization: more surface for little release-1 value.
- Letting owners verify their members: owners would handle members' identity documents.
- Self-service ownership transfer: a hijacked owner session could hand the organization away; support and an audited `ops_admin` action are safer.
- Pending user rows for unknown wallets: contradicts the Spec 2 rule that a typed address never creates a user.
- A job that expires invites: read-time expiry needs no scheduler.

## Consequences
### Positive
- Every organization route checks one matrix; the web app reads the same matrix.
- Wallet proof, not typing, is the only way an invite attaches to a person; concurrent proof and cancel always yield one outcome.
- Membership history and ownership changes are auditable and never destructive.

### Negative / trade-offs
- Expiry is applied when an invite is read or accepted, so an expired invite can linger as `INVITED` in the table until then.
- Email failures are logged and not retried.
- Member documents have no retention policy yet and no malware scanner (as ADR-008).

### Security, financial and operational impact
- Permission checks are server-side on every route; only `ACTIVE` memberships grant anything; an ADMIN cannot reach the OWNER through crafted requests. Member verification data is visible to the member and ops only. No funds move in this feature.

## Migration / rollout
Migration `0006_members`: `membership_status` replaced (data mapping `active` to `ACTIVE`, `revoked` to `REVOKED`; any other old value fails the migration), `organization_type` on templates becomes `subject` (`individual`, `firm`, `member`) with the seeded `member` template, new tables, partial unique indexes, grants and RLS. No new environment variable or provider. The user should check the invitation and member-verification emails (copy and sender domain) before release.

## Validation
API integration tests cover the permission table per role and route, lifecycle and concurrency (proof versus cancel), invite linking for EOA, smart wallet and Solana, member verification and ops decisions, role upgrade, removal requests, expiry on read, ownership transfer (exactly one owner), the public team and the data migration. Web tests cover members section gating, invite validation and `INVITE_EXISTS`, destructive confirmations, invitation accept, decline and expiry, the membership page, member verification, the read-only workspace, the public team, ops member review and the transfer dialog.

## Open questions
- Basket manager assignments and notifications (basket spec).
- Member document retention period (compliance).
- Whether per-organization permission overrides are ever needed.
