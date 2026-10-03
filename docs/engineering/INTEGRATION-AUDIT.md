# Integration Audit (Spec 14, 2026-10-03)

Audit of every third-party library and provider integration against its official documentation. Docs were read on 2026-10-03; versions are the ones installed in the lockfile. Open actions are tracked in `OPEN-ITEMS.md` (section numbers below); nothing is left only in this file. No secret or key value appears here.

**Status key:** OK / deprecated / wrong (a defect, fixed) / risky (a weakness, fixed or deferred) / unverified. **Checks per item:** 1 API usage, 2 deprecated features, 3 errors, timeouts and retries, 4 idempotency, secrets and scope, 5 configuration and env, 6 version and advisories, 7 mocks against real shapes.

**Method.** LI.FI (keyless) and Alchemy (valid key, read-only calls, no `sendtx`) were checked live with locally generated zero-balance addresses and at most one request per second; saved outputs were scrubbed of keys and grepped. Every other provider was checked against its documentation and installed types only (Resend, Twilio, FCM, Gemini and R2 are never called; CoinMarketCap was not run: no key). Real-key checks that remain are listed in `OPEN-ITEMS.md` section 5.

## Summary

| Item | Installed | Status | Open actions (OPEN-ITEMS) |
|---|---|---|---|
| LI.FI REST (v1, v2 analytics) | REST | Four defects fixed (no-SOL refusal, unknown deny key, `toAmountMin` rounding tolerance, token verification flag), analytics limit and nothing else changed | Bitcoin PSBT, 1001 shape, refund-needed status, `svmSponsor` on other leg types, plan-time estimate cannot use `svmSponsor` (section 5, section 7 Spec 14) |
| Alchemy EVM and Solana RPC | REST/JSON-RPC | OK | Stale token-account rent constant (section 7 Spec 14) |
| Alchemy Bitcoin | REST/JSON-RPC | Unverified: REST answers 401 without the UTXO add-on | UTXO add-on, `/sendtx/` 4xx mapping (section 1, section 7 Spec 14) |
| CoinMarketCap | REST | Fixed (`skip_invalid=true`); shape unverified without a key | Real key check (section 5) |
| @solana/web3.js | 1.99.0 | OK (latest, maintenance branch) | Rent constant; `stream-json` advisory (section 7 Spec 14) |
| @scure/btc-signer, @noble/curves, @noble/hashes | 2.4.1 / 2.4.0 / 2.4.0 | OK (latest) | LI.FI Bitcoin PSBT (section 5) |
| viem | 2.56.9 | OK (2.57.2 exists, no advisory) | None |
| Resend | 6.30.0 | OK | None |
| Twilio Verify | 6.1.1 | OK | None |
| Firebase Admin (FCM) | 14.5.0 | OK; `tokens` deprecated (FIDs) | Installation ID migration, token cap, `invalid-registration-token` (section 7 Spec 9, Spec 14) |
| Gemini (`@google/genai`) | 2.24.0 | OK; default model shuts down 2027-05-07 | Model switch after a forced-tool-call check (section 7 Spec 14) |
| Cloudflare R2 (`@aws-sdk/client-s3`) | 3.1142.0 | OK | None |
| BullMQ | 6.3.10 | Fixed (fail-fast producers, error listeners) | None |
| ioredis, rate-limiter-flexible | 6.0.0 / 11.2.1 | OK (fail closed by design) | None |
| Drizzle, drizzle-kit, postgres.js | 0.45.3 / 0.31.11 / 3.4.9 | OK | Role `statement_timeout` (section 7 Spec 14) |
| pg_cron, pgvector | migrations 0002, 0009 | OK | ANN index (section 6) |
| envalid, winston, morgan, http-errors, zod, cookie-parser | 8.2.0, 3.19.0, 1.12.1, 2.0.1, 4.6.5, 1.4.7 | OK | None |
| Express | 5.2.1 | OK | None |
| Vitest, tsup, tsx | 5.0.2, 8.5.1, 4.23.15 | OK | Windows worker crash (section 6) |
| Turborepo, pnpm | 2.11.5, 11.25.0 | OK; obsolete release-age exclusions | Housekeeping (section 7 Spec 14) |
| Next.js | 16.3.8 (was 16.3.4) | Critical advisory fixed by upgrade; CSP directives added (report-only) | Collect and enforce CSP (section 6) |
| Reown AppKit web | 1.8.24 | OK; transitive advisories; Leather signs one input | Leather multi-input check, advisories (section 5, section 7 Spec 14) |
| wagmi / viem (client) | 2.19.5 / 2.56.9 | OK (wagmi throws on a reverted approval); explicit status guard added as defense in depth | USDT-style allowance reset (section 7 Spec 14) |
| Firebase web messaging | firebase 12.19.0 | OK; `getToken` deprecated; service-worker version now tested | Installation ID migration (section 7 Spec 14) |
| Expo SDK 57 mobile | expo ~57.0.25 | OK; iOS Keychain survives reinstall | First-launch clear decision, `EXPO_PUBLIC_API_URL` in EAS (section 7 Spec 14) |
| `pnpm audit --prod` | n/a | 48 advisories (1 critical) before, 47 (0 critical) after; the rest transitive and deferred | Re-audit on each Reown, Expo or firebase bump (section 7 Spec 14) |

## Behavior changes made by the audit

