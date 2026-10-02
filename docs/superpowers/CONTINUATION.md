# Bytesac — Continuation Guide (for a new session or a different AI model)

Written 2026-10-02 after Spec 10 was merged. Read this **first**, then `docs/superpowers/HANDOFF.md` (§3 rules and §4 working method are mandatory), then `AGENTS.md`. This guide tells you where the project is, how the user wants work done, exactly what to build next, and the traps that cost time in earlier sessions.

Repository: `git@github.com:sameerkrdev/bytesac.git` (default branch `main`). Local path: `D:\Coding\projects\bytesac` (Windows 11; Git Bash + PowerShell; **Python is not installed** — edit files with your editor tools or `node -e`).

---

## 1. Project in one paragraph

**Bytesac** is a manager-led, multi-chain investment-basket platform. Users sign in with wallets (EVM SIWE, Solana SIWS), fund managers apply → are screened → create a verified organization → build versioned baskets (target weights over platform-approved instruments) → users invest. Initial settlement is **USDC on Solana**. Custody is **self-custody**: assets always stay in the user's own wallets; the user signs every value-moving transaction; the platform only co-signs as Solana fee payer, sends gas drops from its own wallets, and recovers gas through a user-signed network-fee leg (ADR-013, ADR-014). Rebalances are proposed by managers but executed only with user authorization.

---

## 2. State of `main` (all merged)

| Spec | What exists | Key docs |
|---|---|---|
| 1 Foundation + auth | Monorepo, wallet sign-in (EVM/Solana), backend sessions, contacts OTP (Resend/Twilio), web + mobile shells | ADR-003..006 |
| 2 Manager application | Public apply, email confirm, `/ops` screening, platform roles, wallet-proof grant | ADR-007 |
| 3 Organization onboarding | Org drafts, requirement templates, R2 documents, payout wallet proof, ops review, public profile | ADR-008 |
| 4 Members/roles | Permission matrix, invites by wallet, member verification, ownership transfer, public team, org switcher | ADR-009 |
| 5 Asset registry | Instruments/deployments/routes/rules, on-chain verification, review lifecycle, CoinMarketCap/NAV pricing, read API | ADR-010, ADR-002 |
| 6 Baskets | Versioned baskets, wizard, validation, ops review, publish, assignments with flags, pause/retire, public pages | ADR-011 |
| 7 Discovery | BullMQ worker, price snapshots, simulated performance, search index, Gemini tool-calling search, manager profiles | ADR-012, ADR-006 |
| ADR-013 | Custody/execution/spend authority decided (self-custody, no delegation, pro-rata `SHORT`) | ADR-013 |
| 8 First investment + exit | LI.FI legs via `RouteProvider`, Solana fee-payer co-signing (`svmSponsor`), EVM gas drops, network-fee leg, native BTC (BIP-322 linking, PSBTs), positions ledger, tracking, reconciliation, portfolio, leave/sell | ADR-014, D-067..D-075 |
| 9 Rebalance, skip, drift, repair, notifications | Apply/skip versions (one plan via the USDC-on-Solana hub, buys rescaled to actual proceeds), drift fix + keep custom, `SHORT` Buy back / Sync, basket cash sub-ledger, trade thresholds, portfolio states, inbox + email + FCM web push, investor basket notices, manager adoption counts | ADR-015, D-076..D-084 |
| 10 Manager fees, platform fees, earnings | Manager entry/rebalance fees to the org payout wallet, ops-configured platform fee per operation (overrides), one user-signed fee leg with all transfers, waivers, earnings (Owner/Admin) and ops revenue with CSV, daily revenue reconciliation, public fees page | ADR-016, D-085..D-092 |

Latest merges: Spec 7 `9d56ef2`, ADR-013 `545b187`, Spec 8 `4170ee8`, Spec 9 `14e1fde`, Spec 10 `ee86cd4`. Migrations `0000..0013`. Decision register up to **D-092**; ADRs up to **ADR-016**.

Specs: `docs/superpowers/specs/` · Plans: `docs/superpowers/plans/` · Spec 8 review artifacts: `docs/superpowers/reviews/spec8/` (Spec 9 review artifacts lived in the git-ignored SDD workspace and were deleted after merge; findings and rulings are summarized in HANDOFF §5).

---

## 3. How the user wants work done (summary — HANDOFF §3/§4 is authoritative)

