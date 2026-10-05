# ADR-019: Custom organization roles, uploaded files and curated discovery rails

- **Status:** APPROVED (user decisions of 2026-10-04, Spec 17 round 2: "Custom roles", "Versioned basket files", "Uploaded + icon pack")
- **Date:** 2026-10-04
- **Owners:** Platform
- **Related:** ADR-009 (organization members), ADR-011 (basket versions), D-048 (permission matrix), D-049 (member verification), `docs/superpowers/BRAINSTORM-LOG.md` round 2

## Context
Organizations asked for finer control over "who can see what and who can update what" than the five built-in roles give. Managers need to attach documents (thesis, factsheet) to a basket, assets need recognisable logos, and the home and discovery pages need Featured, Trending and Suggested baskets. Each touches permissions, stored files or what investors are shown, so each needs fixed rules.

## Decision

### Custom roles
1. The built-in roles and `ROLE_PERMISSIONS` stay unchanged and remain the base of everything (verification per D-049, ownership per D-050, invitations).
2. An organization may define **custom roles**: a name, an optional description, a **base role** (`ADMIN`, `MANAGER`, `ANALYST` or `VIEWER`, never `OWNER`), and a permission set.
3. A custom role's permissions must be a subset of its base role's permissions **minus the owner-only ones** (`org.edit`, `payout.manage`, `members.manage_admins`), **plus** any of the read-only grants `analytics.read` and `earnings.read`. `org.read` is always required. Write permissions therefore only ever come from a base role whose verification already gates them.
4. A custom role applies to a membership only while it is **not archived** and its base role **equals** the membership's current role; otherwise the built-in role's permissions apply. Role changes clear the link; archiving releases all holders.
5. Effective permissions are computed server-side for every organization route (`requirePermission`), for basket authority (an `ADMIN` acts on every basket only while it still holds `baskets.manage`), for basket assignment eligibility, in `myPermissions`, and in the member list. Stored sets are re-filtered by the rules on every read (defence in depth).
6. Defining, editing and archiving roles is owner-only (`members.manage_admins`). Assigning one needs `members.manage`, and only the owner changes what an `ADMIN` can do. Members who lose `baskets.manage` lose their basket assignments immediately (existing reassignment flow). Every change is audited (`organization_role.*`, `membership.custom_role_set`).

### Uploaded files
7. One generic `stored_files` table uses the organization-document lifecycle: presign a PUT to `incoming/`, confirm checks declared size, type and leading bytes, copy to `files/<purpose>/<id>.<ext>`. Reads are short-lived signed R2 links; nothing is served from our origin; SVG is not accepted.
8. **Asset logos** (PNG, JPEG, WebP up to 512 KB) are set by ops reviewers on an instrument (audited). Clients show the uploaded logo first and may fall back to the vendored CC0 `cryptocurrency-icons` set by ticker.
9. **Basket files** (PDF up to 20 MB, at most 10 per version; kinds: thesis, factsheet, methodology, research, other) attach to the **open, editable version** by members with basket `edit` authority. They are frozen once the version is submitted, carried into the next draft, part of the version content hash when present (hashes of versions without files are unchanged), shown wherever the version is shown (editor, ops review, preview) and, for the published version, on the public basket page.

### Discovery rails
10. **Featured** is ops-curated: `baskets.featured_rank` 1–99, set by ops reviewers on `ACTIVE` baskets (audited). The UI says it is chosen by the Bytesac team and is not advice.
11. **Trending** ranks `ACTIVE` baskets by distinct new investors in the last 30 days and lists only baskets with at least 5 (the adoption masking threshold); counts are never returned.
12. **Suggested** (signed in) lists `ACTIVE` baskets in categories the user already holds, excluding baskets they hold, else the newest.

## Alternatives considered
- **Free-form permission editor (any permission on any role).** Rejected: it would let an unverified member hold `baskets.manage` or delegate payout and admin control.
- **Restrictive-only custom roles (subsets of the base role).** Simpler, but cannot express the most requested case: an analyst who may read earnings.
- **Per-basket roles.** Already covered by basket assignment flags (ADR-011).
- **Files on the basket rather than the version.** Rejected: an update to the thesis would change what an already-published version says without review.
- **Trending by page views.** Rejected: there is no consented analytics pipeline, and views are easy to game.

## Consequences
### Positive
- Organizations can model their real team (finance readers, read-only admins) without weakening verification or custody controls.
- Documents follow the same review and immutability rules as the rest of a version.

### Negative / trade-offs
- Permission checks now read one extra row when a custom role is linked.
- Saved ("bookmarked") baskets are stored per browser in v1; a synced watchlist is an open item.

### Security, financial and operational impact
- No custom role can grant `payout.manage`, `org.edit` or `members.manage_admins`; payout and custody flows are untouched.
- Uploaded files are untrusted: checked by magic bytes, stored under server-chosen keys, downloaded with an attachment disposition, never rendered inline from our origin.

## Migration / rollout
Migrations `0017_featured_baskets`, `0018_stored_files`, `0019_custom_roles` (additive; grants and RLS for `bytesac_api`). API, validator and api-client changes are additive; new response fields have defaults.

## Validation
API tests: `discovery/collections.test.ts`, `assets/logo.test.ts`, `baskets/files.test.ts`, `members/roles.test.ts`; validator unit tests for the custom-role rules; route-table snapshot; allow-list tests for public views.

## Open questions
- Should custom roles appear on the public team page? (Currently no: only the built-in role is public.)
- A synced watchlist for saved baskets.
