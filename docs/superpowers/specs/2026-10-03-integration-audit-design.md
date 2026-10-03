# Spec 14 — Third-Party Library and Provider Integration Audit (Design)

- **Date:** 2026-10-03
- **Status:** Approved in conversation (2026-10-03)
- **Series:** Spec 14 — after Spec 13; roadmap 15–19 follows
- **Sources:** official documentation of every item in §3 (fetched during the audit; record URL and date), `docs/OPEN-ITEMS.md` (real-key and pre-launch checks), ADR-002, ADR-006, ADR-010..ADR-018, `apps/api/README.md`, `apps/web/README.md`.

## 1. Intent

Check every third-party library and provider integration against its current official documentation, fix real defects with tests, and confirm response shapes with read-only live calls where safe. Output: one audit document and fewer pre-launch unknowns. No new features.

**Success criteria**
1. Every item in §3 has an audit section with the doc pages and versions checked and a finding per check (§4).
2. Every finding classified "wrong" or "risky" is fixed with a regression test, or deferred to OPEN-ITEMS with a reason.
3. Live read-only checks resolve as many OPEN-ITEMS real-key checks as possible; the rest stay open and say why.
4. Nothing is signed, broadcast, sent or stored at a provider; no production data touched; tests still mock every provider.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Output | Written audit + fixes; design questions and major upgrades → OPEN-ITEMS or the user; key-only checks stay pre-launch items (A). |
| 2 | Live calls | Read-only only, via a throwaway script (not committed): LI.FI keyless public endpoints with addresses that hold nothing; Alchemy/CoinMarketCap only if keys are present in the local `apps/api/.env`; never Resend/Twilio/FCM/R2 writes, signing or broadcasting (A). |
| — | Ruling: upgrades | Patch/minor only when needed to fix a documented deprecation or a security advisory; exact pins; release-age rule respected (no `minimumReleaseAgeExclude`); majors → OPEN-ITEMS. |
| — | Ruling: advisories | `pnpm audit --prod` results recorded in the audit; fixable ones handled under the upgrade rule. |
| — | Ruling: keys | Never printed, logged or committed; results reported without secrets. |

## 3. Inventory

| Group | Items |
|---|---|
| Providers | LI.FI REST API; Alchemy RPC (Solana, Ethereum, Base, BNB, Arbitrum, Polygon, Bitcoin endpoints); CoinMarketCap; Resend; Twilio Verify; Firebase Admin (FCM) and Firebase Web messaging; Gemini (`@google/genai`); Cloudflare R2 via `@aws-sdk/client-s3` (+ presigner) |
| Chain and wallet libraries | `@solana/web3.js`, `@scure/btc-signer`, `@noble/curves`, `@noble/hashes`, `viem`, `wagmi`/`@wagmi/core`, Reown AppKit (web adapters: wagmi, solana, bitcoin; React Native AppKit) |
| Infrastructure | BullMQ, ioredis, Drizzle ORM + `pg`, `pg_cron`, `pgvector`, envalid, winston + morgan, rate-limiter-flexible, http-errors, zod, uuid |
| Frameworks and tooling | Express 5, Next.js 16, Expo 57 (+ Expo Router, SecureStore), Vitest, turbo, tsup, pnpm (overrides, allowBuilds, minimum release age) |

The implementer confirms the exact installed versions from the lockfile; any library found in `package.json` files but missing here is added to the audit.

## 4. Checks per item

1. API usage: calls, parameters, units, defaults match the docs for the installed version.
2. Deprecated or removed APIs (and their replacements).
3. Errors, timeouts, rate limits and retries handled as the docs advise; unknown outcomes never retried blindly (ADR-013).
4. Idempotency, webhook/secret handling, credential scope, CSP/CORS where relevant.
5. Configuration and env validation (envalid) match the documented requirements.
6. Version: exact pin, release date, known advisories.
7. Test mocks match documented or live-observed response shapes.

## 5. Live read-only verification

A throwaway script under the scratch area (never committed) performs:
- **LI.FI (no key):** `GET /v1/quote` and `POST /v1/advanced/routes` for representative pairs (USDC Solana → SOL, USDC Solana → ETH on Base, ETH Base → USDC Solana, USDC Solana → native BTC) with zero-balance addresses; `GET /v1/status` with a known public tx hash; `GET /v1/tools`, `/v1/tokens`, `/v1/connections`; `GET /v2/analytics/transfers` if accessible. Confirm: `toAddress` echo, Solana `svmSponsor` behavior and transaction encoding, no-SOL refusal shape, 1001 / no-route / price-impact error codes and messages, deny-parameter encoding (quote query vs routes body), `feeCosts` shape and `included`, `maxPriceImpact` honored, Bitcoin PSBT encoding and output shape, analytics timestamp units.
- **Alchemy / CoinMarketCap:** only with keys present locally; read calls only (`getBalance`, `getTokenSupply`, token balances, Bitcoin address/tx lookups; CMC `quotes/latest` for a few ids including a missing one).
- Never: Resend, Twilio, FCM, R2 writes, signing, broadcasting.

Results go into the audit and update the matching OPEN-ITEMS items (tick verified ones; record what remains).

## 6. Output

- `docs/engineering/INTEGRATION-AUDIT.md`: per item — docs checked (URL + date), installed version, findings per check (OK / deprecated / wrong / risky / unverified), live-check result, fix commit or OPEN-ITEMS reference.
- Fixes in the owning module with a regression test each; mocks updated to the confirmed shapes (assertions about our behavior unchanged unless the finding shows our behavior was wrong — then the test changes with the fix and the reason).
- Docs (ADRs, READMEs) rewritten in place where documented behavior changes; OPEN-ITEMS updated.

## 7. Out of scope

New features, major upgrades (→ OPEN-ITEMS), UI work (Specs 15/17), deployment (Spec 16), sandbox sends (not chosen).

## 8. Execution shape

Five tasks: (1) money-path providers and chain libraries (LI.FI, Alchemy, CoinMarketCap, Solana, Bitcoin, EVM) + live checks + fixes; (2) messaging, AI and storage (Resend, Twilio, FCM admin, Gemini, R2) + fixes; (3) infrastructure and frameworks (BullMQ, Redis, Drizzle/pg, pg_cron/pgvector, envalid, logging, rate limits, Express, Vitest, turbo, tsup, pnpm) + `pnpm audit` + fixes; (4) web and mobile client integrations (Next.js, Expo, AppKit web/RN, wagmi/viem, Firebase web, signing flows) + fixes; (5) audit document assembly, docs and OPEN-ITEMS updates, full gate with `--force`.
