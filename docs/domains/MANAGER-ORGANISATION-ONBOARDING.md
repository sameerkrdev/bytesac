# Fund Manager and Organization Onboarding

Source: `Fund-Manager-&-Organisation-Onboarding-Flow.txt`, `Fund-Manager-Detailed-Features.txt`

## Core model
A person authenticates as a user. A manager operates through an organization. The organization is the durable business context and owns/manages baskets; memberships and permissions grant people access.

## Application flow
1. Anyone may submit the Become a Fund Manager application.
2. Platform team contacts the applicant and performs initial screening.
3. Platform performs the required manager/person or firm verification.
4. After clearance, the platform requests the relevant wallet address.
5. Verify control of the wallet; an entered address alone is not proof.
6. Associate an existing user or create a user through the approved flow.
7. Grant narrowly scoped organization-creation permission.
8. The user signs in and creates an individual or firm organization.
9. Submit the organization and required evidence for platform verification.
10. Only after approval grant the appropriate manager capabilities.

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
