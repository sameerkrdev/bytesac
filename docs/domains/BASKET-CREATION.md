# Basket Creation — Domain Context

Source: `Basket-Creation.txt`, `Fund-Manager-Detailed-Features.txt`

## Purpose
A basket is a versioned investment strategy owned by an approved organization. It is not a manager's personal wallet or a single transaction.

## Lifecycle
A new basket starts as `DRAFT` and is not publicly investable. The manager completes the creation wizard, validates and previews it, submits it for platform review, resolves requested changes, and publishes only after approval. Published updates create new versions and follow review/publication controls.

Use the exact lifecycle and transition names from the source spec when implementing. Do not allow invalid transitions or edit published versions in place.

## Basket information
Capture the source-defined fields, including:
- Identity, name, description, category and investment objective/thesis.
- Approved asset selection and target allocations.
- Portfolio constraints and minimum investment.
- Rebalance configuration and investor consent behavior.
- Management assignments and organization context.
- Commercial terms, fees and disclosures.
- Public content and risk information.

Validate weights, asset eligibility, route availability, constraints, fees and required disclosures before submission/publication.

## Review
Platform review may approve, request changes or reject/escalate according to the specified workflow. Preserve reviewer, decision, notes, timestamps and version association. Separate duties where required.

## Post-publication
Support version history, informational updates, pause and retirement. Public and private information must be separated. Investor-facing updates should explain material changes, including rebalance reasons and impact.

## Key invariants
- Draft/unapproved baskets are not investable.
- Only authorized organization members can create/manage baskets.
- Published strategy versions are immutable snapshots.
- A published manager update does not itself authorize a user's transactions.
