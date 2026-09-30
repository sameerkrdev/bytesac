# Spec 3 — Organization Onboarding (Design)

- **Date:** 2026-09-30
- **Status:** Approved in conversation (2026-09-30); written spec pending user review
- **Series:** Spec 3 of 4 — (1) Foundation + user auth ✅, (2) Manager application + screening ✅, (3) Organization onboarding, (4) Members/roles
- **Builds on:** Spec 1 (wallet sign-in, challenges, sessions, contacts, audit), Spec 2 (`create_manager_organization` permission, `platform_roles`, `/ops` area, self-review block pattern, `application_events` pattern).
- **Sources:** `docs/source/Fund-Manager-&-Organisation-Onboarding-Flow.txt` §11–§24, §40, §42 D–F; D-005, D-006, D-019.

## 1. Intent

A user holding `create_manager_organization` creates an individual or firm organization, completes template-driven information, uploads private verification documents to Cloudflare R2, proves a Solana payout wallet by signature, and submits for platform verification. Ops review it in `/ops`. A verified organization gets a public profile; later public edits are versioned change requests, and payout wallet replacement requires signature proof plus ops approval.

**Success criteria**
1. A permission holder can create at most one non-rejected organization, becoming its `OWNER`.
2. Required fields and documents come from a seeded requirement template (org type + optional jurisdiction); submit is refused with the exact missing list until complete.
3. Documents upload directly to R2 via presigned PUT, are type/size checked server-side on confirm, stay private, and are downloadable only by ops via short-lived links.
4. A payout wallet is `VERIFIED` only after a Solana signature over a payout-specific challenge; typed addresses never verify; history is kept.
5. Ops can review organizations, change requests and payout replacements in a web UI, with allowed transitions only, messages to owner, internal notes, full timeline and audit.
6. The public profile shows only the current approved version's public fields; pending edits never replace it before approval.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Scope | One spec covering §11–§24 (user choice). |
| Document upload | Presigned direct PUT to R2 (user choice), confirm step with server-side sniffing, `incoming/` prefix expired by R2 lifecycle rule. |
| Requirement templates | DB table `verification_requirement_templates`, seeded by migration; most specific match (type + jurisdiction) wins over default (type only); no editor UI in release 1. |
| Post-verification edits | Whole-profile versions: one open draft version (change request) at a time; approval switches the current public version. |
| Payout wallet replacement | Signature proof → `REPLACEMENT_PENDING` → ops approval; old wallet active until approval. |
| Malware | No scanner in release 1: PDF/JPEG/PNG only, ≤10 MB, magic-byte check, attachment-only downloads, `scan_status = not_scanned` recorded. Identity checks stay manual (no KYC/KYB vendor). |
| Org count | At most one owned organization that is not `REJECTED`; permission is not consumed. |
| Clients | Web only (owner workspace, public profile, ops). Mobile unchanged. |
| `APPROVED` state | Not stored: the ops "verify" action moves `UNDER_REVIEW → VERIFIED` directly (source shows `APPROVED → VERIFIED` with no step in between). |

## 3. Out of scope

Members beyond the `OWNER` membership, invitations, ownership transfer, org-side roles in use (Spec 4); baskets; public members/baskets lists on the profile; template editor UI; malware scanning; KYC/KYB providers; org suspension; mobile screens; document retention purge.

## 4. Field catalog and templates

`@repo/validator` exports `ORGANIZATION_FIELDS`: a catalog of `{ key, label, visibility: "public" | "private", schema (zod) }` and `ORGANIZATION_DOCUMENT_TYPES`: `{ key, label }`. Templates reference catalog keys only; the API rejects a template row naming an unknown key at load.

**Catalog (initial)**
- Public: `displayName` (2–120), `about` (20–4000), `experience` (20–4000), `investmentPhilosophy` (≤4000, optional), `website` (https URL, optional), `registrations` (≤2000, optional).
- Private (individual): `legalName`, `dateOfBirth` (ISO date, 18+), `residentialAddress`, `professionalHistory`, `qualifications` (optional).
- Private (firm): `legalCompanyName`, `registrationNumber`, `registeredAddress`, `businessAddress` (optional), `directors`, `beneficialOwners`, `authorizedRepresentatives`.
- Document types: `government_id`, `proof_of_address`, `company_registration`, `ownership_structure`, `director_id`, `license_registration`.

