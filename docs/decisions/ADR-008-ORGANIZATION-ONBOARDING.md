# ADR-008: Organization onboarding, versioned public profile, payout wallet proof and private documents

- **Status:** APPROVED
- **Date:** 2026-09-30
- **Owners:** Backend / Platform
- **Related:** D-005, D-006, D-019, D-038, D-042, D-045, D-046, D-047; ADR-003, ADR-007; `docs/superpowers/specs/2026-09-30-organization-onboarding-design.md`

## Context
After screening (ADR-007) a permission holder must create an organization, supply verification information and documents, prove a payout wallet and be verified by the platform. Verified public information must not change without review, private documents are sensitive, and a payout wallet must never be accepted from a typed address.

## Decision
| Topic | Decision |
|---|---|
| Scope | One spec covers organization creation through verified public profile, change requests and payout wallet replacement. Members beyond the `OWNER` membership are Spec 4. |
| Organization count | At most one owned organization that is not `REJECTED` (partial unique index). The permission is not consumed. |
| Lifecycle | `DRAFT → SUBMITTED → UNDER_REVIEW → VERIFIED`, with `CHANGES_REQUIRED → RESUBMITTED` and `REJECTED`. One transition table (`ORGANIZATION_TRANSITIONS`) is shared by API and UI. There is no stored `APPROVED` state: ops "verify" moves `UNDER_REVIEW → VERIFIED`. |
| Requirement templates | Table `verification_requirement_templates`, seeded by migration; the most specific match (type + jurisdiction) wins over the type default; no editor UI in release 1. Templates name catalog keys only. |
| Whole-profile versions | Public and private content lives in `organization_versions`. One open version per organization; content is editable only in `draft`/`changes_required`. After verification an edit is a change request (a new draft copying the current content and document links); approval switches `current_version_id`, the previous version becomes `superseded`. The public profile always reads the current approved version. |
| Documents | Presigned direct PUT to R2 under `incoming/<orgId>/<documentId>` (300 s, `Content-Type` and `Content-Length` signed), then a confirm step that checks size, type and magic bytes, copies to `documents/<orgId>/<documentId>` and deletes the incoming object. An R2 lifecycle rule expires `incoming/` after 1 day. No malware scanner in release 1 (`scan_status = not_scanned`): PDF/JPEG/PNG only, at most 10 MB, attachment-only downloads. Only ops download (302 to a presigned GET); owners see metadata. Member reviewers cannot download. |
| Document links | `organization_version_documents` has its own `id` and `removed_at`: unlinking a document from a draft is a soft unlink (partial unique index on active links), because the runtime role has no DELETE (D-038). Document rows are immutable after `uploaded`. |
| Payout wallet | A separate resource from the sign-in wallet. `VERIFIED` only after a Solana signature over a payout-specific challenge (purpose `payout_wallet`, bound to organization, address and session user; it says it does not sign in or authorize any transfer). Payout challenges are refused by `/v1/auth/verify` and sign-in challenges by the payout verify route. Rows are history and are never overwritten. |
| Wallet replacement | The first verification activates the wallet. Later, when the organization is `VERIFIED`, a proven new wallet becomes `REPLACEMENT_PENDING` and the old one stays active until ops approve. Wallet entry, challenge and verify are refused (409) while the organization is `SUBMITTED`, `UNDER_REVIEW` or `RESUBMITTED`. |
| Ops | `/ops/organizations` with three queues (organizations, change requests, payout wallet changes), allowed transitions only, message to owner (required for changes), internal notes, timeline and audit. An ops user who is a member of the organization cannot act on it (403); the same holds for document download. |
| Clients | Web only (owner workspace, public profile, ops). Mobile is unchanged. |

## Alternatives considered
- Server-proxied upload: simpler CORS, but streams private files through the API.
- Editing the public profile in place with a re-verification flag: the public page would show unreviewed content.
- Field-level change requests: more state for little benefit at release-1 volume.
- A stored `APPROVED` state: the source shows no step between approval and `VERIFIED`.
- Hard delete of document links: needs a DELETE grant the runtime role must not have.

## Consequences
### Positive
- The public page can only show reviewed content; documents never pass through the API and are never public.
- A wallet is only ever trusted after a signature, and replacement never leaves an organization without an active wallet.

### Negative / trade-offs
- Editing merges into the draft: an emptied required field keeps its old value unless the catalog accepts an empty string.
- Without a scanner, malicious-but-well-formed files are possible; reviewers download as attachments only.
- A confirm racing a submit can leave a `pending_upload` row whose incoming object is gone; the owner re-uploads.
- Email failures are logged and not retried.

### Security, financial and operational impact
- Private details and documents are readable only by the owner (documents: metadata) and ops; the public endpoint serializes only catalog fields marked public.
- Presigned URLs, R2 keys and private values are never logged. No funds move in this feature; the payout wallet is only recorded.

## Migration / rollout
Migration `0005_organizations` (eight tables, enums, `payout_wallet` challenge purpose, `auth_challenges.organization_id`, grants, RLS, seeded default templates). The check `auth_challenges_org_for_payout` compares `purpose::text`, because Postgres forbids using a newly added enum value in the transaction that adds it. `truncateAppTables` keeps the seeded templates. The user must create the R2 bucket, token, CORS and lifecycle rule (`apps/api/README.md`); a manual check against a real bucket is pending, the tests use a fake.

## Validation
API integration tests cover the full journey, incomplete submit, one open organization, rejected files (bad magic bytes, size mismatch), challenge purpose separation, replacement and reject, change requests, race on the single verified wallet, permission and self-review negatives and private data absent from the public response. Web tests cover the workspace sections, upload states, submit checklist, read-only and changes-required states, public profile, ops review form, change request diff, payout decision and access-lost state.

## Open questions
- Required fields and documents per jurisdiction beyond the seeded defaults.
- Document retention period (compliance).
- Public members and baskets on the profile (Spec 4 and basket specs).
