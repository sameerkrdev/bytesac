# ADR-021: Per-chain addresses and web multi-wallet

- **Status:** APPROVED
- **Date:** 2026-10-10
- **Owners:** Product owner (user), engineering
- **Related:** D-032, D-033, D-069, D-119, D-120, D-121; ADR-004 (superseded in part), ADR-014; `docs/superpowers/specs/2026-10-09-per-chain-addresses-multi-wallet-design.md`; `docs/domains/USER-AUTHENTICATION.md`

## Context
ADR-004 allowed one address per chain family. A user with MetaMask for Base and BNB Chain and Phantom for Ethereum, or a user with a smart wallet that exists on one chain only, could not hold the addresses they actually use. Polygon was supported for assets but could not be linked. Execution, gas, exits and portfolio all assumed one address per family.

## Decision
- **One address per chain.** `wallet_addresses` holds one active row per (wallet, chain), enforced by a partial unique index. The chain enum gains `polygon`; `address_status` gains `replaced`; rows gain `wallet_name`, `replaced_at` and `replaced_by_address_id`; challenges record the requested `chains`.
- **The user ticks the chains.** A challenge may carry `chains`; the message names them. Explicit chains are strict (a chain that already has an address returns `CHAIN_ALREADY_LINKED`). Omitting `chains` keeps the old behaviour: an EOA or ed25519 proof covers its whole family, a smart wallet only the connected chain, and chains that already have an address are skipped. Bitcoin is unchanged (one address, `CHAIN_FAMILY_ALREADY_LINKED`).
- **Sign-in by address.** An EOA or ed25519 address is looked up across its family, so the same key always reaches the same account. A contract wallet is matched only on the chain it was verified on; elsewhere it is `ADDRESS_ALREADY_LINKED`. Replaced or disabled addresses are refused (`ADDRESS_DISABLED`). Status is re-checked under the wallet lock.
- **Move a chain to another wallet, only when it is empty.** `POST /v1/auth/reassign` needs a session. The new address signs and the chain's current address signs the same message (`previousSignature`, a step-up so a stolen session alone cannot redirect a chain). The move is refused (`CHAIN_NOT_EMPTY`, with the asset list) unless there is no open operation, no ledger units on that chain, and every registered non-native deployment has zero balance at the old address. Native gas dust does not block. A failed balance read returns 503 (fail closed). Plan creation takes a shared lock on the wallet row so a plan cannot start during a move. The old row becomes `replaced` (reason `chain_reassigned`), the audit event is `wallet.chain_reassigned`, and the session rotates.
- **Execution per chain.** `userAddresses` returns the active address per chain and `addressOn` fails with `CHAIN_NOT_LINKED` (409) when none exists. Investability reports `requiredChains` and `CHAIN_NOT_LINKED` reasons. D-119 signable-chain checks run per chain.
- **Web multi-wallet.** Reown Multiwallet keeps several wallets connected. Before each step the web client switches to the wallet that owns the leg's address and reads its provider live. If the right wallet is not connected, a Connect wallet prompt retries once through a fresh quote.
- **Mobile.** Same linking, per-chain list, move flow and Connect wallet prompt, but one connected wallet per family (namespace switching). A mobile multi-wallet layer stays in FUTURE-PLANS.

## Alternatives considered
- Keep one address per family: no change, but multi-wallet users stay blocked.
- Separate addresses and assignments tables: more flexible, but two tables to keep consistent for no current need.
- A default family address plus per-chain overrides: two sources of truth for "which address".
- Reassign at any time and track former addresses: positions could span two addresses on one chain, and every balance, exit and recovery path would have to read both.

## Consequences
### Positive
- A position on a chain never spans addresses.
- Polygon is linkable; Bitcoin is unchanged.
- Users can mix wallets by chain.

### Negative / trade-offs
- A chain with assets cannot be moved; the user sells or exits first.
- Web needs the paid Reown Multiwallet plan; without it web has one connection per namespace.
- Mobile cannot hold two wallets in one family.

### Security, financial and operational impact
- Wallet control is still not spending authority. Reassign needs both the new and the current address to sign.
- Known gaps (OPEN-ITEMS): `add_chain_account` on a chain with no address needs only the session and the new wallet; the per-address challenge rate limit is keyed on the public address; an attacker who can deploy a contract at a victim's counterfactual address on another chain could link that (chain, address) first.

## Migration / rollout
Migration 0022. The Polygon backfill is not part of it (a new enum value cannot be used in the same transaction): after migrating, run `pnpm --filter api ops:backfill-polygon` once per environment. It is idempotent and uses the earliest EOA EVM address per wallet. Existing users keep their addresses; the old family rows now read as per-chain rows.

## Validation
API integration tests for linking (explicit and legacy), sign-in lookup, refusals, reassign (every empty check, balance failure, step-up, race with plan creation), execution per chain and investability. Unit tests in app-core, web and mobile. Device checks are in OPEN-ITEMS.

## Open questions
- Step-up for `add_chain_account` on an unlinked chain.
- Mobile custom multi-wallet layer (FUTURE-PLANS).
