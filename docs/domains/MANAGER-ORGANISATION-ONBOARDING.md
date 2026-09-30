# Fund Manager and Organization Onboarding

Source: `Fund-Manager-&-Organisation-Onboarding-Flow.txt`, `Fund-Manager-Detailed-Features.txt`

## Core model
A person authenticates as a user. A manager operates through an organization. The organization is the durable business context and owns/manages baskets; memberships and permissions grant people access.

## Application flow
Statuses: `EMAIL_PENDING → SUBMITTED → SCREENING → CONTACTED / ADDITIONAL_INFORMATION_REQUIRED → SCREENING_APPROVED | SCREENING_REJECTED`. Allowed transitions are one table in code (`APPLICATION_TRANSITIONS`); anything else is `INVALID_TRANSITION`.
1. Anyone may submit the Become a Fund Manager application at `/managers/apply` (applicant type individual or firm, contact details, background, intent, wallet chain and typed address). The application is `EMAIL_PENDING` until the applicant confirms a 6-digit emailed code; only then does it become `SUBMITTED` and enter the ops queue. The applicant receives a private status link once (also emailed).
2. Platform reviewers work the queue in `/ops`: move it to `SCREENING`, `CONTACTED` (contact happens outside the app) or `ADDITIONAL_INFORMATION_REQUIRED` (message to the applicant required, enforced by the API; the applicant may reply once at the status page, which returns it to `SCREENING`, or ops may return it to `SCREENING` without a reply), add internal notes, and finally approve or reject. Every change is an event plus an audit record; applicants get an email for contacted, information required, approved and rejected.
3. Approval records the decision. The permission is granted only when the submitted wallet is proven: a typed address is an identifier, never proof, and never creates or links a user.
   - If a proven user already owns the address at approval time, `create_manager_organization` is granted immediately.
   - Otherwise the application waits, and the grant happens in the Spec 1 sign-in or add-chain transaction when the applicant proves the exact address (EVM: EOA proof on any EVM chain, or ERC-1271/6492 on exactly the submitted chain; Solana: ed25519). The hook locks the open application by wallet family and address and checks status, proof and chain under that lock, so a concurrent approve and first sign-in always yield exactly one grant.
   - Disabled addresses and non-active users never receive the grant.
   - Self-approval is blocked: a reviewer cannot transition an application whose wallet they own (403 `FORBIDDEN`), and the grant hook never grants to the user who approved the application, recording a note and an audit entry instead. Such an application stays unproven until another reviewer rejects it (an approved application can be rejected while its wallet is unproven), after which the applicant can re-apply.
4. The user signs in and creates an individual or firm organization (Spec 3).
5. Submit the organization and required evidence for platform verification.
6. Only after approval grant the appropriate manager capabilities.

Rules: one open application per email and per wallet address (rejected applications may re-apply); `EMAIL_PENDING` applications older than 24 h are purged; if the code email fails on submit, the API returns `OTP_DELIVERY_FAILED` with the application id so the applicant can resend; the applicant sees only status, the latest ops message and whether a reply is allowed, never internal notes.

## Organization and wallet
Statuses: `DRAFT → SUBMITTED → UNDER_REVIEW → VERIFIED`, with `CHANGES_REQUIRED → RESUBMITTED → UNDER_REVIEW` and `REJECTED` (terminal). Ops transitions are one table in code (`ORGANIZATION_TRANSITIONS`); owner submit and resubmit are separate actions; anything else is `INVALID_TRANSITION`. There is no stored `APPROVED` state. ADR-008.
1. A user with `create_manager_organization` creates an individual or firm organization (`/organization`) with a two-letter jurisdiction and becomes its `OWNER`. At most one owned organization that is not `REJECTED` may exist; the permission is not consumed.
2. Required fields and documents come from a seeded requirement template (type, optionally jurisdiction; the most specific wins). Fields come from a catalog with public and private visibility (`@repo/validator`); private details are never shown publicly. The owner edits a draft version; required-ness is checked only on submit.
3. Documents (PDF, JPEG or PNG, at most 10 MB) go straight to R2 by presigned PUT, then a confirm step checks size, type and magic bytes. Removing a document from a draft is a soft unlink. Documents stay private: owners see metadata only and only ops download them (short-lived attachment links; reviewers who are members of the organization are refused).
4. The payout wallet is a separate Solana wallet. It becomes `VERIFIED` only after a signature over a payout-specific challenge; typed addresses never verify, and payout challenges cannot sign in. Wallet entry, challenge and verify are refused while the organization is under review.
5. Submit needs every template-required field valid, every required document uploaded and linked, and a verified payout wallet; otherwise 422 `REQUIREMENTS_INCOMPLETE` lists exactly what is missing. Submit moves the draft version to `in_review`.
6. Ops review in `/ops/organizations`: move to `UNDER_REVIEW`, request changes (message to the owner required; the version becomes editable again), verify or reject. Internal notes, timeline and audit are kept; an ops user who is a member of the organization cannot act on it.
7. Verification makes the reviewed version current and publishes the public profile (`/organizations/[id]`), which only ever shows the current approved version's public fields.
8. Later edits to a verified organization are whole-profile change requests: one open draft at a time, copied from the current version, submitted and decided by ops (approve, request changes, reject). The organization stays `VERIFIED` and the public profile is unchanged until approval.
9. Replacing the payout wallet needs a new signature and ops approval: the new wallet is `REPLACEMENT_PENDING`, the old one stays active until approval, rejection leaves it active. Wallet rows are history and are never overwritten; exactly one wallet is `VERIFIED` per organization.
10. Owners get Resend emails for changes required, verified, rejected, change request decisions and payout wallet replacement events (failures are logged, never roll back a state change).

## Members and roles
The source describes Owner, Admin, Manager, Analyst and Viewer roles with role-based permissions. Enforce permissions by organization and resource. Membership verification is distinct from user authentication. Removing a member revokes access but preserves person, basket and audit history.

## Basket continuity
Basket ownership is tied to the organization, not permanently to an individual member. Removing a manager does not automatically delete a basket. Manager attribution/history and investor notifications for material manager changes must be preserved.

## Sensitive information
Verification documents and internal review notes remain private and access-controlled. Public organization and manager profiles expose only approved information.
