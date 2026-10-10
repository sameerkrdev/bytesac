# ADR-004: Chain-account association

- **Status:** APPROVED (superseded in part by ADR-021: family rule)
- **Date:** 2026-09-29
- **Owners:** Backend / Identity
- **Related:** ADR-021, D-002, D-032, D-033, D-037, D-039; `docs/domains/USER-AUTHENTICATION.md`; spec §5.1-5.2

## Context
One active investment wallet per user holds chain accounts. An EVM key controls the same address on every EVM chain, but a smart-contract wallet (ERC-1271) or counterfactual wallet (ERC-6492) may be deployed differently, or not at all, per chain. A signature therefore proves different things depending on how it is verified.

## Decision
The verification method decides scope.
- `eoa_ecdsa`: the signature ECDSA-recovers to the address. This proves the key, including for EIP-7702-delegated EOAs (recovery, not `getCode`, is the test), and registers all supported EVM chains (Ethereum, Base, BNB Chain, Arbitrum) from one proof (superseded by ADR-021: per chain, only the chains the user ticks are linked).
- `erc1271`: deployed contract wallet verified through `isValidSignature` on the challenge chain; registers only that chain.
- `erc6492`: undeployed wallet verified through the ERC-6492 wrapper on the challenge chain; registers only that chain.
- `ed25519`: Solana; registers `solana`.
- An RPC transport failure during ERC-1271/6492 verification is `VERIFIER_UNAVAILABLE` (fail-closed, retryable); only a definitive revert or non-magic result is an invalid signature.
- Cross-family additions happen only through an explicit logged-in "Add chain account" with a fresh signature and the same session. The operation serializes per wallet with a row lock, so two sessions cannot link two addresses in one family.
- Refusals: address owned by another user (any status) is `ADDRESS_ALREADY_LINKED`; a different address in a family the user already has is `CHAIN_FAMILY_ALREADY_LINKED` (superseded by ADR-021: per chain, only Bitcoin keeps one address per family); a disabled address cannot sign in or be linked elsewhere. A logged-out sign-in with an unknown address always creates a new user.
- Evidence stored per address row: `verification_method`, `verified_on_chain`, `verification_challenge_id`. Challenges referenced as evidence are excluded from retention purge.

## Alternatives considered
- Register all EVM chains for every method — simpler, but wrong for smart wallets that may not exist or may differ on other chains.
- Register only the signed chain for every method — safe but forces EOA users through four signatures.
- Auto-merge accounts when a second family is seen — rejected; merging without an explicit logged-in action is an account-takeover risk.

## Consequences
### Positive
- Registered scope never exceeds what was proven.
- Evidence is auditable per row.

### Negative / trade-offs
- Smart-wallet users need per-chain verification and depend on Alchemy availability; EOA verification is offline.

### Security, financial and operational impact
- Authentication does not grant spending authority. Address uniqueness `(chain, address)` is global, including disabled rows.

## Migration / rollout
Part of the first migration. No user-initiated unlink in release 1 (D-039).

## Validation
Integration tests for each method's scope, stored evidence, idempotent re-link, cross-user conflict races, different same-family address, same smart-wallet address on another chain, RPC failure mapping, and concurrent add-chain-account from two sessions.

## Open questions
- Future multi-wallet feature: independent wallets in one family are out of scope and need their own decision.