**Seeded default templates**
- `individual`: fields `displayName, about, experience, legalName, dateOfBirth, residentialAddress, professionalHistory`; documents `government_id, proof_of_address`.
- `firm`: fields `displayName, about, experience, legalCompanyName, registrationNumber, registeredAddress, directors, beneficialOwners, authorizedRepresentatives`; documents `company_registration, ownership_structure, director_id, proof_of_address`.

Optional catalog fields may always be filled; only template-required ones gate submission.

## 5. Data model (`@repo/db`, schema `app`)

- **`organizations`**: `id`, `type` enum(`individual`,`firm`), `status` enum (§6), `jurisdiction` (ISO-3166 alpha-2), `current_version_id` (nullable FK; approved public version), `created_by_user_id`, `submitted_at`, `verified_at`, `decided_by_user_id`, `created_at`, `updated_at`. Partial unique `(created_by_user_id)` where `status <> 'REJECTED'`.
- **`organization_memberships`**: `id`, `organization_id`, `user_id`, `role` enum(`OWNER`,`ADMIN`,`MANAGER`,`ANALYST`,`VIEWER`), `status` enum(`active`,`revoked`), `joined_at`, `left_at`. Partial unique `(organization_id, user_id)` where `status='active'`. Spec 3 only creates `OWNER`.
- **`organization_versions`**: `id`, `organization_id`, `version_number` (unique per org), `status` enum(`draft`,`in_review`,`changes_required`,`approved`,`rejected`,`superseded`), `public_profile` jsonb, `private_details` jsonb, `created_by_user_id`, `submitted_at`, `decided_at`, `decided_by_user_id`, `created_at`, `updated_at`. Partial unique: one version per org in (`draft`,`in_review`,`changes_required`). Content is editable only in `draft`/`changes_required`.
- **`organization_documents`**: `id`, `organization_id`, `document_type`, `r2_key`, `content_type`, `size_bytes`, `status` enum(`pending_upload`,`uploaded`,`rejected_file`), `scan_status` enum(`not_scanned`), `uploaded_by_user_id`, `created_at`, `uploaded_at`. Rows immutable after `uploaded`.
- **`organization_version_documents`**: `id`, `version_id`, `document_id`, `created_at`, `removed_at` (soft unlink; partial unique `(version_id, document_id)` where `removed_at is null`; no DELETE, D-038). A new draft copies the current version's active links.
- **`verification_requirement_templates`**: `id`, `organization_type`, `jurisdiction` (nullable = default), `required_fields` text[], `required_documents` text[], `created_at`, `retired_at`. Partial unique `(organization_type, coalesce(jurisdiction,''))` where `retired_at is null`.
- **`organization_payout_wallets`**: `id`, `organization_id`, `chain` (Chain; `solana` only enforced by check), `address`, `status` enum(`UNVERIFIED`,`VERIFYING`,`VERIFIED`,`REPLACEMENT_PENDING`,`REVOKED`), `verified_at` (signature time), `activated_at`, `deactivated_at`, `requested_by_user_id`, `decided_by_user_id`, `created_at`, `updated_at`. Partial uniques: one `VERIFIED` per org; one row in (`UNVERIFIED`,`VERIFYING`,`REPLACEMENT_PENDING`) per org. Rows are the history (never overwritten).
- **`organization_events`** (append-only): `id`, `organization_id`, `actor_type` (`owner`,`ops`,`system`), `actor_user_id`, `kind` enum(`status_changed`,`note`,`version_submitted`,`version_decided`,`document_uploaded`,`document_unlinked`,`version_created`,`payout_wallet_changed`), `from_status`, `to_status`, `version_id`, `payout_wallet_id`, `decision` (approved/changes_required/rejected on decision events), `internal_note`, `message_to_owner`, `request_id`, `created_at`.
- `challenge_purpose` enum gains `payout_wallet`; `auth_challenges` gains nullable `organization_id` (check `auth_challenges_org_for_payout` written with `purpose::text`, because Postgres forbids using a newly added enum value in the transaction that adds it).
- Grants/RLS as 0001/0003 (runtime role SELECT/INSERT/UPDATE, no DELETE). `user_permissions` unchanged.

## 6. State machines (tables in `@repo/validator`)

