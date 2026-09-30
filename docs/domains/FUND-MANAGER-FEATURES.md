# Fund Manager Features — Domain Context

Source: `Fund-Manager-Detailed-Features.txt`

## Eligibility and verification
Individuals and firms may apply, but cannot immediately publish baskets. The platform performs internal screening and detailed verification before granting manager capabilities.

## Workspace and organization
Managers work through an approved organization. Team management uses scoped roles (Owner, Admin, Manager, Analyst, Viewer) from one fixed permission matrix; Admin and Manager memberships become active only after platform review of the member's own verification, ownership transfer is an ops action, and verified organizations may show an opt-in public team (ADR-009). Organization profile, payout wallet and public manager history are separately managed and auditable.

## Basket creation and review
Implemented in Spec 6 (ADR-011). Members with `baskets.manage` of a verified organization create a basket in the organization workspace and build versions in a nine-section wizard: identity, thesis, registry assets with hand-entered target weights, constraints, rebalance disclosures, manager assignments, fees and minimums, risks, then validation and a "not public" preview. Submitting freezes and hashes the version for platform review; an `ops_admin` approves, then a manager with the publish flag publishes. Review covers strategy, assets, allocation, communication, managers, fees and operations, with section comments and a message back to the manager.

## Basket managers and access
A basket has a lead and optional co-managers (per-basket flags: edit, submit, publish, lifecycle, assign). Owners and admins act on every basket. A lead who leaves ends their assignments and the published basket waits for a new lead approved by ops. Former and current managers are shown publicly on the basket page.

## Rebalance publication
A rebalance is a new basket version with a required rationale and a computed change summary, reviewed like any version before publication. Users are not affected until the later investment specs let them accept or skip a version; consent is always explicit. Review frequency and drift threshold are disclosures only.

## Commercial model
Fees are disclosed terms in Spec 6 (entry, management, rebalance, optional subscription; percent up to 1% or a fixed USDC amount up to 1% of the minimum investment) and nothing is charged or collected. Fee base, collection timing, refunds and recipient split stay open until the subscriptions and fees spec.

## Dashboard and analytics
Manager dashboard supports basket management, performance and rebalance history, team/organization operations and revenue/analytics as permitted by role. Basket management exists (status tabs, wizard, version history); performance, analytics and revenue are later specs. Do not expose private verification or internal review data in public views.