**Per phase, the full cycle — never skip a gate:**
1. `superpowers:brainstorming`. Classify the path out loud (new subsystem = architectural). Write back your understanding briefly. Ask **one multiple-choice question per message**, recommended option first and labelled "(Recommended)", with short trade-offs. When the user writes "explain"/"means"/"explain the issue", explain plainly with concrete examples and re-ask. Then present the **whole design in ONE consolidated message**. The user approves with "approve"/"yes"/"a".
2. Write the spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (format: like Specs 5–8: intent + success criteria, decisions table, out of scope, data model, states, API tables, web, security, testing, execution shape, open items). Self-review, commit, ask the user to review.
3. `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-specN-<topic>.md`: **4–5 large tasks**; header + Global Constraints (exact values verbatim) + Review Focus (5 failure modes, each with a test) + File Structure; full code **only** for subtle logic (state machines, money, concurrency, security); otherwise paths, interfaces, exact names/values and concrete test cases pointing at existing patterns. Commit, ask the user to review.
4. Execute with `superpowers:subagent-driven-development`, **adapted**:
   - Workspace: run the skill's `scripts/sdd-workspace <plan>` and `scripts/task-brief <plan> N`; ledger `progress.md` with a pre-flight scan table and `Ruling:` lines.
   - **Implementer #1 (Sonnet, background)** = API tasks; **implementer #2 (Sonnet)** = web + docs tasks, given implementer #1's report and deviations. Dispatch prompts: brief paths, read only the plan's header/Global Constraints/Review Focus/File Structure + spec, `ponytail` skill, official docs first, pinned deps, no Python, gate + commit per task with the attribution line, **no subagents**, report to a file, reply ≤12 lines.
   - **No per-task reviews.** One **Opus** whole-branch review on a trimmed diff (`git diff <merge-base>..HEAD -- . ':!packages/db/migrations/meta' ':!pnpm-lock.yaml' ':!docs/superpowers/specs' ':!docs/superpowers/plans'`) with spec, plan, ledger, reports and a prioritized focus list.
   - **One Sonnet fix wave** (resume the implementer or a fresh one) for all Critical/Important + cheap Minors; then a short **scoped Sonnet re-review** when the fix touches security/money (for money-moving specs a second small wave was approved by the user once — ask before doing that).
   - Verify the **full gate yourself**, then present the finishing menu (merge locally / push + PR / keep) and **wait**. After merge: gate on `main`, delete the branch + workspace, update HANDOFF §0/§2/§5/§6.
5. **Ask the user** (AskUserQuestion, recommended first) for anything touching **permissions, money, custody or data migration** where spec/plan are silent. Otherwise decide and log `Ruling: <what> — <why> — <cost if wrong>`; list every ruling in the final report.
6. Chat style: terse; tables for state; never claim a test/merge/push succeeded without observing it.

**Hard rules:** lean code (`ponytail`: no one-caller helpers, no wrappers, stdlib/native first); official docs first for every library/provider; pin exact versions, never add pnpm `minimumReleaseAgeExclude`; docs rewritten **in place** (no "update" notes); never edit `docs/source/*`; never stage `.claude/settings.json`, root `AGENTS.md` (line-ending noise) or generated `apps/*/AGENTS.md` / `CLAUDE.md`; branch before committing; commits end with the harness attribution line; ask before merging or pushing.

**Safety (AGENTS.md, binding):** never move real assets, sign or broadcast real transactions, or touch production data; tests mock LI.FI, RPC, Alchemy, wallets, Gemini, CoinMarketCap, Resend, Twilio, R2; wallet auth ≠ spending authority; manager publication ≠ user consent; keep history (status transitions, append-only ledgers, no hard deletes except retention). The runtime DB role has **no DELETE** — replaceable child rows are revisioned or soft-removed.

**Models:** Sonnet for all code-writing sub-agents and re-reviews; Opus only for the final whole-branch review (or genuinely hard design). Never Opus for easy tasks.

---

## 4. Environment, gate and traps (read before running anything)

