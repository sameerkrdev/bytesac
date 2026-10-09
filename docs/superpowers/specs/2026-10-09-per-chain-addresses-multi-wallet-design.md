# Per-chain addresses and web multi-wallet (design)

- **Date:** 2026-10-09 · **Branch:** `main` (implementation on a feature branch)
- **Sources:** this session's decisions in `docs/superpowers/BRAINSTORM-LOG.md` ("Mobile wallets and chain coverage", questions 7-14), D-119, D-120, D-121, ADR-003, ADR-004, ADR-013, ADR-014, D-030, D-032, D-033, D-039, D-053, D-069.
- **Scope:** sub-projects 1 + 2 of three: per-chain addresses (API, data, execution) and the web multi-wallet experience (Reown paid Multiwallet linking), plus the minimum mobile work so mobile keeps working. Sub-project 3 (mobile multi-wallet with several wallets per family on `@walletconnect/sign-client`) is a later spec.
- **Unchanged:** self-custody (ADR-013), funding in USDC on Solana (D-030), one leg signed at a time with server-side checks (ADR-014), fees (ADR-016), Bitcoin linking (web only, ADR-014), backend sessions (ADR-003).

## Outcome

A user links a different wallet per chain, for example Base and BNB Chain from MetaMask, Ethereum and Arbitrum from Trust Wallet, Solana from Phantom. Each linking approval covers the chains the user ticks. On web every connected wallet stays connected (Reown Multiwallet linking) and each signing step automatically uses the wallet linked to that step's chain. Assets are delivered to, and exits are signed from, the address linked to the asset's chain. A chain can move to another wallet only when the user holds nothing on it. A help guide and FAQ explain the model.

## Decisions (this session)