**Organization** (`ORGANIZATION_TRANSITIONS`, ops only unless noted)
```
DRAFT ──owner submit──▶ SUBMITTED ──ops──▶ UNDER_REVIEW ──ops──▶ VERIFIED
                                              │  ├──ops──▶ REJECTED (terminal)
                                              │  └──ops──▶ CHANGES_REQUIRED ──owner resubmit──▶ RESUBMITTED ──ops──▶ UNDER_REVIEW
SUBMITTED | RESUBMITTED ──ops──▶ REJECTED
```
- Owner submit/resubmit requires: all template-required fields valid in the draft version, every required document type linked with `uploaded` status, and a `VERIFIED` payout wallet. Otherwise 422 `REQUIREMENTS_INCOMPLETE` with `details.missing: { fields: string[], documents: string[], payoutWallet: boolean }`.
- Submit moves the draft version to `in_review`; `CHANGES_REQUIRED` moves it to `changes_required` (editable); `VERIFIED` marks it `approved`, sets `current_version_id`, `verified_at`; `REJECTED` marks it `rejected`.
- `CHANGES_REQUIRED` requires `messageToOwner` (validator refine).

**Change request (verified orgs only)** — owner `POST change-request` creates a new `draft` version copying current public/private content and document links; owner edits and submits (`in_review`, same completeness check minus payout wallet); ops decide `approved` (current switches, previous `superseded`), `changes_required` (message required; owner edits and resubmits), or `rejected`. Organization status stays `VERIFIED` throughout. Public profile always reads `current_version_id`.

**Payout wallet** — owner enters address → row `UNVERIFIED` (replaces any existing not-yet-proven row by marking it `REVOKED`); challenge issued → `VERIFYING`; valid signature → `VERIFIED` with `activated_at` if the org has no active wallet, else `REPLACEMENT_PENDING`. Replacement allowed only when org is `VERIFIED`; ops approve → old `REVOKED` + `deactivated_at`, new `VERIFIED` + `activated_at`, same transaction; ops reject → new `REVOKED`. Before verification the owner may simply replace an unverified/verified wallet by proving a new one (old becomes `REVOKED`), since nothing is paid out yet.

All transitions `SELECT … FOR UPDATE` the org row; invalid → 409 `INVALID_TRANSITION`. Every change writes `organization_events` + audit in the same transaction.

## 7. Documents (R2)

