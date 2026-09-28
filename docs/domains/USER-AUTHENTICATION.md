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
Reown/WalletConnect handles wallet connection. Backend handles signature verification, wallet identification, account orchestration and sessions. Supabase is the application user/session layer as specified in the source.

For EVM, use SIWE-compatible verification; for Solana, SIWS-compatible verification. For any other chain, define a chain-specific verification flow. Verify challenge/nonce, signature, domain and expiry. Wallet control is not spending permission.

## Sessions
Implement logout, expiry and re-authentication according to the source flow. Keep session invalidation server-enforced.

## Invariants
- Do not activate an address solely because it was typed.
- Do not merge unrelated wallets without proof and explicit flow.
- Do not grant manager or organization permissions as a side effect of ordinary login.
- Keep authentication separate from execution authority.