| # | Decision |
|---|---|
| D-120 | One active address **per chain** (replaces one address per family, D-033 / ADR-004's family rule) |
| D-121 | Web: Reown paid Multiwallet linking; React Native has none (SDK 2.0.6), so mobile multi-wallet is a later spec; provider switch is the fallback (FUTURE-PLANS) |
| Reassign | Moving a chain to another wallet is allowed **only when that chain is empty** for the user |
| Linking | Tick chains, one approval per wallet, at sign-up and when linking |
| Polygon | Becomes a linkable and sign-in chain |
| Data model | Approach 1: `wallet_addresses` stays one row per chain; different addresses allowed; switching marks the old row `replaced` |
| Help | Full user guide in help and FAQs (wallets, moving chains, wrong wallet, MetaMask and Solana, phrase import, lost wallet, D-119, per-step approvals) |

## 1. Data model and linking (API)

### Schema (`packages/db`, one migration)

- `chain` enum gains `polygon`. Sign-in and linkable chains become Solana plus Ethereum, Base, BNB Chain, Arbitrum and Polygon (D-032 updated). `chainsInFamily("evm")` includes Polygon.
- `address_status` gains `replaced`. `wallet_addresses` gains `replaced_at timestamptz null` and `replaced_by_address_id uuid null references wallet_addresses(id)`; a check requires both set when status is `replaced`.
- New partial unique index `wallet_addresses_active_chain_key` on `(investment_wallet_id, chain) where status = 'active'`: at most one active address per chain per wallet.
- The global unique index `(chain, address)` stays: an address on a chain belongs to one user, including `replaced` and `disabled` rows (history is never deleted).
- **Backfill:** every active EVM row set whose `verification_method = 'eoa_ecdsa'` gets an active `polygon` row with the same address, method and challenge (today Polygon used the family address). Smart-contract wallet rows get none.

### Challenge and verify

- `POST /v1/auth/challenge` gains `chains: AssetChain[]` (1..5, distinct, all in the address's family; required for `sign_in` and `add_chain_account`; Solana: `["solana"]`). The server stores them on `auth_challenges.chains text[]` and the signed message lists them ("Link this address for: Base, BNB Chain").
- `POST /v1/auth/verify` registers exactly the challenge's chains for the address:
  - `eoa_ecdsa`: any of the listed EVM chains from one signature.
  - `erc1271` / `erc6492`: only the chain the signature was verified on; listing another chain is `VALIDATION_FAILED` at challenge time.
  - `ed25519`: `solana`.
- Refusals:
  - a listed chain already has an active address for this user that differs → `CHAIN_ALREADY_LINKED` (409); the same address → idempotent.
  - the address on a listed chain belongs to another user → `ADDRESS_ALREADY_LINKED` (as now).
  - a chain outside the address's family → `VALIDATION_FAILED`.
- `CHAIN_FAMILY_ALREADY_LINKED` is removed.
- `signableChains` (D-119) keeps its behaviour, stored per row.
- Sign-in: any active address on any linked chain signs in to its account. A logged-out sign-in with an unknown address creates a new user whose wallet gets the listed chains. The session rotates on `add_chain_account` and `reassign_chain` (ADR-003).

### Moving a chain to another wallet (`reassign_chain`)

- Challenge purpose `reassign_chain` with `{ chain, address }` (one chain per request, session required). The signature comes from the **new** address.
- Preconditions, checked in the finalize transaction with the wallet row locked:
  1. the chain has an active address for the user, and it differs from the new one;
  2. no operation of the user is `PLANNED` or `IN_PROGRESS`;
  3. the user holds nothing on that chain: no position has units in a deployment on that chain (position ledger), and the on-chain balance of every registered deployment on that chain at the old address is zero (read through the existing chain adapters outside the transaction, re-checked by the ledger inside it).
- Not empty → `CHAIN_NOT_EMPTY` (409) with the assets found. Busy → the existing `OPERATION_IN_PROGRESS` (409).
- Success: old row `status = 'replaced'`, `replaced_at`, `replaced_by_address_id`; new active row; audit `wallet.chain_reassigned { chain, from, to }`; session rotation.
- Ops tools (`address-disable`, `address-reactivate`) keep working on rows.

### Investability (D-069)

"Linked families" becomes **linked chains**: every constituent's deployment chain needs an active address for the user (Solana always, for funding). Missing → reason `CHAIN_NOT_LINKED` with "Link a wallet for Base".

### `/me`

Each address view gains `walletName` (the `walletProvider` reported at link time, now stored per row as `wallet_name text null`) and `status` includes `replaced` (shown in history only). `wallet.walletProvider` stays for compatibility.

## 2. Execution, portfolio and D-119

- `userAddresses(userId)` returns `Partial<Record<AssetChain, string>>` from active rows (Bitcoin unchanged). `addressOn(addresses, chain)` reads that chain; missing → `CHAIN_NOT_LINKED` (409). All callers stay (plan, quote, submit, gas drop, wallet balance, rebalance, repair, recovery).
- Invest: USDC comes from the Solana address; each asset leg's `toAddress` is its chain's address.
- Sell, rebalance, repair, recovery: `fromAddress` is the asset chain's address; rebalance buys deliver to each chain's address.
- Gas drops go to the leg chain's address. The submit check compares `tx.from` with that chain's address.
- Portfolio, valuation and reconciliation read each deployment's balance at its chain's address. Because of the empty-only rule a position never spans two addresses on one chain; no per-leg address column is needed.
- D-119 runs per chain: the row for each plan chain carries its own `signable_chains`.
- Tests: different addresses per chain through invest, sell, rebalance and recovery planning and quoting; submit refuses the user's address from another chain; `CHAIN_NOT_LINKED`; reassign refused while an operation is open; reconciliation per chain.

## 3. Web multi-wallet

- Enable **Multi Wallet** in the Reown dashboard (Pro). No `createAppKit` change; `@reown/appkit` 1.8.24 already exports `useAppKitConnection(s)`.
- **Linking UI** (sign-up and Profile → Link a wallet): choose a wallet in Reown's list → checkbox screen "Use MetaMask (0xAAA…) for:" with chains the connection approved and not yet linked pre-ticked, chains linked elsewhere greyed out ("linked to Phantom"), smart-contract wallets limited to the verified chain → one signature.
- **Profile → Wallets:** one row per chain (chain, short address, wallet name, Active / Connected / Not connected), **Move to another wallet** (enabled only when the chain is empty; the server decides), **Link a wallet**.
- **Header wallet menu:** connected wallets from `useAppKitConnections` (EVM, Solana, Bitcoin) with the chains each serves, **Reconnect** for linked wallets absent in this browser (`recentConnections` or the stored wallet name).
- **Automatic selection** in `useLegSigner`: leg chain → linked address (`/me`) → connection in that family whose accounts include it → `switchConnection` if not active → switch to the leg chain → sign. Not connected → the step shows "Connect MetaMask (0xAAA…) to sign this Base step", opens Reown's list and retries after connecting. Server checks still decide.
- **Fallback without the paid feature:** one connection per family with the same prompts.
- Tests (Vitest, mocked Reown hooks): selection (active, switch, missing → prompt → retry), checkbox screen (pre-ticked, greyed, smart wallet), wallet list, move enabled only when empty.

## 4. Mobile (until sub-project 3)

- Sign-up and Link a wallet use the same checkbox screen and one approval.
- Profile → Wallets shows the per-chain list with Move to another wallet.
- `useSigner` checks the leg chain's address. A wrong or missing wallet shows "Connect MetaMask (0xAAA…) to sign this Base step" → disconnect that family's current wallet → Reown's list → retry. One wallet per family stays the mobile limit until sub-project 3.
- D-119 warnings per chain.

## 5. Help guide and FAQ

A web help page and mobile help sheets, linked from linking, wallets, signing and D-119 screens:
1. Using several wallets (which wallet serves which chain, linking, the checkbox screen).
2. Moving a chain to another wallet (why it must be empty, steps with an example).
3. "Wrong wallet" / "Connect X to sign this step".
4. Why MetaMask has no Solana on mobile; which wallets support which chains.
5. Importing a recovery phrase into another wallet: confirm the same address appears before deleting the old wallet (derivation paths differ, especially on Solana).
6. Lost a wallet or phrase: what support can do (disable the address) and what nobody can (self-custody).
7. "Your wallet can't sign on a chain" (D-119).
8. Why each step needs its own approval; why signing in moves no money.

## 6. Migration, docs and rollout

- One migration (enum values, columns, index, Polygon backfill, `auth_challenges.chains`, `wallet_addresses.wallet_name`). Existing data stays valid: today's same address per family is a special case.
- Docs: new **ADR-021 "Per-chain addresses"** superseding ADR-004's family rule and D-033; register D-032 (Polygon sign-in), D-069 (linked chains), D-120 and D-121 to IMPLEMENTED; USER-AUTHENTICATION, INVESTMENT-REBALANCING-DRIFT-FIX and USER-FEATURES updated; OPEN-ITEMS: Reown Multi Wallet toggle and Pro plan, device checks.
- Rollout order, each step keeping the app working: (1) migration and API (link with chains, reassign, per-chain `addressOn`, investability); (2) web multi-wallet and linking UI; (3) mobile linking and prompts; (4) help and FAQ; (5) docs.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `CHAIN_ALREADY_LINKED` | 409 | The chain already has a different active address for this user |
| `CHAIN_NOT_LINKED` | 409 | A plan needs a chain with no active address |
| `CHAIN_NOT_EMPTY` | 409 | Reassign refused: holdings on the chain (assets listed) |
| `OPERATION_IN_PROGRESS` | 409 | Existing code, reused: reassign refused while an operation is open |
| `CHAIN_FAMILY_ALREADY_LINKED` | — | Removed |

## Testing

- API: challenge chains validation; verify registers exactly the ticked chains (EOA many, smart wallet one, Solana); `CHAIN_ALREADY_LINKED` and idempotence; sign-in from any linked chain; reassign success, `CHAIN_NOT_EMPTY` (ledger and on-chain), `OPERATION_IN_PROGRESS`, history kept and session rotated; Polygon backfill; investability per chain; planner, quote and submit with different addresses per chain; route table updated for the reassign path.
- app-core: per-chain helpers (linked chains, empty-chain predicate inputs, D-119 per chain).
- Web and mobile: checkbox screen, wallet list, move gating, automatic selection and prompts.
- Manual: Reown dashboard toggle; web with MetaMask + Phantom + Trust (invest, sell, rebalance across wallets); mobile with one wallet per family and the connect prompt.

## Out of scope

Several wallets per family on mobile (sub-project 3); Bitcoin linking changes; moving holdings between addresses on behalf of the user; per-leg address tracking (not needed under the empty-only rule).