- `pnpm db:up` = Docker Postgres 17 (custom image with pg_cron + pgvector, port 54329) + Redis 7 (port 63799). Start Docker Desktop if `docker info` fails. `pnpm --filter @repo/db db:migrate` after pulling new migrations; `pnpm --filter @repo/db db:dev-roles` sets the local runtime role password.
- Gate: `pnpm turbo run lint check-types test build --continue` (28 tasks). Mobile extra: `pnpm --filter mobile test`, `npx expo export` (see HANDOFF §4).
- **Known failures:** (1) `mobile#check-types` fails on `main` (TS2322 in `apps/mobile/src/lib/appkit.tsx`, duplicate `@wagmi/core` peer variants) — pre-existing, fix separately (pnpm dedupe/override). (2) **Windows vitest worker crash** `3221226505` on 1–3 random api files per full run — re-run the crashed files alone; not a code failure.
- **Never run two test suites at the same time** — they share one test DB; concurrent runs produce deadlocks and "relation does not exist" errors that look like real failures. Before your own gate, confirm no sub-agent is still running tests (a sub-agent's "completed" notice may say it has background work still running).
- Sub-agents hit **usage limits**: check `git log`/`git status`, then **resume the same agent with SendMessage** (its context survives) instead of starting over; if its work is uncommitted, tell it exactly what survived.
- Files are CRLF in the working tree; `node -e` edits must normalize `\r\n` and write back with the original line endings.
- Windows long paths: removing a worktree with `node_modules` may need `Remove-Item -LiteralPath '\\?\<path>' -Recurse -Force`.
- `git branch -d` may refuse when the GitHub copy is behind; verify with `git merge-base --is-ancestor <branch> main` before `-D`.

---

## 5. Next phase — Spec 11: RWAs and tokenized ETFs/equities

**Start only after the user's go-ahead.** Sources: `docs/source/Assets-Registry.txt` (RWA onboarding, §6 RWA execution routes, §7 eligibility and compliance), `docs/source/First-Investment,-Rebalancing,-Drift-&-Fix.txt` §5.6 (RWA adapter boundary), §9.5 (first investment with an RWA), Case 3, Scenarios D and J, §20 (RWA states), §33 (eligibility is route-specific), `docs/source/User-Detailed-Features.txt` §9 (investment eligibility), `docs/source/Basket-Creation.txt` §12 (minimum investment and eligibility); `docs/domains/ASSET-REGISTRY.md`, `INVESTMENT-REBALANCING-DRIFT-FIX.md`; D-025 (eligibility), D-026 (RWA execution, OPEN), ADR-010 (registry: RWA issuer terms already stored), ADR-013/014/015/016; Spec 8–10 code (`services/{investability,operations,rebalance,positions,fees}.ts`, `providers/routes/*`).

**Fixed constraints already decided (do not re-ask):** self-custody and user-signed legs (ADR-013); `RouteProvider` abstraction with LI.FI first (ADR-014); eligibility is evaluated per user + instrument + provider + route + jurisdiction + action, never one global KYC flag (D-025); no fictional immediate sells for illiquid RWAs (Scenario D); unsettled RWA orders never count as holdings (Scenario J); fees and the network fee leg as Spec 10 (ADR-016); conventional broker-held ETFs/stocks are a future plan needing a custody ADR.

**Likely brainstorm questions (one at a time, recommended first):**
1. Scope: which RWA classes in release 1 (tokenized treasuries/money-market funds, tokenized equities/ETFs, others) and which providers/routes (LI.FI where it supports them, issuer subscription APIs, 0x xStocks — opt-in, geo-restricted, enablement paused Sept 2026).
2. Eligibility engine: data to collect (jurisdiction, accredited/qualified status, issuer KYC/allowlist status), who verifies (self-declared vs provider KYC), where it runs (plan time and per leg), how ineligibility shows on baskets and in rebalances.
3. Async settlement states (`ELIGIBILITY_PENDING`, `SETTLEMENT_PENDING`, `ISSUANCE_PENDING`, `REDEEMING`, `SETTLED`) for legs and operations; how a plan mixing instant crypto and pending RWA legs reports progress; timeouts.
4. Redemptions and removed RWAs in rebalances: redemption windows, retain-as-legacy vs wait, partial exits.
5. Pricing: NAV (ops-entered today) vs a data vendor; staleness rules for planning.
6. Transfer restrictions: allowlisted wallets (the user's linked addresses), what happens when a user moves an RWA token outside (reconciliation, `SHORT`).

Money/permission/custody/eligibility questions must go to the user. Expect 5 tasks: (1) data + validator (eligibility rules, RWA leg states); (2) eligibility engine + RWA route provider adapter(s); (3) async settlement tracking, redemptions, rebalance/repair integration; (4) web (eligibility capture, RWA disclosures, pending states); (5) web tests + docs (ADR-017, register rows from D-093).

---

## 6. Remaining roadmap after Spec 11 (each a full cycle; start only with the user's go-ahead)

| Phase | Scope |
|---|---|
| **Future plans** (`docs/domains/FUTURE-PLANS.md`; only with explicit approval) | Subscriptions (prepaid signed periods, auto-renew through token delegation with an ADR, lapse effects); management-fee accrual; manager and platform fees always up front; fee credits/refunds; platform take rate; tax statements; direct sell→buy pairing; one combined repair plan; Alchemy webhooks; mobile investing screens and push; Firebase Installation ID migration; LI.Fuel gas top-up; conventional ETFs/stocks (custody ADR); multiple wallets and wallet migration; delegated signing / session keys (ADR); price backfill; investor counts; jobs dashboard. |

---

## 7. Open items to keep raising (never decide silently)

**Spec 8 pre-launch (user actions; not machine-verifiable):** LI.FI key + terms + integrator fee; confirm `svmSponsor`, `toAddress` echo and Solana transaction encoding with a real key; Alchemy Bitcoin `/tx` and `/sendtx` shapes; Phantom/Solflare manual test (wallets that add instructions get `TX_MISMATCH` by design); Reown Bitcoin `signPSBT` of the BIP-322 virtual transaction; fund platform wallets (Solana fee payer, EVM gas wallet per chain, gas treasury); move platform keys to a KMS; review gas caps (0.02 SOL/user/day may be too low once rent is counted); legal review of the network fee and self-custody flows; small-amount mainnet checklist in `apps/api/README.md`.

**Spec 10 pre-launch (user actions):** fee caps and disclosure wording (compliance); platform fee rates; revenue treasury address (`REVENUE_TREASURY_SOLANA_ADDRESS`) and its USDC token account; legal review of manager fees paid directly to organizations and of the platform fee; tax/reporting; CSV downloads in a browser; small mainnet run with fees.

**Spec 10 leftovers:** no "last changed by" on `/ops/fees`; override form takes raw ids; revenue reconciliation buckets by `settled_at` (false mismatch near midnight possible); cosmetic review minors (HANDOFF §5).

**Spec 9 pre-launch (user actions):** create the Firebase project, VAPID key and service account (`FIREBASE_SERVICE_ACCOUNT`, `NEXT_PUBLIC_FIREBASE_*`) and test web push end to end in each browser; notification copy and the Resend sender domain; tune trade thresholds (50 bps / $5) and the 500 bps drift default; adoption masking (per-cell "<5", differencing possible — accepted for launch, joint masking with compliance); small mainnet run of rebalance, drift fix, buy back and sync.

**Spec 9 leftovers:** unbounded push tokens per user; Firebase registration tokens deprecated (Installation ID migration in FUTURE-PLANS); `positions.ts` ↔ `rebalance.ts` import cycle; D-071 message duplicated; cosmetic review minors (HANDOFF §5); `organization-payout-wallet` web test times out under a parallel full run (passes alone).

**Spec 8 leftovers:** optional fee-payer simulation check; fully sold positions not auto-closed; sweeps lack per-record isolation; abandoned `IN_PROGRESS` operations keep gas reservations until UTC midnight; retried gas drop skips its status re-check.

**Earlier specs:** Spec 4–7 deferred minors (HANDOFF §5); `mobile#check-types` dependency fix; Resend email copy and sender domain; re-apply cooldown after rejection; jurisdiction-specific templates; document retention periods and 7-year audit retention (compliance); real-R2 and AppKit Solana signing manual checks; Gemini model/terms check with a real key and quotas; CoinMarketCap plan + the `price: null` batch issue (fix before onboarding real assets); pgvector on Supabase; deploy the BullMQ worker (`start:worker`); final disclosure wording; fee-cap confirmation; pending user actions in HANDOFF §7 (Reown project ID, Resend, Twilio, Alchemy, Supabase, load balancer `X-Forwarded-For`, bundle id, CSP, Spec 1 manual wallet checks).

---

## 8. Where things are

- Product sources (never edit): `docs/source/*`. Domain summaries: `docs/domains/*`. Architecture: `docs/architecture/ARCHITECTURE.md`. Decisions: `docs/decisions/DECISION-REGISTER.md`, `ADR-001..ADR-014`. Coding standards: `docs/engineering/CODING-STANDARDS.md`. Design system: `docs/BYTESAC_Design_System.md`.
- Monorepo: `apps/api` (Express 5: `src/app.ts`, `server.ts`, `worker.ts`, `env.ts`, `middleware/`, `routes/`, `services/`, `providers/`), `apps/web` (Next.js 16), `apps/mobile` (Expo 57), `packages/{db,validator,api-client,app-core,logger,design-tokens,ui,eslint-config,typescript-config}`.
- API README (`apps/api/README.md`): env, worker, platform wallets, gas caps, mainnet checklist.
- The local `.superpowers/sdd/` workspace is git-ignored and does not travel; regenerate briefs with the subagent-driven-development skill's scripts.