1. `POST /v1/organizations/:id/documents` `{ documentType, contentType, sizeBytes }` — owner, org editable (draft version exists in `draft`/`changes_required`); content type ∈ `application/pdf`,`image/jpeg`,`image/png`; `sizeBytes` ≤ 10 MB; creates `pending_upload` row; returns `{ documentId, uploadUrl, headers }`: presigned PUT (5 min) to `incoming/<orgId>/<documentId>` with signed `Content-Type` and `Content-Length`.
2. Browser PUTs the file to R2 (R2 CORS allows PUT from web origins).
3. `POST /v1/organizations/:id/documents/:docId/confirm` — HEAD object (size/type must equal declared), GET first bytes and check magic bytes (`%PDF-`, `FF D8 FF`, `89 50 4E 47 0D 0A 1A 0A`); match → copy to `documents/<orgId>/<documentId>`, then one transaction: row `uploaded`, link to the draft version (replacing an existing link of the same `document_type` in that draft), event `document_uploaded`; then delete the incoming object (best effort); mismatch/missing → row `rejected_file`, delete object, 422 `DOCUMENT_REJECTED`.
4. `DELETE /v1/organizations/:id/draft/documents/:docId` soft-unlinks (`removed_at`) from the draft only (object and row kept).
5. R2 lifecycle rule deletes `incoming/` objects after 1 day. `pending_upload` rows older than 1 day are left as history (no purge needed; they hold no PII).
6. Ops download: `GET /v1/ops/organizations/:id/documents/:docId/download` → 302 to presigned GET (5 min) with `ResponseContentDisposition: attachment`. Owners see metadata only (type, size, uploaded date), no download. Reviewers who are members of the organization are refused (403), like every ops mutation.
7. `providers/r2.ts`: S3 client (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, pinned) configured (checksums `WHEN_REQUIRED`, so presigned PUTs carry no empty-body checksum) from env `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; tests mock it.

## 8. Payout wallet proof

- Reuses the Spec 1 challenge lifecycle (`pending → processing → consumed | rejected`) with purpose `payout_wallet`, `chain = solana`, bound to `organization_id`, the address and the session user. The signed text is a plain custom message, not SIWS:

  ```
  Bytesac payout wallet verification

  Verify payout wallet for Bytesac organization <orgId>. This does not sign you in or authorize any transfer.

  Domain: <AUTH_DOMAIN>
  Organization: <orgId>
  Wallet: <address>
  Nonce: <nonce>
  Issued At: <ISO>
  Expiration Time: <ISO>
  ```

  On success the wallet row stores `verification_challenge_id` and `verification_signature`; `app.purge_expired()` keeps challenges referenced by a payout wallet.
- `payout_wallet` challenges are refused by `/v1/auth/verify`; sign-in challenges are refused by the payout verify route.
- Verification uses the existing Solana ed25519 verifier; finalize (wallet status change + challenge consume + event + audit) is one transaction.
- The payout address may equal any user wallet; it is a separate resource either way.
- Wallet entry, challenge and verify are refused (409) while the organization is `SUBMITTED`, `UNDER_REVIEW` or `RESUBMITTED`.

## 9. API (validator schemas in `@repo/validator`)

**Owner** (session; create needs active `create_manager_organization`; all other routes need an active `OWNER` membership of `:id`, else 403 `FORBIDDEN`; 404 for unknown org)
| Method & path | Purpose |
|---|---|
| `POST /v1/organizations` `{ type, jurisdiction }` | Create `DRAFT` + version 1 draft + OWNER membership. 409 `ORGANIZATION_EXISTS` if an open org exists. |
| `GET /v1/organizations/mine` | Orgs where the user is an active member. |
| `GET /v1/organizations/:id` | Private view: org, draft/current versions, documents (metadata), payout wallets, resolved template, `missing`, latest message to owner. |
| `PATCH /v1/organizations/:id/draft` `{ publicProfile?, privateDetails? }` | Update the editable version; unknown keys rejected; values validated per catalog (required-ness checked only on submit); `null` removes a key. |
| `POST /v1/organizations/:id/documents`, `…/documents/:docId/confirm`, `DELETE …/draft/documents/:docId` | §7. |
| `POST /v1/organizations/:id/payout-wallet` `{ address }` | Create `UNVERIFIED` row. |
| `POST /v1/organizations/:id/payout-wallet/challenge` | Issue payout challenge → `VERIFYING`. |
| `POST /v1/organizations/:id/payout-wallet/verify` `{ challengeId, signature }` | §8. |
| `POST /v1/organizations/:id/submit` | `DRAFT → SUBMITTED` or `CHANGES_REQUIRED → RESUBMITTED`. |
| `POST /v1/organizations/:id/change-request` | Create change-request draft (org `VERIFIED`, none open). |
| `POST /v1/organizations/:id/change-request/submit` | Draft → `in_review`. |

**Public**: `GET /v1/public/organizations/:id` — `VERIFIED` only (else 404): type, jurisdiction, public fields of the current version, `verifiedAt`.

**Ops** (session + `ops_reviewer`; 120/min per user; self-review blocked: acting user with any membership in the org → 403 `FORBIDDEN`)
| Method & path | Purpose |
|---|---|
| `GET /v1/ops/organizations?status=&q=&queue=&cursor=` | Paginated (25, cursor by `updated_at,id`); `queue` = `organizations` \| `change_requests` \| `payout_changes`; `q` matches display/legal name (parameterized ILIKE). Excludes `DRAFT`. |
| `GET /v1/ops/organizations/:id` | Full details, all versions, documents, wallets (history), events incl. internal notes. |
| `POST /v1/ops/organizations/:id/transition` `{ to, internalNote?, messageToOwner? }` | Org status change. |
| `POST /v1/ops/organizations/:id/versions/:versionId/decision` `{ decision: approved\|changes_required\|rejected, internalNote?, messageToOwner? }` | Change request decision. |
| `POST /v1/ops/organizations/:id/payout-wallets/:walletId/decision` `{ decision: approved\|rejected, internalNote? }` | Replacement decision. |
| `POST /v1/ops/organizations/:id/notes` `{ internalNote }` | Note. |
| `GET /v1/ops/organizations/:id/documents/:docId/download` | §7. |

**Existing:** `GET /v1/me` adds `organizations: { id, role, status }[]`.

**New error codes:** `ORGANIZATION_EXISTS` (409), `REQUIREMENTS_INCOMPLETE` (422), `DOCUMENT_REJECTED` (422). Reuse `INVALID_TRANSITION`, `FORBIDDEN`, `VALIDATION_FAILED`, `NOT_FOUND`, `RATE_LIMITED`, challenge/signature codes.

**Rate limits:** owner mutations 60/min per user; document presign 30/h per org; payout challenge as Spec 1 challenge limits; public profile 60/min per IP.

## 10. Emails (Resend, idempotency key per event)

To the owner's verified email contact (Spec 1 contacts); skipped with a log line when none: `CHANGES_REQUIRED` (includes message), `VERIFIED`, `REJECTED`, change request decided, payout replacement requested, payout replacement activated/rejected. Failures are logged, never roll back the state change.

## 11. Web

- **Home**: replaces the Spec 2 "coming soon" card with "Create your organization" (permission, no org) or an org status card linking to `/organization`.
- **`/organization`** (owner workspace, one page): type + jurisdiction (create step); template-driven field sections "Public profile" and "Private details (never shown publicly)"; documents per required type (upload with progress, status, remove from draft, rejected-file error); payout wallet (enter address, connect Solana wallet via AppKit, sign, status, history); submit checklist listing `missing`. Read-only while `SUBMITTED`/`UNDER_REVIEW`/`RESUBMITTED`; shows ops message on `CHANGES_REQUIRED`. When `VERIFIED`: "Edit profile" (change request with its own state), "Change payout wallet" (shows pending replacement), link to public profile.
- **`/organizations/[id]`**: public profile (verified badge, type, jurisdiction, public fields, verified date).
- **`/ops/organizations`**: tabs Organizations / Change requests / Payout wallet changes; status filter chips, search, table (cards on mobile), load more.
- **`/ops/organizations/[id]`**: owner summary; Public profile and Private details panels; documents with Download; payout wallet with history; review form offering only allowed transitions (message required for changes); internal note; timeline (internal notes marked "Internal"). Change-request view shows current vs proposed side by side (changed fields marked, new documents listed). Payout-change view shows current vs new wallet with approve/reject. 403 → "You no longer have access".
- Ops nav gains "Organizations". Design system as Spec 1/2 (dark, tokens, 44 px, status text+icon, lucide).

## 12. Security & privacy

- Owner/ops/permission checks server-side on every route; role or membership loss effective next request.
- Private details and documents readable only by the owner (documents: metadata only) and ops; public endpoint serializes only catalog fields marked `public` from the current approved version.
- Presigned URLs and R2 keys never logged; request logs keep path only (Spec 2 I1).
- Uploaded files untrusted: declared type/size signed into the PUT, verified again on confirm, magic bytes checked, attachment-only download.
- Payout wallet requires a signature bound to org + address + session; payout challenges cannot sign in and vice versa.
- Self-review blocked for any ops user who is a member of the org.
- Every state change audited with request id.

## 13. Testing

- **Unit:** transition tables (valid/invalid, terminal), template resolution (jurisdiction beats default, retired ignored, unknown key rejected), catalog validation, magic-byte sniffing.
- **Integration** (real Postgres/Redis, mocked R2 + Resend):
  - Full journey: create → fill → presign/confirm documents → payout challenge/verify → submit → ops under review → changes required (message required) → resubmit → verify → public profile visible.
  - Incomplete submit → 422 with exact missing list.
  - Second open org → 409; allowed after the first is rejected.
  - Confirm with wrong magic bytes / size mismatch → `rejected_file`, object deleted.
  - Payout challenge rejected by `/v1/auth/verify`; sign-in challenge rejected by payout verify.
  - Replacement: old wallet stays `VERIFIED` until ops approve; reject leaves old active.
  - Change request: public profile unchanged until approval; one open draft only.
  - Non-owner / no permission → 403; ops member of the org → 403; no ops role → 403 on every ops route.
  - Private fields never present in public response.
- **Web:** workspace sections (field errors, upload states, submit checklist), change-request view, ops review form (allowed targets only, message required), ops diff view, access-lost state.

## 14. Execution shape (for the plan)

Four large tasks, one review at the end (Spec 2 model): (1) DB + validator (catalog, templates, machines) + R2 provider + owner API create/draft/documents; (2) payout wallet proof + submit + ops review API (orgs, versions, wallets) + public API + `/me`; (3) web owner workspace + Home card + public profile; (4) web ops pages + docs (ADR-008, D-005/D-006/D-019 rows, domain + architecture docs, `apps/api/README.md` R2 setup).

## 15. User actions

Create R2 bucket + API token (object read/write on the bucket); CORS rule allowing `PUT` (headers `Content-Type`) from web origins; lifecycle rule deleting `incoming/` after 1 day; set `R2_*` env vars.

## 16. Open items

- Required fields/documents per jurisdiction beyond the seeded defaults.
- Document retention period (compliance).
- Public members/baskets on the profile (Spec 4 / basket specs).
