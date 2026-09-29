# Fund Manager and Organization Onboarding

Source: `Fund-Manager-&-Organisation-Onboarding-Flow.txt`, `Fund-Manager-Detailed-Features.txt`

## Core model
A person authenticates as a user. A manager operates through an organization. The organization is the durable business context and owns/manages baskets; memberships and permissions grant people access.

## Application flow
Statuses: `EMAIL_PENDING → SUBMITTED → SCREENING → CONTACTED / ADDITIONAL_INFORMATION_REQUIRED → SCREENING_APPROVED | SCREENING_REJECTED`. Allowed transitions are one table in code (`APPLICATION_TRANSITIONS`); anything else is `INVALID_TRANSITION`.
1. Anyone may submit the Become a Fund Manager application at `/managers/apply` (applicant type individual or firm, contact details, background, intent, wallet chain and typed address). The application is `EMAIL_PENDING` until the applicant confirms a 6-digit emailed code; only then does it become `SUBMITTED` and enter the ops queue. The applicant receives a private status link once (also emailed).
2. Platform reviewers work the queue in `/ops`: move it to `SCREENING`, `CONTACTED` (contact happens outside the app) or `ADDITIONAL_INFORMATION_REQUIRED` (message to the applicant required; the applicant may reply once at the status page, which returns it to `SCREENING`), add internal notes, and finally approve or reject. Every change is an event plus an audit record; applicants get an email for contacted, information required, approved and rejected.
3. Approval records the decision. The permission is granted only when the submitted wallet is proven: a typed address is an identifier, never proof, and never creates or links a user.
   - If a proven user already owns the address at approval time, `create_manager_organization` is granted immediately.
   - Otherwise the application waits, and the grant happens in the Spec 1 sign-in or add-chain transaction when the applicant proves the exact address (EVM: EOA proof on any EVM chain, or ERC-1271/6492 on exactly the submitted chain; Solana: ed25519). The hook locks the open application by wallet family and address and checks status, proof and chain under that lock, so a concurrent approve and first sign-in always yield exactly one grant.
   - Disabled addresses and non-active users never receive the grant.
4. The user signs in and creates an individual or firm organization (Spec 3).
5. Submit the organization and required evidence for platform verification.
6. Only after approval grant the appropriate manager capabilities.

Rules: one open application per email and per wallet address (rejected applications may re-apply); `EMAIL_PENDING` applications older than 24 h are purged; if the code email fails on submit, the API returns `OTP_DELIVERY_FAILED` with the application id so the applicant can resend; the applicant sees only status, the latest ops message and whether a reply is allowed, never internal notes.

## Organization and wallet
- Organization information has private and public subsets.
- Changes to approved public information may require re-verification; keep the currently approved public version visible until approval.
- Organization payout wallet is distinct from personal/authentication wallets and requires ownership verification.
- Payout wallet changes are controlled and auditable.

## Members and roles
The source describes Owner, Admin, Manager, Analyst and Viewer roles with role-based permissions. Enforce permissions by organization and resource. Membership verification is distinct from user authentication. Removing a member revokes access but preserves person, basket and audit history.

## Basket continuity
Basket ownership is tied to the organization, not permanently to an individual member. Removing a manager does not automatically delete a basket. Manager attribution/history and investor notifications for material manager changes must be preserved.

## Sensitive information
Verification documents and internal review notes remain private and access-controlled. Public organization and manager profiles expose only approved information.
