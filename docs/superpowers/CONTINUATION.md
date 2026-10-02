# Bytesac — Continuation Guide (for a new session or a different AI model)

Written 2026-10-02 after Spec 9 was merged. Read this **first**, then `docs/superpowers/HANDOFF.md` (§3 rules and §4 working method are mandatory), then `AGENTS.md`. This guide tells you where the project is, how the user wants work done, exactly what to build next, and the traps that cost time in earlier sessions.

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

Latest merges: Spec 7 `9d56ef2`, ADR-013 `545b187`, Spec 8 `4170ee8`, Spec 9 `14e1fde`. Migrations `0000..0012`. Decision register up to **D-084**; ADRs up to **ADR-015**.

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

## 5. Next phase — Spec 10: Subscriptions, fees, manager payouts

**Start only after the user's go-ahead.** Sources: `docs/source/User-Detailed-Features.txt` §18 (subscription fees), §19 (subscription management), §25 (rebalance fees), §45 (fees); `docs/source/Fund-Manager-Detailed-Features.txt` §30–§36 (revenue model, subscription fee, investment-based fee, rebalance-based fee, fee transparency, revenue flow, payout wallet) and the basket "Fees" section; `docs/domains/USER-FEATURES.md`, `FUND-MANAGER-FEATURES.md`, `BASKET-CREATION.md`; ADR-011 (fee schedule disclosures, D-058 caps), ADR-013 open question 3 (fee collection), ADR-014 (network fee leg), ADR-015 (rebalance plans, basket cash, fee placement); Spec 8/9 code (`apps/api/src/services/{operations,rebalance,positions}.ts`).

**Fixed constraints already decided (do not re-ask):** self-custody, user signs every leg, nothing is ever pulled from a wallet (ADR-013); the network fee leg stays as is (ADR-014, D-067); the Spec 6 fee schedule exists on each version (entry/management/rebalance percent 0–100 bps or fixed ≤ 1% of the minimum, subscription fixed per period; D-058 caps await compliance confirmation); payouts go to the organization's verified Solana payout wallet (D-006, Spec 3); rebalance plans already carry a fee leg position (first / between sells and buys) and a basket cash sub-ledger.

**Likely brainstorm questions (one at a time, recommended first):**
1. Collection model: explicit fee legs inside the user-signed plan (ADR-013 proposal) — one transfer to the platform treasury and one to the payout wallet, or one to the platform with periodic platform → manager payouts?
2. Which fees in release 1: entry fee on invest, rebalance fee on rebalance, management fee (accrual base, period, how collected without pulling funds — e.g., at the next signed operation or a monthly signed charge), subscription (per period, renewal reminder, lapse effect: no rebalance offers? only a notice?).
3. Fee base and timing: percent of amount invested / of rebalance traded value / of basket value; taken from the USDC input (like the network fee) or from basket cash; rounding in micro-USDC.
4. Platform fee: platform share and recipient split (platform vs manager), and whether the platform charges its own fee.
5. Refunds and failures: fee charged when an operation ends `PARTIAL`/`FAILED`? refund policy (none, as the network fee)?
6. Unpaid subscription / management fee: what the user loses (rebalance notifications, apply) — never the assets (no lock-in).
7. Manager payout reporting: earnings per basket/version/period in the manager dashboard; ops reconciliation of treasury vs payouts; tax/export.
8. Fee cap confirmation and disclosure wording (compliance), fee changes requiring a new version and user notice.

Money/permission/custody questions must go to the user. Expect 5 tasks: (1) data + validator (fee math, accrual, states); (2) fee legs in invest/rebalance/sell plans + subscription charges; (3) payouts, reporting, ops reconciliation, notifications; (4) web (fee previews, subscription management, manager earnings); (5) web tests + docs (new ADR-016, register rows from D-085).

---

## 6. Remaining roadmap after Spec 10 (each a full cycle; start only with the user's go-ahead)

| Phase | Scope (agreed with the user) |
|---|---|
| **Spec 11 — RWAs and tokenized ETFs/equities** | Eligibility engine (user + instrument + provider + route + jurisdiction + action; KYC/allowlists; D-025); RWA routes via LI.FI or other providers through `RouteProvider`; async settlement states (`PENDING_SETTLEMENT`, `ISSUANCE_PENDING`, …); removed-RWA disposition in rebalances (redemption windows); RWA data vendor selection; collect user jurisdiction. 0x xStocks are Swap-API-only, opt-in, not for US/Canada/UK/Australia, and enablement was paused (Sept 2026) — only if the user decides to add 0x. |
| **Future plans** (`docs/domains/FUTURE-PLANS.md`; only with explicit approval) | Direct sell→buy pairing in rebalances; one combined repair plan across all short assets (one network fee); Alchemy address-activity webhooks for drift; mobile investing screens and mobile push; Firebase Installation ID migration; LI.Fuel route gas top-up; conventional ETFs/stocks (broker-held; needs a new custody ADR); multiple independent wallets and wallet migration; delegated signing / session keys (needs an ADR); price backfill; investor counts; jobs dashboard. |

---

## 7. Open items to keep raising (never decide silently)

**Spec 8 pre-launch (user actions; not machine-verifiable):** LI.FI key + terms + integrator fee; confirm `svmSponsor`, `toAddress` echo and Solana transaction encoding with a real key; Alchemy Bitcoin `/tx` and `/sendtx` shapes; Phantom/Solflare manual test (wallets that add instructions get `TX_MISMATCH` by design); Reown Bitcoin `signPSBT` of the BIP-322 virtual transaction; fund platform wallets (Solana fee payer, EVM gas wallet per chain, gas treasury); move platform keys to a KMS; review gas caps (0.02 SOL/user/day may be too low once rent is counted); legal review of the network fee and self-custody flows; small-amount mainnet checklist in `apps/api/README.md`.

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
