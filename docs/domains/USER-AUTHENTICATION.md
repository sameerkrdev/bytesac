# User Authentication — Domain Context

Source: `User-Authentication-Flow.txt`

## Scope
This flow covers normal users/investors. Fund-manager applications, organizations, verification, team membership and manager permissions are separate systems.

## Identity model
- A user account is distinct from wallets, chain addresses, organization membership and manager status.
- The supplied auth specification describes one active investment wallet per normal user, with chain-specific wallet accounts/addresses associated with it. A different independent wallet is not simply another chain account.
- Support connecting another chain account and the documented wallet migration flow without silently changing identity ownership.
- Email/phone and notification preferences are separate account data.

## Authentication
Reown AppKit handles wallet connection. The backend verifies SIWE (EVM) and SIWS (Solana) signatures and issues backend-managed sessions. Supabase is the database only, not the session issuer. This supersedes the source's Supabase-session wording (see D-003 and ADR-003).

For EVM, use SIWE-compatible verification; for Solana, SIWS-compatible verification. For any other chain, define a chain-specific verification flow. The challenge request body is `{ purpose, chain, address }`; the chain family is derived from the chain. The server stores the exact message and verifies against it only; it checks nonce, signature, domain and expiry, and consumes each challenge once (`pending → processing → consumed / rejected`, D-037). For EVM smart wallets, an RPC transport failure is a retryable `VERIFIER_UNAVAILABLE` (fail-closed); only a definitive revert or non-magic result is an invalid signature. Wallet control is not spending permission.

## Sessions
- Token: opaque 32 random bytes, stored only as a keyed hash.
- Web: httpOnly cookie through the same-origin Next proxy; 12 h idle / 7 d absolute. Mobile: bearer token in secure storage, identified by header `X-Client: mobile`; 7 d idle / 30 d absolute. Expiry is evaluated with database time on every request.
- Idle expiry renews (sliding) without changing the token. The token is rotated on security events, currently a successful "Add chain account"; the old session is revoked, and a revoked session cannot be rotated again.
- `logout` revokes the current session; `logout-all` revokes all of the user's sessions; a user can revoke any one of their own sessions. Suspending a user revokes all their sessions. Logout does not change wallets or addresses.
- Expiry forces wallet re-authentication. Session invalidation is server-enforced.

## Chain-account association
The verification method decides scope (D-033, ADR-004):
- EOA signature (ECDSA-recovered, including EIP-7702-delegated EOAs) proves the key. It covers the EVM chains the user ticks (Ethereum, Base, BNB Chain, Arbitrum, Polygon) from one proof.
- ERC-1271 (deployed contract wallet) and ERC-6492 (undeployed wallet) cover only the chain verified; other EVM chains for the same address need their own verification.
- Solana ed25519 covers `solana`.
- **Bitcoin** is link-only, never a sign-in method (`signInChainSchema` excludes it; D-032). A logged-in user links one Bitcoin address with `POST /v1/me/chain-accounts/bitcoin/challenge` and `/verify` (purpose `add_chain_account`, 10 attempts per hour per user). The server builds the BIP-322 `to_sign` PSBT with the challenge, the wallet only signs it, and the server verifies the witness (P2WPKH, P2TR, P2SH-P2WPKH); a BIP-137 message signature is accepted as a fallback for legacy, P2SH-P2WPKH and P2WPKH addresses. Bitcoin keeps one address per family (`CHAIN_FAMILY_ALREADY_LINKED`) and the session-rotation rules (ADR-014).
- **One address per chain (D-120, ADR-021).** An account has at most one active address per chain, so it can use different wallets on different chains (for example MetaMask for Base and BNB Chain, Phantom for Ethereum and Solana). The challenge body may carry `chains`; the signed message names them.
  - With `chains`, linking is strict: a chain that already has an address is refused with `CHAIN_ALREADY_LINKED`.
  - Without `chains` (older clients), an EOA or ed25519 proof covers its whole family, a smart wallet covers the connected chain, and chains that already have an address are skipped.
  - A different chain family is added only through an explicit, logged-in "Add chain account" with a fresh signature. Linking is serialized per wallet.
- **Sign-in** looks up an EOA or ed25519 address across its whole family, so the same key always reaches the same account. A contract wallet matches only on the chain it was verified on; on another chain it is `ADDRESS_ALREADY_LINKED`. An unknown address on a logged-out sign-in creates a new user.
- **Move a chain to another wallet** (`POST /v1/auth/reassign`, session required). The new address signs, and the chain's current address signs the same message (`previousSignature`). It is allowed only when the chain is empty: no open operation, no ledger units on the chain, and zero on-chain balance at the old address for every registered non-native asset (gas dust in the native coin does not block). Otherwise `CHAIN_NOT_EMPTY` lists the assets (`error.details.assets`); if a balance cannot be read the call returns 503 and nothing moves. The old row becomes `replaced` (reason `chain_reassigned`), the audit event is `wallet.chain_reassigned`, and the session rotates. A replaced address cannot sign in or be linked again.

| Case | Result |
|---|---|
| Address belongs to another user | `ADDRESS_ALREADY_LINKED` |
| Address is disabled or was moved to another wallet | `ADDRESS_DISABLED` |
| Chain already has an address (explicit `chains`) | `CHAIN_ALREADY_LINKED` |
| Bitcoin: a different address in the family | `CHAIN_FAMILY_ALREADY_LINKED` |
| Move while the chain holds assets, units or an open operation | `CHAIN_NOT_EMPTY` |
| Move while a balance cannot be read | 503, nothing changes |
| Plan or sell on a chain with no address | `CHAIN_NOT_LINKED` (409) |

- The families may come from **different wallet apps**. A wallet only approves the families it supports over WalletConnect: MetaMask Mobile approves `eip155` only (its Solana adapter is unreleased as of 2026-10), so a MetaMask user links a second wallet for Solana. Investing signs only on Solana (funding is USDC on Solana, D-030); EVM sells and rebalances sign on EVM.
- Web keeps several wallets connected (Reown Multiwallet, a paid dashboard feature) and picks the one that owns each step's address. Mobile has one connected wallet per family; the Connect wallet prompt asks the user to switch before a step that needs another wallet.
- Verify accepts an optional `signableChains` (the asset chains the connected wallet approved; mobile reads them from the WalletConnect session accounts for the signed address, Phantom/Solflare deeplinks report Solana). The server keeps only the signed address's family and stores it on every row of that address; omitted keeps the current value (D-119). It is client-reported and only drives warnings. The web client reports nothing yet.
- Client guards: the Add chain account sheet shows the chains still without an address and disables Sign when the connected address cannot be used (for example it already belongs to another account). "Use a different wallet" drops only the wallet connection; the Bytesac session stays.

## Unlink and recovery (release 1)
- No user-initiated unlink or address removal; every user keeps at least one verified address.
- A compromised or inaccessible wallet is handled by support: an audited ops command disables the address and revokes the user's sessions. A disabled address cannot sign in or be linked to another user. Reactivation is ops-only and audited.
- Replacement of the investment wallet is the future wallet-migration feature (D-039).

## Invariants
- Do not activate an address solely because it was typed.
- Do not merge unrelated wallets without proof and explicit flow.
- Do not grant manager or organization permissions as a side effect of ordinary login.
- Keep authentication separate from execution authority.
