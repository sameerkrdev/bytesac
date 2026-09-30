# Basket Creation — Domain Context

Source: `Basket-Creation.txt`, `Fund-Manager-Detailed-Features.txt`. Implemented in Spec 6 (ADR-011, D-007, D-008, D-057 to D-061).

## Purpose
A basket is a versioned investment strategy owned by a verified organization. It is not a manager's personal wallet or a single transaction. Nothing in it invests, executes, charges or moves assets: fees and minimums are disclosed terms and the public "Invest" button is disabled.

## Lifecycle
Basket and version are separate state machines.
- **Basket:** `DRAFT` → first publish → `ACTIVE` ⇄ `PAUSED`; `ACTIVE`/`PAUSED` without an active lead → `REASSIGNMENT_REQUIRED` → ops approves a new lead → previous status; a manager's retirement request → `RETIREMENT_PENDING` → an `ops_admin` retires (`RETIRED`) or declines (previous status); ops may retire directly; a rejected version 1 → `REJECTED`. `RETIRED` and `REJECTED` are read-only.
- **Version:** `draft` → submit → `in_review` → `changes_required` → resubmit, or `approved` (only an `ops_admin`) → manager publishes → `published` → next published version makes it `superseded`; `in_review` can be withdrawn before a decision, or `rejected`. One open version per basket; editable only as `draft` or `changes_required`.
- Submit hashes the content; publish is refused if the hash differs from the approved one. Publish is idempotent. Drafting is allowed while paused, reassignment-required or retirement-pending; submit and publish are not.

## Creating a basket
A member holding `baskets.manage` in a `VERIFIED` organization creates a basket (name, category) and becomes its `lead`. The web wizard has nine sections: Basics, Thesis, Assets & allocation, Constraints, Rebalance, Managers, Fees & minimum, Risks & disclosures, Review & preview. Saving is explicit and sends the version's `updatedAt`; a stale save is 409 `VERSION_CONFLICT` and nothing is overwritten. Validation runs live in the browser and again on the server.

## Allocation, constraints, fees
- 1 to 20 `ACTIVE` registry instruments with an `ACTIVE` deployment; whole-bps weights of at least 100 that add up to exactly 10000; no duplicates; optional weight band; warnings for one asset above 50% and for paused or deprecated instruments. Nothing is normalized for the manager.
- Optional constraints: maximum weight per asset, maximum stablecoin and tokenized-asset share.
- Fees: entry, management (annual) and rebalance as percent (0 to 1%) or fixed USDC; subscription as fixed USDC per month or year or none. Every fixed amount is at most 1% of the minimum investment (exact micro-USDC comparison). A minimum investment above zero is required.
- Rebalance configuration (`none`, `monthly`, `quarterly`, optional drift threshold) is a disclosure only. A rebalance is a manager-proposed new version that needs a rationale and review; users always consent explicitly.

## Disclosures
Mandatory platform notices come from ops-managed templates chosen by asset types, are pinned to each version at submit and cannot be removed. The manager's own risk text (`strategy_risks`) is required at submit.

## Managers
Per-basket assignments (`lead`, `co_manager`) carry flags `edit`, `submit`, `publish`, `lifecycle`, `assign`; OWNER and ADMIN act on every basket. When a manager leaves the organization (or loses `baskets.manage`) their assignments end and a published basket without a lead becomes `REASSIGNMENT_REQUIRED`; a new lead is `PENDING_APPROVAL` until an `ops_admin` approves (the current lead stays active until then). Assignment history is public on the basket page as current and former managers.

## Review
`ops_reviewer` requests changes, rejects, escalates or pauses; only `ops_admin` approves a version or a lead, lifts a platform pause, decides a retirement or retires directly. Each decision stores the checklist (completeness, assets, allocation, communication, managers, fees, operations: pass, fail or n/a with a note), section comments shown beside the manager's sections, a message to the manager and an internal note that managers never see. An ops user with any membership in the organization cannot decide on its baskets.

## Post-publication
Version history shows each version's rationale and a computed diff (added and removed assets, weight and band changes, constraint, rebalance, fee and minimum changes). The manager can pause immediately and resume; a platform pause only ops lift. The public page shows status notices (paused, manager change in progress, retirement pending, retired) and a notice when an asset was later paused or deprecated in the registry; nothing changes automatically. Investor notifications, commentary and performance are later specs (events are already recorded).

## Public and private
`/baskets` and `/baskets/[slug]` need no sign-in and show only the current published version: content, allocation with prices (stale or unavailable flagged), constraints, rebalance disclosures, fees and minimums, pinned disclosures, version history and manager history. Drafts, reviews, internal notes, user ids, wallets and emails are never public. All text is plain text.

## Key invariants
- Draft/unapproved baskets are not public or investable.
- Only authorized organization members can create and manage baskets, per flag, enforced server-side.
- Published strategy versions are immutable snapshots; asset rows and disclosure pins are revisioned, never deleted.
- A published manager update does not itself authorize a user's transactions.