- LI.FI no-SOL refusal is read from `errors.filteredOut[].reason` (HTTP 404, code 1002) when no route failed for another reason; `svmSponsor` does not avoid it for tools that need a temporary token account (observed with `mayanFastMCTP` only; ADR-017).
- Deny keys unknown to `/v1/tools` are dropped before sending (an unknown key made LI.FI fail the whole request with code 1011).
- The quote acceptance check allows `toAmountMin` to sit below `toAmount x (1 - slippage)` by at most max(1 ppm, 10^(decimals-8), 1 unit); a weaker minimum is still refused and the stored minimum is LI.FI's own (ADR-014, ADR-017).
- A deny key unknown to `/v1/tools` is also logged once per key per process-hour and shown as stale in ops routing (fails open for a renamed tool; user ruling).
- LI.FI analytics requests `limit=100`; only `verificationStatus === "verified"` counts as a verified token; CoinMarketCap sends `skip_invalid=true`.
- BullMQ queues use `enableOfflineQueue: false` (producers fail fast during a Redis outage after the first successful connection; a cold start with Redis down still waits for the first connection; `enqueue` logs and moves on); queues, workers and the rate-limit Redis client log connection errors through winston.
- The web signer checks the approval receipt status explicitly (defense in depth: `@wagmi/core` 2.22.1 `waitForTransactionReceipt` already throws on a revert); a failed approval sends nothing else.
- `next` 16.3.4 to 16.3.8 (exact pin); report-only CSP gains `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.

## Money-path providers and chain libraries

### LI.FI REST API (v1 `/quote` `/advanced/routes` `/status` `/tools` `/tokens` `/connections` `/gas/suggestion`, v2 `/analytics/transfers`; keyless)

Docs checked (2026-10-03): https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer, .../advanced/get-a-set-of-routes-for-a-request-that-describes-a-transfer-of-tokens, .../check-the-status-of-a-cross-chain-transfer, .../fetch-all-known-tokens, .../get-a-paginated-list-of-filtered-transfers, https://docs.li.fi/api-reference/error-codes. Note: the doc pages do not mention `svmSponsor`, `/tokens` `verificationStatus` or the `errors.filteredOut` reason strings; live output is the evidence for those.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote params, units | OK | `fromAmount` base units, `slippage` decimal, `integrator`, `maxPriceImpact`, repeated `denyBridges`/`denyExchanges` all accepted (live 200). `svmSponsor` works: v0 versioned tx, base64 in `transactionRequest.data`, 2 required signatures, fee payer = sponsor at index 0, appears once in static keys, only as first account of ATA `CreateIdempotent` (data byte 1). ComputeBudget limit 1,400,000 + price 16001 micro-lamports (about 22k lamports, under our 1M cap). |
| 1 | `toAddress` echo | OK | Echoed in `action.toAddress` (EVM lowercased, Solana/Bitcoin as sent); our check is case-insensitive for `0x`. |
| 1 | Routes (`/advanced/routes`) | OK | Works without `fromAddress` for Solana sources (live 200); `options.bridges.deny` / `exchanges.deny` arrays accepted; `maxPriceImpact` honored for real impact (900T-micro USDC trade: `routes: []`, reason "Price impact of 87.8% is higher than the max allowed 5%"). |
| 1 | Deny encoding | OK | Quote: repeated query params (live 200). Routes: body arrays (live 200). Mayan keys: `mayan`, `mayanMCTP`, `mayanFastMCTP` (prefix `mayan` rule confirmed). |
| 1 | Unknown deny key | **risky -> fixed** | Any key not in `/tools` makes LI.FI answer 400 code 1011 for the whole request (quote and routes), so a retired tool kept in `route_policy_entries` would fail every route. Fix: `routeDenyList` drops keys absent from the cached `/tools`. |
| 1 | No-SOL refusal | **wrong -> fixed** | Live (zero-SOL wallet, only `mayanFastMCTP` allowed, with and without `svmSponsor`): HTTP 404, code 1002 "No available quotes for the requested transfer", cause only in `errors.filteredOut[].reason` = "SOL balance insufficient to cover temporary token account creation". `svmSponsor` does NOT avoid it for this tool (the evidence is `mayanFastMCTP`-only; with the full tool set the same wallet got sponsored layerswap and jupiter quotes). Our matcher read only `message`, so the user got ROUTE_UNAVAILABLE instead of 409 SOL_REQUIRED. Fix: SOL_REQUIRED when every filtered reason says so and no route failed for another reason (`errors.failed` empty). |
| 1 | Price-impact no-route | OK (shape updated) | Routes: `routes: []` + `unavailableRoutes.filteredOut[].reason` (matched by `/price.?impact/`). Quote 1002 body is `errors: { filteredOut: [{ overallPath, reason }], failed: [...] }`, not an array (mock updated). |
| 1 | `toAmountMin` rounding | **risky -> fixed** | `toAmountMin` sits a hair under `toAmount x (1 - slippage)`: layerswap 350,000,000 wei below on an 18-decimal output (`raw-quote_deny_repeated_valid.json`; same trade, two requests one second apart: one passed the old 1-unit check, one failed). Layerswap amounts are multiples of 1e10 wei, so the gap can reach about 5e9 wei (2.7 ppm on a 0.00185 ETH leg). Fix: tolerance max(1 ppm, 10^(decimals-8), 1 unit). A weaker minimum is still refused. |
| 1 | Gas suggestion | unverified (unused) | `/v1/gas/suggestion/{chain}` returns `recommended`/`limit`; we do not call it. |
| 1 | Analytics | **risky -> fixed** | Default `limit` is 10 with cursor pagination (`hasNext`, `next`); the +-24 h window for an active wallet could hide the leg. Live: `limit` 50/100/1000 accepted (200). Fix: request `limit=100`. Timestamp unit confirmed seconds (`sending.timestamp` 1791023637). Keyless access works. |
| 1 | `/tokens` verification flag | **risky -> fixed** | Each token carries `verificationStatus` ("verified" / "unverified", with a provider breakdown); not in the docs. We treated "listed" as "verified" (e.g. SOL itself is listed but `unverified`). Fix: only `verificationStatus === "verified"` is verified; cache key bumped to `v2`. `flagged` still never produced (no value seen). |
| 1 | `/status` | OK | Statuses and substatuses match docs (DONE/COMPLETED, PARTIAL, REFUNDED, REFUND_IN_PROGRESS). `txHash` may be sending hash, destination hash or step id (docs). A real DONE body parses through our schema. Unknown hash returns 200 per docs. |
| 3 | Errors, timeouts, retries | OK | 10 s timeout, no retry. Error body `{ message, code, errors }` confirmed; codes 1001-1013 per docs; 1003 "No UTXOs found for any sender addresses" (Bitcoin source, unfunded address) and 1002 alternate for the same request and both map to ROUTE_UNAVAILABLE. Rate-limit headers `x-ratelimit-remaining` seen (keyless: about 75 for `/quote` and `/advanced/routes`, about 100 for `/tools` and analytics). |
| 4 | Secrets | OK | `x-lifi-api-key` header only; never logged. |
| 5 | Config | OK | `LIFI_API_KEY` empty disables routing; `LIFI_INTEGRATOR` default `bytesac`. |
| 6 | Version | OK | REST, versioned by path (v1/v2). |
| 7 | Mocks | updated | No-SOL (live shape) and price-impact (`errors` object) mocks now follow live output; analytics mock now expects `limit`; tokens mock carries `verificationStatus`. All parsed live bodies (4 quotes, 3 routes, 1 status) were fed through our real `lifi.quote/estimate/status` with fetch stubbed: all accepted except the rounding case above. |

Live check: keyless, zero-balance locally generated addresses, 6+6+7+5+2+2+1 = about 30 requests, <= 1/s. Not verified: Bitcoin-source PSBT encoding/outputs (an unfunded address gets 404 1003/1002; a quote needs UTXOs and we will not use a third party's address), exact 1001 shape (unfunded Solana/EVM wallets did not trigger it), `NOT_PROCESSABLE_REFUND_NEEDED` status (needs a real transfer), `FAILED` with receiving token.

### Alchemy RPC: Solana, Ethereum, Base, BNB, Arbitrum, Polygon (JSON-RPC) (key valid)

Docs checked (2026-10-03): https://solana.com/docs/rpc/http/sendtransaction, https://solana.com/docs/rpc/http/getsignaturestatuses; Alchemy hosts verified live.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Hosts | OK | `eth-mainnet`, `base-mainnet`, `bnb-mainnet`, `arb-mainnet`, `polygon-mainnet`, `solana-mainnet` all answer (`eth_blockNumber`, `getBalance`, `balanceOf`, `getCode`). |
| 1 | Multicall3 | OK | Code present at `0xcA11bde0...CA11` on Base, BNB, Polygon (checked); `readTokenMetadata` depends on it. |
| 1 | Receipt of unknown hash | OK | `result: null` (viem maps to `TransactionReceiptNotFoundError`, handled). |
| 1 | Historical balance | OK | `eth_getBalance` at old blocks answers on Base and Ethereum (needed by `evmNativeReceived`); recent-block behavior not separately checked. |
| 1 | Solana `getTokenSupply` | OK | USDC: `value.decimals` 6. A non-mint account, a missing account and a garbage address all return error -32602 (messages "not a Token mint", "could not find account", "Invalid"), which our code maps to "not a mint" (null); timeouts and others throw 503. |
| 1 | Solana reads | OK | `getBalance` finalized, `getTokenAccountsByOwner` (mint filter, jsonParsed, finalized), `getSignatureStatuses` (unknown -> `[null]`), `getLatestBlockhash`, `isBlockhashValid` (false for unknown), `getAccountInfo` (missing -> null): shapes as used by `solana-tx.ts`. |
| 1 | Token-account rent | **risky (deferred)** | `getMinimumBalanceForRentExemption(165)` = 1,488,440 lamports live; our constant is 2,039,280. The constant over-reserves (safe direction) but is stale; deferred to OPEN-ITEMS (read it from RPC or refresh the constant together with the gas-cap review). |
| 3 | Errors/timeouts | OK | 5 s timeouts, one viem retry, transport failure never becomes "no". |
| 4 | Secrets | OK | Key only in URL path of server-side calls; saved outputs scrubbed. |
| 5 | Config | OK | `ALCHEMY_API_KEY` is `nonEmpty` in envalid. |
| 7 | Mocks | OK | Shapes above match `chain-mocks`; no change needed. |

Live check: read-only RPC only, about 46 calls. 

### Alchemy Bitcoin (Blockbook-style REST `/api/v2/address`, `/tx`, `/sendtx/` in `providers/bitcoin.ts`)

Docs checked (2026-10-03): https://www.alchemy.com/docs/bitcoin/utxo-migration-guide (address path `/api/v2/address/{address}`, fields `balance` etc.; "Purchase the UTXO add-on for your desired chain from the Alchemy dashboard"), https://www.alchemy.com/docs/reference/bitcoin-api-faq, https://www.alchemy.com/blog/alchemy-now-supports-bitcoin.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | REST address/tx/sendtx | **unverified** | Live: every `/api/v2/...` call (address, tx, malformed) answers 401 `{"error":"UTXO requests are not allowed."}`. Per the migration guide this needs the UTXO add-on on the Alchemy account (not enabled for this key). Paths are documented only for `/address` and `/balancehistory`; `/tx` and `/sendtx/` rest on "Blockbook parity". Action: buy the add-on, then re-run. |
| 1 | Core JSON-RPC | OK (not used) | Same host, JSON-RPC works: `getblockcount`, `getrawtransaction` verbose (old tx found: txindex on), unknown tx -> error -5, malformed -> -8, `scantxoutset` -> "Unsupported method" (no address balance without the add-on). Possible fallback for `/tx` (getrawtransaction) and broadcast (sendrawtransaction) without the add-on; not changed (no behavior change without a decision). |
| 3 | Errors | **risky (deferred)** | `broadcastBitcoin` maps every non-200 below 500 (including 401/403/429 and a duplicate "already in mempool" answer) to `BROADCAST_REJECTED`, and `submit.service` then releases the claim to PLANNED on the premise "nothing was sent". For auth/rate-limit that premise is true (misleading message only); for an already-known transaction it is false. The `/sendtx/` error body is undocumented, so a safe classification cannot be written without a live shape; deferred with the add-on check. |
| 5 | Config | OK | Same `ALCHEMY_API_KEY`; the Bitcoin host needs the chain enabled on the key (OPEN-ITEMS key item). |
| 7 | Mocks | unverified | Blockbook shape (`balance` string, `confirmations`, `vout[].value` string, `addresses[]`) cannot be confirmed until the add-on is on. |

Live check: result above (REST blocked; JSON-RPC read-only calls `getblockcount`, `getrawtransaction`, `scantxoutset`, `getmempoolentry`, `getblockchaininfo`). `POST /sendtx/` was never called.

### CoinMarketCap (`/v2/cryptocurrency/quotes/latest`)

Docs checked (2026-10-03): https://coinmarketcap.com/api/documentation/guides/standards-and-conventions (data as object maps keyed by id, ISO 8601 UTC timestamps, numeric ids preferred); `skip_invalid` behavior from CoinMarketCap's endpoint documentation as returned by search (the endpoint page itself is JS-rendered and did not load): when false, any invalid id fails the request with 400.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Invalid ids | **risky -> fixed** | Without `skip_invalid=true` one unknown id fails the whole batched request (400) and every price in the batch becomes unavailable. Fix: send `skip_invalid=true`; a missing id is then simply absent from `data` (already handled). |
| 1 | Entry shape | unverified | v2 `data` keyed by id as object (code also accepts arrays); `quote.USD.price`, `last_updated`. No key: live check "not run: no key". |
| 3 | Errors | OK | 5 s timeout, non-2xx throws; null/negative price drops only that id. |
| 4 | Secrets | OK | `X-CMC_PRO_API_KEY` header. |
| 5 | Config | OK | Empty key disables prices. |
| 6 | Version | OK | No client library. |
| 7 | Mocks | OK | URL assertion updated for `skip_invalid=true` (documented parameter). |

Live check: not run: no key (a keyless public API exists per the CMC site, not used under the key-only rule).
Fix: `skip_invalid=true` + test.

### @solana/web3.js 1.99.0 (latest 1.99.0; no deprecation flag; maintenance branch)

Docs: https://solana.com/docs/rpc/http/sendtransaction, https://solana.com/docs/rpc/http/getsignaturestatuses, installed `lib/index.cjs.js` (2026-10-03).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Versioned tx, fee payer, cosign | OK | `VersionedTransaction.deserialize`, `message.serialize()` hash, `sign([feePayer])` adds only the payer signature; confirmed against live LI.FI sponsored transactions (payer index 0, 2 signatures). |
| 1 | `sendRawTransaction` | OK | `skipPreflight:false, maxRetries:0`; the library uses the connection commitment (`confirmed`) as `preflightCommitment` (index.cjs.js lines 8383-8384), so a fresh `confirmed` blockhash passes preflight (RPC default would be `finalized`). |
| 1 | Finality | OK | `getSignatureStatus(searchTransactionHistory)`, `confirmationStatus === "finalized"`, expiry via `isBlockhashValid` before the lookup. |
| 1 | Exposure rules | OK | ComputeBudget opcodes 0 (deprecated RequestUnits, refused), 2 (limit u32), 3 (price u64) as documented; real LI.FI transactions pass the structural rules (fee payer only as ATA CreateIdempotent funder). |
| 1 | Rent constant | risky (deferred) | see Alchemy Solana above. |
| 3 | Unknown outcomes | OK | One attempt, never retried; non-`SendTransactionError` failures stay unknown (ADR-013). |
| 6 | Version/advisories | OK | Exact pin, newest. See the advisory table. |
| 7 | Mocks | OK | |

### @scure/btc-signer 2.4.1, @noble/curves 2.4.0, @noble/hashes 2.4.0 (all latest)

Docs: installed typings/README, BIP-322 text and vectors verified in Spec 8 (reviews/spec8/task-1-3-report.md); npm metadata checked 2026-10-03 (no deprecation).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | PSBT parse/finalize, BIP-322 simple, BIP-137 | OK | Existing vector tests pass (`bitcoin-link.test.ts` not re-run in this task, unchanged code). noble v2 calls use `prehash:false`, `ripemd160` from `legacy.js`. |
| 1 | LI.FI Bitcoin PSBT | unverified | Needs a UTXO-holding source address (see LI.FI). |
| 6 | Version | OK | Exact pins at latest. |

### viem 2.56.9 (latest 2.57.2; no deprecation, no advisory flagged; upgrade not needed)

Docs: https://viem.sh/docs/actions/public/getTransactionReceipt (2026-10-03); live RPC behavior above.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Receipts, logs, balances | OK | Unknown receipt `null` -> `TransactionReceiptNotFoundError`; `getTransaction` -> `TransactionNotFoundError`; `multicall` with Multicall3 address. |
| 1 | Gas drops | OK | `sendTransaction` once, `retryCount:0`; refusals via `InsufficientFundsError`/nonce errors only. |
| 3 | Unknown outcomes | OK | Non-definitive failures are rethrown as unknown. |
| 7 | Mocks | OK | |

## Messaging, AI and storage

### Resend `resend` 6.30.0 (latest 6.32.0; no deprecation)

Docs checked 2026-10-03: https://resend.com/docs/dashboard/emails/idempotency-keys, https://resend.com/docs/api-reference/errors, https://resend.com/docs/api-reference/emails/send-email; installed `index.d.mts` (`ErrorResponse { statusCode, name }`, names include `invalid_idempotent_request`, `concurrent_idempotent_requests`, `rate_limit_exceeded`, `application_error`).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Send params | OK | `from`, `to` (string), `subject`, `text`; `Idempotency-Key` via the second argument. |
| 3 | Errors | OK | SDK returns `{ error }` (network failures as `application_error`, `statusCode: null`); code emails throw OTP_DELIVERY_FAILED, status emails only log (state never rolls back). No retries, so `concurrent_idempotent_requests` (409) cannot loop. |
| 4 | Idempotency | OK | Keys are `<event>/<uuid or event id>`, well under the 256-character limit, valid 24 h. Every OTP/application code send uses a fresh UUID key, so the "same key, different payload" 409 (`invalid_idempotent_request`) cannot occur; keys for status/basket/profile emails embed the event id (or `updatedAt` ms for profile moderation). |
| 5 | Config | OK | `RESEND_API_KEY`, `EMAIL_FROM` are `nonEmpty`; an unverified sending domain gives 403 (OPEN-ITEMS key item). |
| 6 | Version | OK | Exact pin; one minor behind; no advisory flagged by npm metadata. |
| 7 | Mocks | OK | Tests stub `emails.send`; the `{ error: { name } }` shape matches the typings. |

### Twilio Verify `twilio` 6.1.1 (latest 6.1.2; no deprecation)

Docs checked 2026-10-03: https://www.twilio.com/docs/verify/api/verification, https://www.twilio.com/docs/verify/api/verification-check, https://www.twilio.com/docs/api/errors (the Verify 60xxx codes are not on the fetched error page; 60202/60203 behavior is from the verification pages and the existing code comments).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Create / check | OK | `verifications.create({ to, channel: "sms" })`, `verificationChecks.create({ to, code })`; `status === "approved"` is the success test (other statuses: pending, canceled, max_attempts_reached, deleted, failed, expired are not success). `valid` (deprecated) is not used. |
| 3 | Error codes | OK | 20404 / 404 (verification deleted after 10 minutes, approval or max attempts) -> false; 60202 (max check attempts) -> false; 60203 (max send attempts, 5 per 10 min) -> 600 s cooldown; 20429 / 429 -> 60 s rate limit. 60200 (invalid number) and landline errors fall into OTP_DELIVERY_FAILED (numbers are validated before with libphonenumber). |
| 3 | Retries / timeouts | OK | Create is never retried; SDK `autoRetry` is off by default; default request timeout 30 s (RequestClient, `DEFAULT_TIMEOUT`), not set explicitly. |
| 4 | Secrets | OK | SID/token/service SID from env only. |
| 5 | Config | OK | Three env vars `nonEmpty`; `SMS_ALLOWED_COUNTRIES` validated. Channel config (allowed countries, fraud guard) lives in the Verify service (OPEN-ITEMS key item). |
| 6 | Version | OK | Exact pin. |
| 7 | Mocks | OK | Error objects carry `status` and `code`, as the SDK's `RestException` does. |

### Firebase Admin (FCM) `firebase-admin` 14.5.0 (latest 14.5.0)

Docs checked 2026-10-03: https://firebase.google.com/docs/cloud-messaging/error-codes, https://firebase.google.com/docs/cloud-messaging/manage-tokens; installed `lib/messaging/*` (error mapping, `messaging-api.d.ts`).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | `sendEachForMulticast` | OK | Present; `webpush.fcmOptions.link` must be https (documented in code). |
| 2 | Registration tokens | deprecated | `MulticastMessage.tokens` is `@deprecated` in 14.5.0 in favor of `fids` (Firebase Installation IDs); docs say both are supported and the FID system is the direction. Already tracked (OPEN-ITEMS Spec 9: Installation ID migration is a future plan). |
| 3 | Dead tokens | risky-low (deferred) | Server `UNREGISTERED` maps to `messaging/registration-token-not-registered` (handled). `messaging/invalid-registration-token` is only produced by topic-management paths, never by `sendEach` (HTTP v1 answers INVALID_ARGUMENT as `messaging/invalid-argument`), so that list entry is unreachable and a malformed token is never revoked. Not changed: INVALID_ARGUMENT also signals payload errors, and revoking on it could drop good tokens. |
| 3 | Limit | risky (known) | `sendEachForMulticast` rejects more than 500 tokens in one call (`FCM_MAX_BATCH_SIZE`); push tokens per user are unbounded (OPEN-ITEMS Spec 9), so one user over 500 would make every push throw. The real fix is capping registration, a notifications-module change; left as the existing open item. |
| 4 | Credentials | OK | Service-account JSON from env; `FIREBASE_SERVICE_ACCOUNT` empty disables push. |
| 6 | Version | OK | Latest. |
| 7 | Mocks | OK | `BatchResponse.responses[i].success/error.code` as used. |

### Gemini `@google/genai` 2.24.0 (latest 2.27.0; no deprecation)

Docs checked 2026-10-03: https://ai.google.dev/gemini-api/docs/models, .../embeddings, .../function-calling, .../thinking, .../deprecations, .../changelog.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Embeddings | OK | `gemini-embedding-2` is listed as stable; `outputDimensionality` 128-3072 (768 recommended); Embedding 2 auto-normalizes truncated dimensions (the older `gemini-embedding-001` does not, so an env override to it would need manual normalization). |
| 1 | Forced function call | OK | `toolConfig.functionCallingConfig` mode ANY with `allowedFunctionNames`, `parametersJsonSchema`; second round echoes `candidates[0].content` unmodified, which the thinking guide requires for Gemini 3 thought signatures. |
| 2 | Default chat model | deprecated (deferred) | `GEMINI_MODEL` default `gemini-3.1-flash-lite` has a published shutdown date of 2027-05-07 (replacement `gemini-3.5-flash-lite`, stable). The changelog (2026-09-18) also steers new projects to 3.5 Flash-Lite. Not switched without a real-key forced-tool-call check; the default is env-overridable. Deferred to OPEN-ITEMS with the date. |
| 3 | Errors / timeouts | OK | `abortSignal` 10 s per call; failures propagate to the caller (discovery falls back to structured search). |
| 4 | Secrets / data use | OK | Key from env; data-use terms are an OPEN-ITEMS key item. |
| 5 | Config | OK | `GEMINI_API_KEY` empty disables AI search; model names are env-configurable. |
| 6 | Version | OK | Exact pin. |
| 7 | Mocks | OK | `functionCalls`, `candidates[0].content`, `embeddings[0].values` as used. Quotas and safety settings: not applicable without a key; defaults used (no safety settings are set; unverified against quotas). |

### Cloudflare R2 via `@aws-sdk/client-s3` 3.1142.0 and `@aws-sdk/s3-request-presigner` 3.1142.0 (latest 3.1146.0)

Docs checked 2026-10-03: https://developers.cloudflare.com/r2/api/s3/api/, https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/, https://developers.cloudflare.com/r2/api/s3/presigned-urls/.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Client config | OK | `region: "auto"`, endpoint `https://<account>.r2.cloudflarestorage.com`; `forcePathStyle` is not required by the R2 docs. `requestChecksumCalculation: "WHEN_REQUIRED"` keeps the SDK from signing a CRC32 of the empty body into presigned PUT URLs (R2 implements few checksum algorithms); covered by `r2.test.ts`. |
| 1 | Presigned PUT | OK | Signed `content-type` and `content-length`; 300 s expiry (max 7 days); works only on the S3 domain, not a custom domain (we use the S3 domain). Browser PUT needs the bucket CORS rule (already documented in `apps/api/README.md`). |
| 1 | HEAD / ranged GET / Copy / Delete | OK | All supported; CopyObject limit 5 GB (uploads are capped at 10 MB). `CopySource` is `bucket/key` unencoded; keys are server-built from UUIDs, so no encoding issue. |
| 3 | Failure handling | OK | Orphan copy deleted best effort; `incoming/` cleared by the lifecycle rule (documented in the API README). |
| 4 | Credentials | OK | Access key pair from env; the bucket is private and downloads use 300 s signed GETs. Least-privilege token scope (object read/write on the one bucket) belongs to the OPEN-ITEMS bucket item. |
| 5 | Config | OK | Four `nonEmpty` env vars. |
| 6 | Version | OK | Four patch releases behind, no deprecation; not upgraded under the ruling. |
| 7 | Mocks | OK | The suite mocks the client; `r2.test.ts` uses the real presigner. |

## Infrastructure and frameworks (API side)

Provenance of "Docs checked": fetched live this task = BullMQ production + job-scheduler guides, Express 5 migration guide, rate-limiter-flexible Redis wiki, the installed turbo docs; for Drizzle, postgres.js, pg_cron, pgvector, envalid, winston, morgan, http-errors, zod, cookie-parser, Vitest, tsup and pnpm the audit used the installed package source/README/.d.ts and the code at its call sites, and the URLs are the canonical docs for those packages (not all re-fetched; nothing here contradicted the installed behavior).

### BullMQ (6.3.10)

Docs checked (2026-10-03): https://docs.bullmq.io/guide/going-to-production, https://docs.bullmq.io/guide/job-schedulers; installed source `node_modules/bullmq/dist/esm/classes/{redis-connection,queue-base,worker}.js`.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Job ids | OK | No `:` (disallowed); ids are deterministic per effect: `deliver_<id>`, `published_<versionId>`, `notice_<kind>_<event>`, `leg_<legId>`, `leg_<legId>_recheck_<n>`, `embed_<b>_<v>_<attempt>`, `search_<b>_<window>`. BullMQ ignores an `add` whose id still exists (also retained completed/failed jobs); traced every `track-leg` enqueue: a `leg_<id>` job always ends before the leg can need a fresh one, and recheck ids differ per n, so a retained job never blocks a needed one. |
| 1 | Job schedulers | OK | `upsertJobScheduler(id, {pattern,tz}/{every}, {name,data,opts})` matches the docs (upsert by fixed id, no duplicates across restarts). `opts.attempts: 1` in the template is applied to produced jobs (documented). Scheduler jobs cannot carry custom ids: none set. |
| 1 | `failed` handler | OK | Fires per attempt; guarded by `attemptsMade >= attempts`; `enqueue` swallows its own errors. |
| 2 | Deprecated | OK | `upsertJobScheduler` is the current API (repeatable jobs are the deprecated one; not used). |
| 3 | Producer offline behavior | **risky -> fixed** | Docs: disable `enableOfflineQueue` on Queue instances so calls fail quickly. Queues used `{ url }` only, so ioredis queued commands during a Redis outage (default `maxRetriesPerRequest` 20 with 1-20 s back-off) and a request that calls `enqueue` after its commit (for example submit) hung for minutes. Fix: `connection: { url, enableOfflineQueue: false }`; `enqueue` already logs and moves on. Limit: BullMQ waits for the first `ready` without a timeout, so this only applies after the first successful connection (a process started with Redis down still waits). |
| 3 | `error` listeners | **risky -> fixed** | Docs: attach an `error` listener on Queue and Worker. Installed source catches the unhandled `error` emit and calls `console.error`, so no crash, but connection errors bypassed winston (redaction, JSON in production). Fix: listeners on all 9 queues, all 9 workers and the rate-limit ioredis client (ioredis otherwise prints "Unhandled error event"). |
| 3 | Worker retries, backoff | OK | Default 3 attempts with 30 s exponential back-off; `track-leg` 12 attempts from 15 s; sweeps `attempts: 1`. |
| 3 | Worker shutdown | OK | SIGINT/SIGTERM -> `worker.close()` (waits for the active job), queues, redis, pg pool; 10 s hard exit (unref'd timer), guarded against a second signal. |
| 4 | Idempotency | OK | Deterministic ids above; each job body also re-checks state under DB locks. |
| 5 | Config | OK | `REDIS_URL` via envalid `url()`; BullMQ 6 accepts `{ url }` (adapter builds `new IORedis(url, rest)`); Worker connections keep BullMQ's forced `maxRetriesPerRequest: null`. |
| 6 | Version | OK | 6.3.10 (latest 6.3.11), no advisory. |
| 7 | Mocks | updated | `jobs.test.ts` Worker fake now records `on(event)`; new `test/queues.test.ts` loads the real queues (`vi.importActual`) and asserts `enableOfflineQueue: false` + an `error` listener on each. Both cite the BullMQ production guide. |

### ioredis (6.0.0) and rate-limiter-flexible (11.2.1)

Docs checked (2026-10-03): https://github.com/redis/ioredis (README: error handling, `maxRetriesPerRequest`), https://github.com/animir/node-rate-limiter-flexible/wiki/Redis (ioredis `storeClient`, `consume` rejects with `RateLimiterRes` on limit and with the underlying `Error` on store failure).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | `RateLimiterRedis` + ioredis | OK | `storeClient`, `keyPrefix`, `points`, `duration`; `get`/`reward` used as documented (the code skips `reward` after the window expired, which would otherwise recreate the key). |
| 3 | Store failure | OK | The wiki says `consume` rejects with an `Error` when Redis is down and suggests an insurance limiter plus `enableOfflineQueue: false`. We rethrow (500, fail closed on purpose: OTP/SMS limits must not open when the store is down); `maxRetriesPerRequest: 2` bounds the wait to a few seconds, so the offline-queue setting was not changed (the client is shared with the health check). 429 carries `retry-after`. |
| 4 | Scope | OK | Fixed windows per documented key; no secrets in keys other than hashed/identifier parts chosen by callers. |
| 2/6 | Deprecated / version | OK | Both current, no advisory. |
| 7 | Mocks | OK | `rate-limit.test.ts` runs the real limiter against the test Redis. |

### Drizzle ORM (0.45.3), drizzle-kit (0.31.11) and postgres.js (3.4.9)

Docs checked (2026-10-03): https://orm.drizzle.team/docs/select#lock-in-select, https://orm.drizzle.team/docs/transactions, https://orm.drizzle.team/docs/sql, https://github.com/porsager/postgres#connection-details (`prepare`, `max`), https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler, prepared statements).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Pool | OK | `postgres(url, { max: 10, prepare: false })` is the documented setting for Supabase's transaction-mode pooler (no prepared statements). One pool per process (api, worker). |
| 1 | Transactions, locks | OK | `.for("update")` on single-table selects inside `db.transaction`; `pg_advisory_xact_lock` is transaction-scoped, so it is safe behind the transaction-mode pooler (session-level advisory locks would not be). |
| 1 | Raw SQL | OK | `sql` template parameterizes values; the only `sql.raw` uses take code constants (`list`, `field`, metric path, `asc/desc`), never request data (checked each call site). |
| 1 | Migrations | OK | `drizzle-orm/postgres-js/migrator` with its own max-1 client closed in `finally`; `drizzle.config.ts` uses envalid with a local default. |
| 3 | Timeouts | unverified | postgres.js defaults (`connect_timeout` 30 s, no `idle_timeout`/`max_lifetime`) are kept; no statement timeout set in code. Fine for a pooler-fronted pool; confirm role-level `statement_timeout` at launch (pre-launch checklist). |
| 4 | Least privilege | OK | Runtime role `bytesac_api` (env `DATABASE_URL`) is separate from the migrator URL. |
| 2/6 | Deprecated / version | OK | Current; no advisory. |
| 7 | Mocks | OK | Tests use a real Postgres (`TEST_DATABASE_URL`). |

### pg_cron and pgvector (migrations 0002, 0009)

Docs checked (2026-10-03): https://github.com/citusdata/pg_cron#readme (`cron.schedule(job_name, schedule, command)` upserts by name), https://supabase.com/docs/guides/database/extensions/pg_cron, https://github.com/pgvector/pgvector#readme.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | pg_cron | OK | Named `cron.schedule('bytesac-retention', '0 3 * * *', ...)` is idempotent (same name replaces), guarded by `to_regnamespace('cron')` so a database without the extension skips it; the function revokes PUBLIC. Pre-launch item already tracks enabling the extension. |
| 1 | pgvector | OK | `CREATE EXTENSION IF NOT EXISTS vector`; column `vector(768)` matches the embedding dimension configured for Gemini (Messaging section). |
| 3 | Index | unverified | No ANN index (hnsw/ivfflat) on `embedding`: queries scan sequentially. Correct and fine at pre-launch volume; revisit with real basket counts (not added: no demonstrated need). |

### envalid (8.2.0)

Docs checked (2026-10-03): https://github.com/af/envalid#readme (`cleanEnv`, `makeValidator`, `str` accepts empty string, default reporter exits the process).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Validators | OK | Custom `nonEmpty`/`secret`/`origins`/`trustProxy` via `makeValidator`; `str({choices})`, `port`, `url`, `bool` standard. `nonEmpty` exists precisely because `str()` accepts "". |
| 5 | Config | OK | `COOKIE_SECURE` default true, `TRUST_PROXY` default `loopback`; `test/env.test.ts` covers failure. |
| 2/6 | Deprecated / version | OK | Current. |

### winston (3.19.0) and morgan (1.12.1)

Docs checked (2026-10-03): https://github.com/winstonjs/winston#readme, https://github.com/expressjs/morgan#readme.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | winston formats | OK | `errors({stack:true})` before the redaction format; JSON in production. |
| 4 | Redaction | OK | Key-based redaction list; morgan has no `:remote-addr`, path only (no query string), request id token. `user-agent` is client-controlled but sits quoted in a log line that is JSON-escaped in production. |
| 3 | Transport errors | OK | Console only. |
| 2/6 | Deprecated / version | OK | Current. |

### http-errors (2.0.1), zod (4.6.5, in `@repo/validator`) and cookie-parser (1.4.7)

Docs checked (2026-10-03): https://github.com/jshttp/http-errors#readme, https://zod.dev/api (v4 `ZodError.issues`), https://github.com/expressjs/cookie-parser#readme.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | http-errors | OK | `createHttpError(message, { code, headers })` extra props are assigned onto the error (documented); `isHttpError`, `err.type === "entity.parse.failed"` (body-parser) as documented. 4xx from body-parser is mapped to 400 VALIDATION_FAILED, 5xx to INTERNAL. |
| 1 | zod 4 | OK | `err.issues` (v4 shape); `safeParse`; `z.ZodType<Record<string,string>>` for params. |
| 4 | Cookies | OK | Unsigned `cookieParser()` is fine: session tokens are random opaque values checked server-side by hash. |
| 2/6 | Deprecated / version | OK | Current. |

### Express (5.2.1)

Docs checked (2026-10-03): https://expressjs.com/en/guide/migrating-5.html, https://expressjs.com/en/guide/error-handling.html, https://expressjs.com/en/api.html#req.query, https://expressjs.com/en/guide/behind-proxies.html.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Async errors | OK | Express 5 forwards rejected promises from handlers to the error handler; no wrapper library is used or needed. |
| 1 | `req.query` | OK | Getter in Express 5 (not assignable): the code only reads it (`schema.parse(req.query)`) and never writes; `validate` writes only `req.params`/`req.body`, which stay assignable. |
| 1 | Route syntax | OK | path-to-regexp v8 drops `*`/`?`/`()`: grep of all `.get/.post/.use` paths found none. |
| 1 | Body parser | OK | `express.json({ limit: "32kb" })`; `req.body` is `undefined` without a body in Express 5, handled with `?? {}`. |
| 3 | Error handler | OK | Four-argument handler last, `headersSent` -> `next(err)`; unknown errors logged through a sanitizer that never prints SQL text/params. |
| 4/5 | Trust proxy | OK | `app.set("trust proxy", env.TRUST_PROXY)` with the validator mapping digits to a hop count (Express would treat "1" as an IP). |
| 2/6 | Deprecated / version | OK | 5.2.1 is `latest`; `x-powered-by` disabled. |

### Vitest (5.0.2), tsup (8.5.1), tsx (4.23.15)

Docs checked (2026-10-03): https://vitest.dev/config/ (`globalSetup`, `setupFiles`, `fileParallelism`, `env`), https://tsup.egoist.dev/#bundle-files, `node_modules/turbo/docs/guides/tools/vitest.mdx`.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Vitest config | OK | `fileParallelism: false` (shared test DB), per-run throwaway keys, network stubbed to fail. Windows crash 3221226505 is a known runner issue (re-run file alone); not a config error. |
| 1 | tsup | OK | ESM, `target: node24`, `noExternal: /^@repo\//` (workspace TS sources), `createRequire` banner for bundled CJS (winston). Output `dist/server.js`/`worker.js` match the `start` scripts. |
| 2/6 | Deprecated / version | OK | vitest 5.0.3 and none else newer than installed; no advisory. |

### Turborepo (2.11.5)

Docs checked (2026-10-03, installed package docs, as AGENTS.md requires): `node_modules/turbo/docs/README.md`, `crafting-your-repository/configuring-tasks.mdx` (transit nodes), `crafting-your-repository/using-environment-variables.mdx` (strict mode, framework inference), `reference/configuration.mdx`.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Tasks | OK | `transit` with `dependsOn: ["^transit"]` is the documented pattern for parallel `lint`/`check-types`/`test` that still invalidate on internal package changes; `build` depends on `^build`; `dev`/`test:watch` `cache:false, persistent:true`. |
| 5 | Env (strict mode) | OK | Strict mode (default) filters env: `build.env: [API_ORIGIN]`, `test.env: [TEST_DATABASE_URL, TEST_ADMIN_DATABASE_URL, TEST_REDIS_URL]` cover everything read (`process.env.*` grep across apps/packages); `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` come from framework inference (documented for both). |
| 5 | Outputs | OK | `.next/**` (minus cache/dev), `dist/**`. |
| 6 | Version | OK | 2.11.5; latest 2.11.7, no advisory/deprecation, left. `pnpm-workspace.yaml` carries `minimumReleaseAgeExclude` for `turbo@2.11.5` and its platform binaries (pre-existing; the ruling forbids adding, not removing). Likely obsolete now (2.11.5 is older than the release-age window) but removing it was not needed for any finding: OPEN-ITEMS housekeeping. |

### pnpm settings (11.25.0)

Docs checked (2026-10-03): https://pnpm.io/settings (`allowBuilds`, `overrides`, `minimumReleaseAge`, `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`).

| # | Check | Result | Note |
|---|---|---|---|
| 5 | Settings | OK | `allowBuilds` explicit allow/deny per package (default-deny scripts), `overrides` pin `viem`, `@wagmi/core`, `@wagmi/connectors` (consistent single copies for the AppKit adapters), `minimumReleaseAge` left at the pnpm 11 default. |
| 6 | Exclusions | risky (housekeeping) | The turbo exclusions above; see Turborepo. |

### `pnpm audit --prod` (2026-10-03)

48 advisories: 1 critical, 20 high, 25 moderate, 2 low. Every one is a transitive dependency; none is a direct dependency of `apps/api` or the shared packages except the one marked fix.

| Package (installed -> patched) | Severity | Reached through | Reachable in our use? | Action |
|---|---|---|---|---|
| `next` 16.3.4 -> 16.3.6+ (GHSA-vcvr-r3jv-pc5j, RCE in `next/og` `ImageResponse`) | critical | `apps/web` (direct) | `next/og`/`ImageResponse` is not imported anywhere in `apps/web` (grep), but the framework patch is a patch release | **Fixed** (patch upgrade, see the Next.js section). |
| `axios` 1.8.4 (13 advisories, patched 1.12-1.20), `valibot` 0.42.1 | high/moderate/low | web: `@reown/appkit-adapter-bitcoin > sats-connect > @sats-connect/core` | Browser-side Bitcoin wallet SDK; bundled in the web client only | Deferred: needs a Reown AppKit/sats-connect release (major or upstream); OPEN-ITEMS. |
| `bigint-buffer` 1.1.5 (high, no patch) | high | web/mobile: `@reown/appkit-adapter-solana > @solana/spl-token` | `toBigIntLE` overflow; client-side only, no patched version exists | Deferred (upstream). |
| `node-forge` 1.4.0 (high, no patch) | high | mobile: Expo, `@reown/appkit-*-react-native`, nativewind; web: wagmi adapter | Metro/dev tooling and wallet SDK internals | Deferred (upstream Expo SDK / Reown). |
| `uuid` 7/8/9 (moderate, needs >=11.1.1: a major bump) | moderate | `firebase-admin`, `@solana/web3.js`, wagmi, Expo | Advisory is `v3/v5/v6` with a caller-supplied `buf`; we do not call uuid directly | Deferred: major (override of upstream deps). |
| `stream-json` 1.9.1 (moderate, >=3.5.0: major) | moderate | `@solana/web3.js` (api, web) | Used by the 1.x RPC websocket client internals; the API only sends HTTP JSON-RPC | Deferred: `@solana/web3.js` 1.99.0 is the last 1.x; migration to `@solana/kit` is a major change. |
| `@grpc/grpc-js` 1.9.16 (high/low, >=1.13.6) | high/low | web: `firebase > @firebase/firestore` | Firestore is not used (grep: only `firebase/app` and `firebase/messaging` are imported) | Deferred: needs a `firebase` release that bumps firestore. |
| `braces`, `picomatch`, `brace-expansion`, `decode-uri-component` | high/moderate | mobile Metro/Expo toolchain | Build-time glob matching, never on user input in production | Deferred (Expo SDK pins). |

Result: no advisory reachable from the API's production request path; one fixable direct advisory (next), fixed (Next.js section). Everything else is deferred with the reason above (pnpm `overrides` for transitive majors were not used: they change unrelated lockfile entries and the ruling sends majors to OPEN-ITEMS).

## Web and mobile client integrations

### Next.js (16.3.4 -> 16.3.8)

Docs checked (2026-10-03): https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites, https://nextjs.org/docs/app/guides/content-security-policy, https://nextjs.org/docs/app/guides/upgrading/version-16 (all served as 16.3.8 docs).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Rewrites | OK | `/api/:path*` -> `${API_ORIGIN}/:path*` is the documented external rewrite (array form: after filesystem, before dynamic routes; no `/api` app routes exist, so nothing is shadowed). |
| 1 | Headers / CSP | **risky -> fixed** | CSP is `Content-Security-Policy-Report-Only`; the guide's no-nonce policy also sets `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, which ours lacked. Added to the report-only policy (no enforcement change). Still report-only with no reporting endpoint: violations only reach the browser console (OPEN-ITEMS: collect, then enforce before launch). `script-src 'unsafe-inline'` is the guide's own no-nonce setup. |
| 1 | Server fetch | OK | `getServerMe`: `cache: "no-store"`, 5 s `AbortSignal.timeout`, cookie forwarded by name, 401/403 -> signed out, other failures throw (no silent "signed out" on an outage). Next 16: `cookies()` awaited (async request API). |
| 1 | Middleware | OK | No `middleware.ts`; Next 16 renamed it to `proxy` (not needed here). |
| 1 | Config keys | OK | `serverExternalPackages`, `rewrites`, `headers` all current; no removed options (`eslint`, `serverRuntimeConfig`, `devIndicators.*`, AMP) used; lint runs through ESLint CLI (`next lint` is removed in 16). |
| 2 | Deprecated | OK | None used. |
| 6 | Advisory | **wrong -> fixed** | `pnpm audit --prod`: GHSA-vcvr-r3jv-pc5j (critical, RCE in `next/og` `ImageResponse`, `>=16.2.0 <16.3.6`). We do not import `next/og`, but 16.3.6+ is a patch release: pinned `next@16.3.8` (newest allowed by release age, released 2026-09-30, no `minimumReleaseAgeExclude`). Re-audit: 0 `next` advisories, critical count 0. Lockfile: the install re-resolved unrelated peer variants (utf-8-validate, zod, babel), so it was reverted and edited by hand to change only `next` and the eight `@next/swc-*` plus `@next/env` entries (41 lines, integrity hashes taken from the registry resolution; `pnpm install --frozen-lockfile` passes the supply-chain policy check). `@next/eslint-plugin-next` stays 16.3.4 (separate package, not part of the advisory). |
| 7 | Tests | updated | `next-config.test.ts` asserts the three new directives. |

### Reown AppKit web (`@reown/appkit` + adapters wagmi/solana/bitcoin, 1.8.24)

Docs checked (2026-10-03): https://docs.reown.com/appkit/next/core/installation; installed `.d.ts` and sources of `@reown/appkit-adapter-bitcoin` (all five connectors), `@reown/appkit-utils` (`BitcoinConnector.SignPSBT*`).

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Setup | OK | `WagmiAdapter({ ssr: true, storage: createStorage({ storage: cookieStorage }), projectId, networks })` and `cookieToInitialState` in the provider match the Next guide; `SolanaAdapter` from `/react`, `BitcoinAdapter({ projectId })`; `createAppKit` runs at module load in a client module. |
| 1 | Metadata | unverified | Docs: `metadata.url` must match the production domain; ours comes from `NEXT_PUBLIC_APP_URL` (default localhost). Pre-launch config check. |
| 1 | Bitcoin `signPSBT` | OK | Every connector normalizes to `{ psbt: base64, txid? }` (Leather converts its `hex`; Unisat/OKX convert hex; Xverse/sats-connect and WalletConnect return `psbt`; Wallet Standard returns `signedPsbt` converted). We read `.psbt` with `broadcast: false`, `sighashTypes: [1]` (SIGHASH_ALL). |
| 3 | Leather and multi-input PSBTs | **risky (deferred)** | `LeatherConnector.signPSBT` passes only `signInputs[0].index` (`signAtIndex`), so a PSBT with several inputs comes back partly signed in Leather; Wallet Standard builds one `signingIndexes` entry per input (fine), Xverse groups indexes by address (fine). The server verifies the returned PSBT and rejects an incomplete one, so no unsafe state. Upstream behavior; OPEN-ITEMS (test Leather with a multi-UTXO wallet, or send a single input group). |
| 2/6 | Deprecated / advisories | risky (deferred) | `pnpm audit --prod`: `axios` 1.8.4 (13 advisories) and `valibot` 0.42.1 come through `@reown/appkit-adapter-bitcoin > sats-connect > @sats-connect/core`; `bigint-buffer` (no patch) via `@solana/spl-token`; `uuid` 8/9 via wagmi. Fixes need new Reown/sats-connect releases or major overrides: OPEN-ITEMS. Client-side only. |
| 7 | Mocks | OK | Wallet hooks are mocked in component tests; the new `use-leg-signer.test.tsx` mocks wagmi and AppKit. |

### wagmi (2.19.5) / viem (2.56.9) client usage and the invest signing flows

Docs checked (2026-10-03): installed viem source (`actions/public/waitForTransactionReceipt.js`), wagmi `useSendTransaction`/`useSwitchChain` types; Reown AppKit Provider types for Solana.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | EVM approval then send | **OK, guard added (defense in depth)** | The signer imports `waitForTransactionReceipt` from `wagmi/actions` (`@wagmi/core` 2.22.1), which throws on a reverted receipt (it replays the call and throws the revert reason); viem's own action resolves with `status: "reverted"`. A reverted approval therefore already stopped the flow; this is not a bug fix. Guard added anyway: stop with "The token approval was not confirmed on-chain. Nothing else was sent." when `receipt.status !== "success"`. Tests (`use-leg-signer.test.tsx`): success path sends two transactions; reverted approval sends exactly one. The change only refuses to send, never changes amounts. |
| 1 | Allowance reset | unverified | The approval is an exact-amount `approve`. Tokens like mainnet USDT revert `approve(non-zero)` while a non-zero allowance remains. Exact-amount approvals are normally spent to zero by the route, so this is rare; the new revert check surfaces it instead of sending. Not changed (needs a server-side allowance read: feature). |
| 1 | Chain switch | OK | `switchChainAsync` when `evm.chainId !== tx.chainId`; `sendTransactionAsync({ chainId })` makes wagmi reject a connector on another chain. Wrong-wallet guard compares the connected address to the linked one (case-insensitive). |
| 1 | Solana | OK | `provider.signTransaction(VersionedTransaction.deserialize(...))` and `serialize()` back to base64 (sizes under the 1232-byte limit, so the spread into `String.fromCharCode` is safe); fee payer already cosigned by the server per the LI.FI live check. User rejection mapped to `WalletRejectedError`. |
| 3 | Errors | OK | `guard` maps wallet rejections; everything else propagates to the leg UI; the server verifies every result. |
| 6 | Version | OK | wagmi/viem pinned through workspace overrides (`@wagmi/core 2.22.1`). |

### Firebase web messaging (`firebase` 12.19.0, `@firebase/messaging` 0.13.3)

Docs checked (2026-10-03): https://firebase.google.com/docs/cloud-messaging/web/get-started.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Token flow | OK (deprecated API) | `getToken(messaging, { vapidKey, serviceWorkerRegistration })`, `deleteToken(messaging)` as documented; permission requested before; unsupported browsers return null via `isSupported()`; sign-out revoke is best effort. |
| 2 | `getToken` | **deprecated (deferred)** | The current docs mark `getToken()` "will be removed in a future release" and recommend Firebase Installation IDs (`register()` / `onRegistered()`). It pairs with the server-side `tokens` deprecation found in the Messaging section (firebase-admin `sendEachForMulticast` `tokens`, FIDs): one migration across web client, API token storage and sender. Not a bug today; OPEN-ITEMS (merged with the Task 2 FCM item). |
| 1 | Service worker | OK | `firebase-messaging-sw.js` at the origin root, config via its URL query (the worker cannot read env), compat scripts from gstatic, `firebase.messaging()` shows `notification` payloads itself. CSP report-only allows `www.gstatic.com`, fcm, fcmregistrations, firebaseinstallations. |
| 4 | Version sync | risky -> test added | The worker hard-codes `12.19.0` in two gstatic URLs; a `firebase` bump would silently desync. New `firebase-sw.test.ts` asserts both URLs equal the `firebase` dependency version. |
| 6 | Advisories | risky (deferred) | `@grpc/grpc-js` 1.9.16 via `firebase > @firebase/firestore` (Firestore is never imported: only `firebase/app`, `firebase/messaging`); needs an upstream release. |

### Expo SDK 57 mobile (expo ~57.0.25, expo-router ~57.0.23, expo-secure-store ~57.0.4)

Docs checked (2026-10-03): https://docs.expo.dev/versions/v57.0.0/sdk/securestore/, https://docs.expo.dev/router/advanced/native-intent/, https://docs.expo.dev/llms.txt; `apps/mobile/AGENTS.md`.

| # | Check | Result | Note |
|---|---|---|---|
| 1 | SecureStore API | OK | `getItemAsync` / `setItemAsync` / `deleteItemAsync` are current (sync variants exist but would block the JS thread; not used); plugin `expo-secure-store` listed in `app.json`; default Android backup config (data excluded from backups) kept. |
| 3 | SecureStore failures | OK | Read failure -> signed out, write failure -> session kept in memory only, delete failure ignored; generation counter prevents a late read from overwriting a newer token. |
| 4 | Persistence on iOS | **risky (deferred)** | Docs: the iOS Keychain "persists across app uninstallations" for the same bundle id, so a reinstalled app finds the old Bytesac session token (valid until its server expiry or logout). Mitigation (clear the token on first launch after install with an AsyncStorage marker) changes sign-in behavior: OPEN-ITEMS decision. |
| 1 | Router native intent | OK | `src/app/+native-intent.tsx` exports `redirectSystemPath({ path, initial })` returning the path or `null` for wallet return URLs; try/catch returns the original path ("do not crash inside this function"). |
| 1 | Reown React Native | OK | `@walletconnect/react-native-compat` is the first import (also via `lib/polyfills.ts` first in `_layout`); `createAppKit` with `adapters` (wagmi + Solana), `storage` (AsyncStorage wrapper, session token deliberately not stored there), `extraConnectors` (Phantom, Solflare), `metadata.redirect.native`, `AppKitProvider` + `<AppKit />`: matches the 2.x installation page. No Bitcoin adapter on mobile (no BTC flow there). |
| 1 | Config | OK | `app.json`: scheme `bytesac`, `LSApplicationQueriesSchemes` and Android `queries` for wallet apps (config plugin, idempotent), `experiments.typedRoutes`/`reactCompiler`; `expo export` is verified by the final gate (see Verification). |
| 5 | API URL | risky (minor, not changed) | `EXPO_PUBLIC_API_URL` falls back to `http://10.0.2.2:4000` (Android emulator). A release build with the variable missing would fail closed (cleartext is blocked by default on release Android; iOS ATS), not leak; EAS profile env belongs to the deploy checklist. |
| 6 | Version / advisories | risky (deferred) | Reown RN packages use `^2.0.6` ranges (lockfile pins them); `node-forge`, `uuid`, `decode-uri-component`, `braces`, `picomatch`, `brace-expansion`, `bigint-buffer`, `stream-json` arrive through Expo/Reown build and wallet tooling (see the advisory table); all need Expo SDK or Reown releases. |
| 7 | Tests | OK | `pnpm --filter mobile check-types` and `test` (9 suites, 55 tests) green; no mobile code changed. |

## Verification

Per-task checks (api, web and mobile tests, lint, check-types, web build) were run by the audit tasks and are green; the full-repository gate and `expo export` result is recorded with the merge.
