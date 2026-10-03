# Spec 14 — Integration Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **User preference:** few large tasks, tests per task, one review at the end plus one fix wave.

**Goal:** Audit every third-party library and provider integration against current official docs, fix real defects with tests, confirm response shapes with read-only live calls, and publish `docs/engineering/INTEGRATION-AUDIT.md`.

**Architecture:** no structural change; fixes land in the owning module (`apps/api/src/modules/*`, `apps/api/src/providers/*`, `apps/web`, `apps/mobile`, `packages/*`). Each task writes its audit sections to a draft file in the scratch area (`.superpowers/sdd/<plan>/audit-task-N.md`); Task 5 assembles the final document.

**Tech Stack:** as installed. No new dependencies; upgrades only per the upgrade ruling.

**Spec:** `docs/superpowers/specs/2026-10-03-integration-audit-design.md`

## Global Constraints

- **Official docs first:** fetch the current docs for the installed version (WebFetch, installed `README`/`.d.ts`, `node_modules/<pkg>/CHANGELOG.md`); record URL + date in the audit. Never rely on memory for an API.
- **Audit format per item:** `## <item> (<installed version>)` → Docs checked (URLs, date) → Findings table (check 1–7 from spec §4: OK / deprecated / wrong / risky / unverified + one-line note) → Live check (result or "not run: <reason>") → Fix (commit + test, or OPEN-ITEMS line).
- **Live calls:** read-only only, from a throwaway script in `.superpowers/sdd/<plan>/live/` (git-ignored, never committed). LI.FI keyless; zero-balance addresses (generate fresh keypairs locally, never fund them); Alchemy/CoinMarketCap only if `ALCHEMY_API_KEY` / `COINMARKETCAP_API_KEY` exist in `apps/api/.env` — never print or log key values, redact them from any saved output. Never call Resend, Twilio, FCM, R2 writes; never sign a transaction for submission or broadcast anything. Rate-limit politely (≤ 1 request/second to LI.FI keyless).
- **Upgrades:** patch/minor only when needed to fix a documented deprecation or advisory; exact pins; newest allowed by pnpm minimum release age; never add `minimumReleaseAgeExclude`; check the lockfile diff for unrelated bumps (revert them). Majors → OPEN-ITEMS.
- **Fixes:** each "wrong"/"risky" finding fixed in the owning module with a regression test, or deferred to OPEN-ITEMS with a reason. Tests still mock every provider; update mocks to confirmed shapes.
- **No behavior change** beyond the fixes; route-table snapshot and no-cycles tests stay green.
- Never stage `.claude/settings.json`, generated `apps/*/AGENTS.md`/`CLAUDE.md`, or anything under `.superpowers/` (never `git add -f`). Never edit `docs/source/*`. Docs rewritten in place.
- Known issues: Windows vitest crash 3221226505 → re-run the crashed file alone; vitest in the foreground with stdin `< /dev/null`; no timers/monitors; never two suites at once; full gate `--concurrency=1 --force`.

## Review Focus

1. **A live script that leaks a key or touches a write endpoint:** the scripts are never committed, keys are read from env and never printed; only the listed GET/POST-read endpoints are called (reviewer checks the script copies saved in the scratch area).
2. **A "fix" that silently changes money behavior** (amounts, minimum outputs, fee legs, gas): any change on the money path needs a test that states the old vs new behavior and a doc citation.
3. **Mocks changed to make tests pass** instead of matching documented shapes: each mock change cites the doc page or the live-check output.
4. **Lockfile churn from an upgrade:** only the intended package versions change.
5. **Pre-launch items ticked without evidence:** every OPEN-ITEMS tick cites the live-check result.

---

### Task 1: Money-path providers and chain libraries

- [ ] Audit LI.FI (all endpoints we use: `/quote`, `/advanced/routes`, `/status`, `/tools`, `/tokens`, `/connections`, `/v2/analytics/transfers`, gas suggestion if used), Alchemy (Solana, EVM, Bitcoin endpoints in `providers/*rpc*`, `providers/bitcoin.ts`), CoinMarketCap, `@solana/web3.js` (versioned tx, fee payer, `sendRawTransaction`, finality), `@scure/btc-signer` + `@noble/*` (PSBT, BIP-322), viem (receipts, logs, gas drops).
- [ ] Live read-only checks per spec §5; save sanitized outputs in the scratch area; update mocks and OPEN-ITEMS accordingly.
- [ ] Fix findings with tests; run touched tests one at a time + lint/check-types; commit `fix(api): integration audit — routing, RPC, pricing, chain libraries`. Write `audit-task-1.md`.

### Task 2: Messaging, AI and storage

- [ ] Audit Resend (idempotency keys, error objects), Twilio Verify (error codes, rate limits, channel config), Firebase Admin FCM (`sendEachForMulticast`, token errors, deprecations), Gemini (`@google/genai` models, function calling, embeddings, safety settings, quotas), R2 (`@aws-sdk/client-s3` endpoint/region/forcePathStyle, presigned URLs, copy/delete). Docs only (no live calls).
- [ ] Fix findings with tests; commit `fix(api): integration audit — messaging, AI, storage`. Write `audit-task-2.md`.

### Task 3: Infrastructure and frameworks (API side)

- [ ] Audit BullMQ (job ids, schedulers, retries, worker shutdown), ioredis, Drizzle + pg (pool, transactions, `for update`, migrations), pg_cron/pgvector usage in migrations, envalid, winston/morgan, rate-limiter-flexible, http-errors, zod, Express 5 (error handling, `req.query` getter, trust proxy), Vitest, turbo (bundled docs in the installed package), tsup, pnpm settings. Run `pnpm audit --prod` and record.
- [ ] Fix findings with tests; commit `fix: integration audit — infrastructure and tooling`. Write `audit-task-3.md`.

### Task 4: Web and mobile client integrations

- [ ] Audit Next.js 16 (rewrites, headers/CSP, server fetch caching, middleware), Expo 57 (SecureStore, Router, export), Reown AppKit web adapters (wagmi, solana, bitcoin) and React Native AppKit, wagmi/viem client usage, Firebase web messaging (getToken/deleteToken deprecations, service worker), signing flows (Solana `signTransaction`, EVM send + approval, Bitcoin `signPSBT`).
- [ ] Fix findings with tests; web lint/check-types/build/test and mobile check-types/test separately; commit `fix(web,mobile): integration audit — client integrations`. Write `audit-task-4.md`.

### Task 5: Audit document, docs and gate

- [ ] Assemble `docs/engineering/INTEGRATION-AUDIT.md` from the four drafts (summary table at the top: item, version, status, open actions); link it from `docs/README.md` and HANDOFF; update ADRs/READMEs in place where documented behavior changed; update OPEN-ITEMS (ticks with evidence, new items for deferred findings and majors).
- [ ] Full gate `pnpm turbo run lint check-types test build --continue --concurrency=1 --force < /dev/null` (re-run crashed api files alone), `pnpm --filter mobile test`, mobile `expo export`. Commit `docs: integration audit`.
