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
- EOA signature (ECDSA-recovered, including EIP-7702-delegated EOAs) proves the key and registers all supported EVM chains from one proof.
- ERC-1271 (deployed contract wallet) and ERC-6492 (undeployed wallet) register only the chain verified; other EVM chains for the same address need their own verification.
- Solana ed25519 registers `solana`.
- **Bitcoin** is link-only, never a sign-in method (`signInChainSchema` excludes it; D-032). A logged-in user links one Bitcoin address with `POST /v1/me/chain-accounts/bitcoin/challenge` and `/verify` (purpose `add_chain_account`, 10 attempts per hour per user). The server builds the BIP-322 `to_sign` PSBT with the challenge, the wallet only signs it, and the server verifies the witness (P2WPKH, P2TR, P2SH-P2WPKH); a BIP-137 message signature is accepted as a fallback for legacy, P2SH-P2WPKH and P2WPKH addresses. The same one-per-family, not-linked-elsewhere and session-rotation rules apply (ADR-014).
- A different chain family is added only through an explicit, logged-in "Add chain account" with a fresh signature. Linking is serialized per wallet, so two sessions cannot link two addresses in one family.
- Refused: an address that belongs to another user (`ADDRESS_ALREADY_LINKED`), or a different address in a family the user already has (`CHAIN_FAMILY_ALREADY_LINKED`). A logged-out sign-in with an unknown address always creates a new user.

## Unlink and recovery (release 1)
- No user-initiated unlink or address removal; every user keeps at least one verified address.
- A compromised or inaccessible wallet is handled by support: an audited ops command disables the address and revokes the user's sessions. A disabled address cannot sign in or be linked to another user. Reactivation is ops-only and audited.
- Replacement of the investment wallet is the future wallet-migration feature (D-039).

## Invariants
- Do not activate an address solely because it was typed.
- Do not merge unrelated wallets without proof and explicit flow.
- Do not grant manager or organization permissions as a side effect of ordinary login.
- Keep authentication separate from execution authority.
