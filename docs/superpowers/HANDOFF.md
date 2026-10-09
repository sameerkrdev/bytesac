# Bytesac — Session Handoff Guide

The one document to read first in a new session (human or AI). It holds the starter prompt, the project state, the working method the user wants, environment traps, the next phase and the roadmap. It supplements, never replaces, `AGENTS.md` and `docs/`. Open work is in `docs/OPEN-ITEMS.md`; brainstorm Q&A in `docs/superpowers/BRAINSTORM-LOG.md`; deferred scope in `docs/domains/FUTURE-PLANS.md`.

---

## 0. Paste-ready starter prompt

> You are continuing the Bytesac monorepo at `D:\Coding\projects\bytesac` (Windows 11, Git Bash + PowerShell; **Python is not installed** — edit with Edit/Write or `node -e`; files are CRLF). Specs 1–15 are merged to `main` and pushed to `origin/main`. The next phase is **Spec 16 — deployment** (§6), then the roadmap 17–19 (§7).
>
> **1. Load context (mandatory, in order):** this file (§3 rules and §4 method are binding), `AGENTS.md`, `docs/README.md`, `docs/architecture/ARCHITECTURE.md`, `docs/decisions/DECISION-REGISTER.md` (+ the linked ADRs), `docs/engineering/CODING-STANDARDS.md`, `docs/OPEN-ITEMS.md`, `docs/superpowers/BRAINSTORM-LOG.md`, `docs/engineering/INTEGRATION-AUDIT.md`, the domain doc and `docs/source/*` file for the phase. Check the memory files for user preferences.
>
> **2. Verify state:** `git log --oneline -5`, `git status --short` (only the user's/noise files in §5 "Never stage" should show — never stage them), `git branch --show-current`. Start Docker Desktop, `pnpm db:up`, `pnpm --filter @repo/db db:migrate`.
>
> **3. Per phase run the full cycle in §4** (brainstorm → spec → plan → subagent-driven execution → one Opus review → one fix wave → your own full gate → merge). At plan approval ask whether the user pre-approves the local merge. Items touching permissions, money, custody, data migration, **deployment targets, secrets or anything public-facing** go to the user (AskUserQuestion, recommended option first); otherwise decide and log `Ruling: <what> — <why> — <cost if wrong>`.
>
> **4. Style:** terse chat, tables for state, never claim a test, merge, deploy or push succeeded without observing it. Never move real assets, sign or broadcast transactions, deploy, or touch production data without the user's explicit go-ahead. Push only when the user says so (local `main` is far ahead of `origin`).

---

## 1. Project in one paragraph

**Bytesac** is a manager-led, multi-chain investment-basket platform. Users sign in with wallets (EVM SIWE, Solana SIWS); fund managers apply, are screened, create a verified organization and build versioned baskets (target weights over platform-approved instruments); users invest. Initial settlement is **USDC on Solana**. Custody is **self-custody**: assets stay in the user's own wallets and the user signs every value-moving transaction; the platform only co-signs as Solana fee payer, sends gas drops from its own wallets and recovers gas through a user-signed network-fee leg (ADR-013, ADR-014). Rebalances are proposed by managers and executed only with user authorization. Verbatim product sources are in `docs/source/*` (never edit).

## 2. Current state (after Spec 15)

Repository `git@github.com:sameerkrdev/bytesac.git`, default branch `main`. Migrations `0000..0022`; decision register up to D-121; ADRs up to ADR-021. Per-chain addresses (D-120, ADR-021) and web multi-wallet (D-121) are built on branch `feat/per-chain-addresses` and not yet merged; after migrating run `ops:backfill-polygon` (OPEN-ITEMS §5).

| Spec | What exists | Merge | Key docs |
|---|---|---|---|
| 1 Foundation + auth | Monorepo, wallet sign-in (EVM/Solana), backend sessions, contacts OTP (Resend/Twilio), web + mobile shells; package/API restructure and pg_cron retention | on `main` | ADR-003..006 |
| 2 Manager application | Public apply, email confirm, `/ops` screening, platform roles, wallet-proof grant | `0db41ea` | ADR-007 |
| 3 Organization onboarding | Org drafts, requirement templates, R2 documents, payout wallet proof, ops review, public profile | `d409758` | ADR-008 |
| 4 Members/roles | Permission matrix, invites by wallet, member verification, ownership transfer, public team | `33c2ab3` | ADR-009 |
| 5 Asset registry | Instruments, deployments, routes, rules, on-chain verification, review lifecycle, CoinMarketCap/NAV | `8c02722` | ADR-010, ADR-002 |
| 6 Baskets | Versioned baskets, wizard, ops review, publish, assignments, pause/retire, public pages | `e0ed413` | ADR-011 |
| 7 Discovery | BullMQ worker, price snapshots, simulated performance, search index, Gemini AI search, manager profiles | `9d56ef2` | ADR-012, ADR-006 |
| (ADR-013) | Custody, execution and spend authority decided | `545b187` | ADR-013 |
| 8 First investment + exit | LI.FI legs, Solana fee-payer co-signing, EVM gas drops, network fee leg, native BTC, position ledger, tracking, reconciliation, portfolio, leave/sell | `4170ee8` | ADR-014, D-067..D-075 |
| 9 Rebalance, drift, repair, notifications | Apply/skip versions, drift fix, Buy back / Sync, basket cash, inbox + email + FCM web push, adoption counts | `14e1fde` | ADR-015, D-076..D-084 |
| 10 Fees and earnings | Manager and platform fees in one fee leg, ops fee schedules, earnings, revenue reconciliation | `ee86cd4` | ADR-016, D-085..D-092 |
| 10.1 LI.FI hardening | Estimates, `SOL_REQUIRED`, Mayan rule, recovery leg, price-impact limit, deny list, route fees | `b23da86` | ADR-017, D-093..D-099 |
| 11 RWAs and eligibility | Permissionless tokenized RWAs via LI.FI, eligibility engine, enforcement, decision audit | `d24d0ad` | ADR-018, D-100..D-106 |
| 12 Launch hardening | Price batch fix, price-impact backstop, gas reservation lifecycle, sweep isolation, position auto-close, recovery auto-stop, functional fixes | `2f05253` | D-107..D-113 |
| 13 Code and docs cleanup | API restructured into feature modules (route/controller/service, `@/` alias, server/worker graceful shutdown, redacted error logging), route-table and no-cycles tests, dead code and duplicates removed, docs consolidated to one home per topic | `9febc6a` | spec `2026-10-03-code-docs-cleanup-design.md` |
| 14 Integration audit | Every provider and library checked against official docs (LI.FI and Alchemy live): no-SOL shape, deny-key filtering, `toAmountMin` tolerance max(1 ppm, 10^(decimals−8)) using registry decimals, stale deny-key flag, BullMQ fail-fast producers, reverted-approval guard, Next 16.3.8, CSP directives; deferrals in OPEN-ITEMS (Spec 14 block) | `40cd4a3` | `docs/engineering/INTEGRATION-AUDIT.md` |
| 15 Basic UI | `@repo/app-core` shared leg signer and money-flow helpers, web app shell with role-aware nav and shared page states, mobile investor tabs (Discover, Portfolio, Notifications, Profile) with Solana/EVM signing via AppKit RN and Bitcoin web handoff | `bba1e94` | spec `2026-10-03-basic-ui-design.md` |
| 17 Web redesign (round 1) | Light/dark design system, marketing site, research, invest flow, portfolio, manager workspace, Playwright visual QA with a mock API | PR #1 | `docs/design/*`, spec `2026-10-04-spec17-web-redesign-design.md` |
| 17 Web redesign (round 2) | Page-swap landing, drifting transparent sky, new phone/hand devices, real-time glass scenes, Featured/Trending/Suggested rails, smallcase-style list, crypto logos, app CTA; API: featured ranks, collections, asset logos, versioned basket files, custom roles; manager workspace (sidebar, dashboard, Team, Roles & access, Wallets, Settings), ops sidebar, multi-step forms, Fees/Notifications | PR #2 | ADR-019, D-114..D-117, `docs/design/MOTION-STUDY.md` (round 2) |
| 17 Mobile redesign (round 3) | Light/dark Geist system in Expo, glass tab bar (Home, Discover, Portfolio, Alerts, Profile), Home, redesigned Discover, basket research with sticky Invest, invest / plan review / signing, position detail, activity, rebalance, sell, repair, Alerts filters, Profile with Appearance, welcome pager, sign-in, contact, branded splash | branch `feat/mobile-redesign` (PR pending user review) | `docs/design/DESIGN-SYSTEM.md` (Mobile), `docs/design/MOBILE-UX-INVENTORY.md` statuses |

Specs: `docs/superpowers/specs/` · plans: `docs/superpowers/plans/` · Spec 8 review artifacts: `docs/superpowers/reviews/spec8/` (later review artifacts lived in the git-ignored SDD workspace and were deleted after merge). Layout, conventions and behavior are in `ARCHITECTURE.md`, `CODING-STANDARDS.md` and `docs/domains/*`, not repeated here. Pre-launch checks, user actions and leftovers are all in `docs/OPEN-ITEMS.md`.

## 3. Rules the user set (mandatory)

1. **Docs in place:** when a decision or behavior changes, rewrite the affected `docs/**/*.md` (register line, ADR, architecture, domain doc, coding standards) — replace old text, never append "update" notes. Never edit `docs/source/*`. History files (specs, plans, reviews, BRAINSTORM-LOG) stay as dated records.
2. **Lean code (`ponytail`):** no extra wrappers around library calls, no helper used once; prefer pinned libraries over custom logic. Use the `ponytail` skill for code and `ponytail-review` / `ponytail-audit` for reviews.
3. **Official docs first** for every library or provider (Twilio, Resend, Reown, Drizzle, Expo, Next, turbo, envalid, winston, rate-limiter-flexible, pg_cron, LI.FI…): WebFetch or installed README/types, not memory. Turbo: bundled docs under `node_modules/.pnpm/turbo@*/node_modules/turbo/docs/`. Expo: `https://docs.expo.dev/versions/v57.0.0/` and `apps/mobile/AGENTS.md`.
4. **Shared code lives in `packages/`**; apps hold app code only; API layout per `CODING-STANDARDS.md`.
5. **Supply chain:** pin exact versions; never add pnpm `minimumReleaseAgeExclude`; if a version is too new, pin the newest allowed.
6. **Safety (AGENTS.md):** never move assets, sign or broadcast real transactions or touch production data; wallet auth is not spending authority; manager publication is not user consent; keep audit and history. The runtime DB role has no DELETE.
7. **Git hygiene:** never stage `.claude/settings.json`, generated `apps/*/AGENTS.md` / `CLAUDE.md`, or anything under `.superpowers/` (git-ignored scratch; never `git add -f`). Root `AGENTS.md` project-section edits are intended (stage only those hunks, never the turbo-managed block or line-ending noise). Branch before committing (never commit on `main`); commits end with the harness attribution line; ask before merging or pushing.

## 4. Working method

**Per phase, the full cycle (never skip a gate):**

1. **Brainstorm** with `superpowers:brainstorming`. Classify the path out loud (new subsystem = architectural). Restate your understanding briefly, then ask **one multiple-choice question per message**, recommended option first and labelled "(Recommended)" with short trade-offs. When the user writes "explain" or "means", explain plainly with concrete examples and re-ask. Then present the **whole design in one consolidated message**; the user approves with "approve", "yes" or "a". Log every question, option and answer in `BRAINSTORM-LOG.md`.
2. **Spec** → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (intent and success criteria, decisions table, out of scope, data model, states, API tables, web, security, testing, execution shape, open items). Self-review, commit, ask the user to review.
3. **Plan** with `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-specN-<topic>.md`: **4–5 large tasks**; header, Global Constraints (exact values verbatim), Review Focus (5 failure modes each with a test), File Structure; full code only for subtle logic (state machines, money, concurrency, security), otherwise paths, interfaces, exact names and concrete test cases. Commit, ask the user to review.
4. **Execute** with `superpowers:subagent-driven-development`, adapted:
   - Workspace via the skill's `scripts/sdd-workspace <plan>` and `scripts/task-brief <plan> N`; ledger `progress.md` with a pre-flight scan and `Ruling:` lines (under git-ignored `.superpowers/sdd/`).
   - **Sonnet implementers** (background): #1 API tasks, #2 web/docs or follow-on tasks, each given the previous implementer's report and deviations. Prompts name the brief paths, say read only the plan header/Global Constraints/Review Focus/File Structure plus the spec, `ponytail`, official docs first, pinned deps, no Python, gate and commit per task with the attribution line, **no subagents**, report to a file, reply ≤12 lines.
   - **No per-task reviews.** One **Opus** whole-branch review on a trimmed diff (`git diff <merge-base>..HEAD -- . ':!packages/db/migrations/meta' ':!pnpm-lock.yaml' ':!docs/superpowers/specs' ':!docs/superpowers/plans'`) with spec, plan, ledger, reports and a prioritized focus list.
   - **One Sonnet fix wave** for all Critical/Important and cheap Minor findings, then a short scoped Sonnet re-review only if the fix touched security or money (a second small wave for money-moving specs needs the user's OK).
   - Verify the **full gate yourself**, present the finishing menu (merge locally / push + PR / keep) and **wait**. After merge: gate on `main`, delete branch and workspace, update this file's §2 and `OPEN-ITEMS.md`.
5. **Ask the user** (AskUserQuestion, recommended first) for anything touching permissions, money, custody or data migration where spec and plan are silent. Otherwise decide and log `Ruling: <what> — <why> — <cost if wrong>` and list every ruling in the final report.
6. **Model choice:** Sonnet for code-writing sub-agents and re-reviews; Haiku only for tiny mechanical checks; Opus only for the final whole-branch review or genuinely hard design/concurrency work; never Opus for easy tasks. Spawn sub-agents only for independent or context-heavy work.
7. **Sub-agent limits:** they hit usage limits. Check `git log` and `git status`, then resume the same agent with `SendMessage` (its context survives) instead of starting over, telling it exactly what survived. Confirm no sub-agent is still running tests before your own gate.
8. **Dispatch prompt essentials** (every implementer): brief paths + plan Global Constraints + spec; previous implementer's report; `ponytail`; official docs first; exact pins, release-age rule, never `minimumReleaseAgeExclude`; tests in the foreground with stdin `< /dev/null`, one file at a time, no timers/monitors, never two suites at once, re-run a `3221226505` crash alone once; never stage the files listed in §5 "Never stage"; never `git add -f` anything under `.superpowers/`; commit per task with the attribution line; no subagents; report to a file in the workspace; reply ≤12 lines; "if you approach your context/usage limit, commit what is green, write what remains in the report and stop cleanly".
9. **Staffing that worked:** split large phases across 2–3 Sonnet implementers (API / web / mobile / docs) so each context stays small; sub-agents of a previous session cannot be resumed — check `git log`/`git status` and re-dispatch from the brief.
10. **Pre-approval:** when the user pre-approves ("merge to local main when done, then start the next spec"), record it in the ledger and still verify the gate yourself before merging; otherwise present the finishing menu and wait.

## 5. Environment, gate and traps

- **Services:** `pnpm db:up` starts Docker Postgres 17 (custom image with pg_cron and pgvector, port 54329) and Redis 7 (port 63799); start Docker Desktop if `docker info` fails. After pulling migrations run `pnpm --filter @repo/db db:migrate`; `pnpm --filter @repo/db db:dev-roles` sets the local runtime role password. `apps/api/README.md` has env, worker, platform wallets, gas caps and the mainnet checklist.
- **Gate:** `pnpm turbo run lint check-types test build --continue --concurrency=1 < /dev/null` (28 tasks; `--concurrency=2` if memory allows). Mobile extra: `pnpm --filter mobile test`, then `cd apps/mobile && npx expo export --platform android --output-dir <tmp>` (delete the temp dir and revert generated tsconfig changes).
- **Known gate caveat:** `mobile#check-types` passes only through the scoped type assertion in `apps/mobile/src/lib/appkit.tsx`; the duplicate `@wagmi/core` peer variants are not deduped (OPEN-ITEMS §7).
- **Windows vitest crash `3221226505`** (native Node crash) hits 1–3 random api files per full run: re-run each crashed file alone; it is not a code failure. Linux CI would avoid it (OPEN-ITEMS §6).
- **Never run two test suites at once:** they share one test database; concurrent runs cause deadlocks and "relation does not exist" errors that look like real failures.
- **Line endings:** files are CRLF in the working tree; `node -e` edits must normalize `\r\n` and write back with the original endings.
- **Windows long paths:** removing a worktree with `node_modules` may need `Remove-Item -LiteralPath '\\?\<path>' -Recurse -Force`.
- **Branch deletion:** `git branch -d` may refuse when the GitHub copy is behind; check `git merge-base --is-ancestor <branch> main` before `-D`.
- **Android device (no Android Studio):** platform-tools only (`winget install Google.PlatformTools`), EAS `development` profile APK installed with `adb install -r`; `adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:4000 tcp:4000` after each replug; `EXPO_PUBLIC_API_URL=http://localhost:4000` in `apps/mobile/.env` on a USB device (`10.0.2.2` is emulator-only); start Metro with `pnpm exec expo start --dev-client` (`pnpx`/`pnpm dlx expo` pulls a foreign Expo and fails on `expo-router/_ctx-shared`). NativeWind v5 ignores `className` on third-party components such as safe-area-context's `SafeAreaView` (style it directly). The `setDefaultChain` red box after a MetaMask connect is a WalletConnect 2.21.10 bug (dev only).
- **Scratch:** `.superpowers/` is git-ignored and does not travel; regenerate briefs with the SDD skill's scripts.
- **Gate without cache:** always add `--force` to the final gate (turbo's cache once hid a failing `mobile#check-types`). The gate takes longer than the 10-minute foreground tool limit: run it with `run_in_background` and wait for the completion notice.
- **Memory:** Claude Code may kill a background gate when the machine is low on memory; do not restart it on your own — tell the user, then re-run at `--concurrency=1` when they agree.
- **Do not run tests while a sub-agent is running tests** (shared test DB); a run that overlaps produces false failures — re-run alone.
- **Never stage (user/noise files):** `.claude/settings.json`, `.gitignore` and `apps/api/.env.example` (the user's own edits), `firebase-service-account.json` (a credential — git-ignored; never open it), root `AGENTS.md` and `apps/api/test/__snapshots__/route-table.test.ts.snap` (line-ending-only changes), generated `apps/*/AGENTS.md`/`CLAUDE.md`, anything under `.superpowers/`.

## 6. Next phase — Spec 16: deployment

Spec 15 is merged (`bba1e94`, §2); the next phase is **Spec 16 — deployment**, a full cycle (§4). Start with the brainstorm. Likely questions, one at a time, recommended first — the answers decide everything, never assume:

1. Hosting for api + worker (e.g. Fly.io / Render / Railway / AWS ECS / GCP Cloud Run), web (Vercel vs container), Postgres (Supabase per ADR-005/006 — pg_cron + pgvector), Redis (managed, non-evicting for BullMQ), object storage (Cloudflare R2), mobile builds (EAS — use the `expo:eas-*` skills).
2. Environments (dev / staging / production), domains and the confirmed web origin (also fixes `EXPO_PUBLIC_WEB_URL`, the AppKit metadata URL, CSP, `AUTH_DOMAIN` / `ALLOWED_ORIGINS`).
3. Secrets management (platform keys must move to a KMS — OPEN-ITEMS; Firebase service account, LI.FI, Alchemy, Resend, Twilio, CoinMarketCap, Gemini, R2) and who holds them.
4. CI (GitHub Actions on **Linux** — removes the Windows vitest crash): lint, check-types, test with Postgres + Redis service containers, build, migrations, Docker image builds; CD triggers (main → staging, tags → production) and manual approval gates.
5. Docker: multi-stage images for api and worker (tsup output), web (Next standalone) or Vercel; healthchecks; graceful shutdown (already in server/worker); non-root users.
6. Database migrations in CD (drizzle migrate as a release step, runtime role without DELETE), backups, pg_cron jobs on Supabase.
7. Observability (logs, error tracking, uptime), CSP enforce mode, load balancer `X-Forwarded-For`, `GEO_COUNTRY_HEADER` edge config.
8. The step-by-step launch guide (accounts to create, keys to obtain, wallet funding, the mainnet small-amount checklist from `apps/api/README.md`, the manual device checklists in OPEN-ITEMS).

Deliverables: Dockerfiles, compose for local prod-like runs, `.github/workflows/*`, env templates per environment (no secrets), rewrite `docs/engineering/DEPLOYMENT.md` (constraints and release order already written; add chosen vendors and runbooks), and `docs/engineering/LAUNCH-GUIDE.md`. Read the turbo bundled docs (AGENTS.md block) before changing CI/turbo config. **Never deploy, create cloud resources, push, or use real secrets without the user's explicit go-ahead.** At plan approval ask whether the user pre-approves the local merge.
## 7. Roadmap (user order, 2026-10-03; each a full cycle, start only with the user's go-ahead unless pre-approved)

| # | Phase | What to ask / prepare at the start |
|---|---|---|
| 16 | **Deployment**: Docker images (api, worker, web; mobile via EAS), GitHub Actions CI/CD (lint, check-types, test on Linux — fixes the Windows crash — build, migrations, deploy), environments, secrets, step-by-step launch guide | Hosting choice (e.g. Fly/Render/Railway/AWS/GCP for api+worker, Vercel for web, Supabase for Postgres, Upstash/managed Redis), domains, who holds secrets; KMS for platform keys (OPEN-ITEMS); EAS for mobile builds (expo `eas-*` skills); CSP enforcement, `X-Forwarded-For`, `GEO_COUNTRY_HEADER`, worker deployment, pg_cron/pgvector on Supabase (OPEN-ITEMS §6). Never deploy or push without the user's explicit go-ahead. |
| 17 | **Redesign** the whole web and mobile UI/UX | Ask the user for reference images and videos of other sites first; use `frontend-design`, `design:*` and `expo-design-system` skills; keep `@repo/app-core` logic and API untouched; web done (PRs #1, #2); mobile round 3 on `feat/mobile-redesign` — remaining inventory rows and the on-device check are in OPEN-ITEMS. |
| 18 | **Motion-graphics promo/launch video + platform presentation** | Ask for the reference motion-design video; produce the video as code-built animation (e.g. Remotion or HTML/Canvas rendered to MP4) with script and storyboard; presentation via the slides artifact type or `.pptx` (`anthropic-skills:pptx`) in the Bytesac theme. |
| 19 | **Future plans** (`docs/domains/FUTURE-PLANS.md`), one at a time with approval — last | Let the user pick; each is a full cycle. |

The user's working pattern (keep it): one multiple-choice question at a time with a recommended option; "explain" means re-explain plainly with an example and re-ask; "A but add B to future plan" means implement A and write B in detail into `FUTURE-PLANS.md` **before** anything else; log every Q&A in `BRAINSTORM-LOG.md`; ask at plan approval whether the user pre-approves the local merge.
## 8. Where things are

- Product sources (never edit): `docs/source/*`. Index and reading order: `docs/README.md`.
- Decisions: `docs/decisions/DECISION-REGISTER.md`, `ADR-001..ADR-018`. Architecture: `docs/architecture/ARCHITECTURE.md`. Behavior: `docs/domains/*.md`. Conventions: `docs/engineering/CODING-STANDARDS.md`. Design system: `docs/design/DESIGN-SYSTEM.md`.
- Open work: `docs/OPEN-ITEMS.md`. Integration audit: `docs/engineering/INTEGRATION-AUDIT.md`. Deferred scope: `docs/domains/FUTURE-PLANS.md`. Brainstorm Q&A: `docs/superpowers/BRAINSTORM-LOG.md`.
- Setup and operations: root `README.md` (local), `docs/engineering/DEPLOYMENT.md` (hosted; vendors still open), `apps/api/README.md`, `apps/web/README.md`, `apps/mobile/README.md`.
