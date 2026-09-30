# Bytesac — Session Handoff Guide (Spec 2 onward)

Read this first, then follow it. It captures the project state, the rules the user has set, the working method, and the roadmap. It supplements — never replaces — `AGENTS.md` and `docs/`.

---

## 0. Paste-ready starter prompt (for a fresh Claude Code session)

> You are continuing the Bytesac monorepo at `D:\Coding\projects\bytesac` on branch `main`. First read, in order: `docs/superpowers/HANDOFF.md` (this guide, follow it exactly), `AGENTS.md`, `docs/README.md`, `docs/architecture/ARCHITECTURE.md`, `docs/decisions/DECISION-REGISTER.md`, `docs/engineering/CODING-STANDARDS.md`. Then execute **Spec 2** from its approved plan `docs/superpowers/plans/2026-09-30-spec2-manager-application.md` (spec: `docs/superpowers/specs/2026-09-29-manager-application-screening-design.md`) using the execution model in HANDOFF §4: create branch `feat/spec2-manager-application`, Sonnet implementer #1 does plan Tasks 1–2 (API), Sonnet implementer #2 does Tasks 3–4 (web + docs), then one Opus whole-branch review, then one Sonnet fix wave, then report and ask me before merging. Use the ponytail skill for all coding. After Spec 2 is merged, start brainstorming Spec 3 per HANDOFF §6.

---

## 1. Project in one paragraph

**Bytesac** — manager-led, multi-chain investment baskets. Initial settlement currency **USDC on Solana** (expandable). Users sign in with wallets (EVM SIWE + Solana SIWS), managers apply → are screened → create a verified **organization** → build **baskets** (versioned target allocations) → users invest; rebalances are proposed by managers but **executed only with user authorization**. Source-of-truth docs live in `docs/` (verbatim product sources in `docs/source/*` — never edit those).

## 2. Current state (as of 2026-09-30)

| Area | State |
|---|---|
| Spec 1 — foundation + user auth | ✅ merged to `main` (API, web, mobile). |
| Restructure (packages, API layout, pg_cron) | ✅ on `main` after `refactor/packages-and-api-layout` merge (verify with `git log --oneline -5`; if that branch still exists unmerged, stop and ask the user). |
| Spec 2 — manager application + screening | ✅ merged to `main` (`0db41ea`): public apply/status, `/ops` screening, platform roles, wallet-proof grant, self-approval blocked (ADR-007). |
| Spec 3 — organization onboarding | ✅ merged to `main` (`d409758`): org drafts + templates, R2 presigned documents, payout wallet proof + replacement review, ops review, public profile (ADR-008). Pre-release: real-R2 and AppKit Solana signing manual checks. |
| Spec 4 — members/roles | Spec written on branch `feat/spec4-members-roles` (`docs/superpowers/specs/2026-09-30-members-roles-design.md`); plan + implementation next. |
| Manual device/browser wallet E2E for Spec 1 | **Pending user** (needs Reown project ID, MetaMask/Phantom, Android/iOS dev build). |

### Monorepo layout (after restructure)
```
apps/api        Express 5 — src/app.ts (exports configured `app`), src/server.ts (imports app, listens),
                src/env.ts (envalid), middleware/, routes/, services/, providers/ (resend, twilio, evm-rpc), ops/cli.ts
apps/web        Next.js 16 App Router — /sign-in, /onboarding/contact, (app)/home, (app)/profile; `/api/*` rewrite → API
apps/mobile     Expo SDK 57 / RN 0.86 / Expo Router / NativeWind 5 — Reown AppKit RN behind useWalletConnector
packages/db          @repo/db — Drizzle schema (schema `app`), client, migrations (0000..), env, testing helpers
packages/logger      @repo/logger — winston (+ morgan → logger.http in api)
packages/validator   @repo/validator — zod re-export, chains, error codes + HTTP map, request/response schemas
packages/api-client  @repo/api-client — typed HTTP client (cookie for web / bearer + X-Client: mobile)
packages/app-core    @repo/app-core — client pure logic shared by web+mobile (error copy, verify reducer, wallet helpers, format, query client, useCountdown)
packages/design-tokens, packages/ui (keep), eslint-config, typescript-config
```
Packages export **TS source** (`exports: ./src/index.ts`); API bundles with tsup; turbo uses a transit node for lint/check-types/test.

### Key implemented behaviors (don't break)
- Backend-managed sessions (`sessions` table, HMAC-hashed opaque token). Web: httpOnly `bx_session` cookie via same-origin Next proxy; mobile: bearer in expo-secure-store. Web 12h idle/7d abs; mobile 7d/30d. Rotation on add-chain.
- Sign-in challenge state machine `pending → processing (30s lease) → consumed|rejected`; no DB tx during RPC; finalize atomic with account link + session.
- EVM: ECDSA-recovered EOA proof registers ethereum/base/bnb/arbitrum; ERC-1271/6492 only the verified chain. Solana ed25519 (node:crypto).
- CSRF: no CORS; Origin + `X-Requested-With: bytesac` on cookie mutations and web auth entry; mobile sends `X-Client: mobile`.
- Contacts OTP (email via Resend with idempotency key; SMS via Twilio Verify with mapped error codes), strict abuse limits (rate-limiter-flexible on Redis).
- Retention via **pg_cron** calling `app.purge_expired()` (SECURITY DEFINER). No BullMQ.
- DB access: backend only, schema `app`, role `bytesac_api` (no DELETE), RLS role-scoped policies, Supabase anon/authenticated revoked.
- Error body `{ error: { code, message, details? } }`, codes from `@repo/validator` (`http-errors` with `code`).

## 3. Rules the user set (mandatory)

1. **Docs in place:** whenever a decision/behavior changes, rewrite the affected `docs/**/*.md` (decision register, ADRs, architecture, domain docs, coding standards) — replace old text, never append "update" notes. Never edit `docs/source/*`.
2. **Lean code (ponytail):** no extra functions, no wrappers around library calls "just in case", no helper used once. Prefer pinned libraries over custom logic (JWT, HTTP, Redis, dates, UUID, retries, Zod). Invoke the `ponytail` skill for coding and `ponytail-review`/`ponytail-audit` for reviews.
3. **Official docs first:** for every library/provider (Twilio, Resend, Reown, Drizzle, Expo, Next, turbo, envalid, winston, rate-limiter-flexible, pg_cron…) implement from current official docs (WebFetch or installed README/types), not memory. Turbo: read bundled docs in `node_modules/.pnpm/turbo@*/node_modules/turbo/docs/`. Expo: `https://docs.expo.dev/versions/v57.0.0/` + `apps/mobile/AGENTS.md`.
4. **Shared code lives in `packages/`**, apps hold app code only; follow the API layout in §2 (reference style: `github.com/sameerkrdev/sameway` apps/api + packages/logger/db/validator).
5. **Supply chain:** never add pnpm `minimumReleaseAgeExclude` entries; if a version is too new, pin the newest allowed. Pin exact versions.
6. **Safety (AGENTS.md):** never move assets, sign/broadcast transactions, or touch production data; wallet auth ≠ spending authority; manager publication ≠ user consent; keep audit/history (status transitions, no hard deletes except retention).
7. **Don't commit** the root `AGENTS.md` if it only shows line-ending noise, or generated `apps/*/AGENTS.md` / `CLAUDE.md`.
8. Commit/PR attribution lines as the harness instructs; branch before committing (never commit on `main` directly); ask the user before merging or pushing.

## 4. Working method (what the user wants)

**Per spec:** brainstorm → written spec → implementation plan → execute → single review → one fix wave → user merge decision.

- **Brainstorming:** `superpowers:brainstorming`. Ask one multiple-choice question at a time with a recommended option; present the design **in one consolidated message** (user prefers fewer rounds); write spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`; get approval; commit.
- **Plan:** `superpowers:writing-plans`, but **few large tasks (≈4)**; full code only where logic is subtle (state machines, concurrency, security); otherwise precise paths, interfaces, exact names/values and concrete test cases, pointing at existing code patterns. Save to `docs/superpowers/plans/`.
- **Execution (the user's explicit model):**
  - Use **Sonnet 5.5** (`model: "sonnet"`) for implementer sub-agents and give each **multiple related tasks** (e.g., implementer #1 = API tasks, implementer #2 = web + docs tasks). Run them sequentially when they share files/interfaces.
  - Each implementer runs its own tests/gate per task and commits per task; it never spawns sub-agents.
  - **One Opus whole-branch review at the end** (`model: "opus"`), with a trimmed diff file (exclude lockfile/binaries/generated), the spec, plan and a list of known deviations.
  - **One Sonnet fix wave** addressing all Critical/Important and cheap Minor findings, then a short scoped re-review only if the fix touched security-critical code.
  - Keep the parent context lean: hand artifacts over as files (briefs, reports, review diffs under `.superpowers/sdd/<plan>/`, git-ignored), ask sub-agents for ≤12-line replies.
- **Sub-agent/model choice:** spawn only for independent/parallel or context-heavy work; easy/medium → Sonnet (or Haiku for tiny mechanical checks); never max-tier Opus for easy tasks; Opus only for the final review or genuinely hard design/concurrency work.
- **Gate commands:** `pnpm db:up` (Docker Postgres 17 + Redis 7), `pnpm turbo run lint check-types test build`, mobile: `pnpm --filter mobile test`, `pnpm --filter mobile check-types`, `cd apps/mobile && npx expo lint && npx expo export --platform android --output-dir <tmp>`.
- **Record rulings:** when you decide something on the user's behalf, log it and list every ruling (with "cost if wrong") in the final report.

## 5. Spec 4 — in progress

- Spec: `docs/superpowers/specs/2026-09-30-members-roles-design.md`; branch `feat/spec4-members-roles`. Basket-related member rules deferred to the basket spec.
- Next: plan (4 tasks per spec §15) → implementer #1 Tasks 1–2 (API), implementer #2 Tasks 3–4 (web + docs), Sonnet 5.5 for code-writing sub-agents → one Opus review → one Sonnet fix wave → user merge decision.
- Known env issue: Windows vitest worker crash (0xC0000409) hits ~1 in 2–3 full api runs on a random file (native Node crash; `pool: threads` makes it worse). Re-run crashed files; consider Linux CI or a newer Node.
- Spec 2/3 leftovers (not blocking): Spec 2 ops form offers "Not approved" for a proven approved application (server 409); Spec 3 orphan final R2 copy on DB failure after copy; open: email copy/sender domain, re-apply cooldown, jurisdiction templates, document retention.

## 6. Roadmap after Spec 2

Each spec follows §4. Scopes below are from `docs/source/*` and `docs/domains/*`; confirm with the user during brainstorming (one question at a time).

### Spec 3 — Organization onboarding (`Fund-Manager-&-Organisation-Onboarding-Flow.txt` §11–§24)
- Users with `create_manager_organization` create an organization (`INDIVIDUAL` | `FIRM`) in `DRAFT`; creator becomes `OWNER` membership.
- Configurable verification requirement templates (by org type/jurisdiction/product) → required fields + documents; **document upload to Cloudflare R2** (private, signed URLs, virus-scan decision, retention).
- **Payout wallet** (Solana) with signature ownership proof; statuses `UNVERIFIED/VERIFYING/VERIFIED/REPLACEMENT_PENDING/REVOKED`; history kept; replacement requires re-verification (+ optional delay/review).
- Org status machine `DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUIRED → RESUBMITTED → APPROVED/VERIFIED | REJECTED`; ops review UI extends Spec 2's `/ops`.
- Public vs private data split; public profile after verification; post-verification **change requests** with versioning (public version stays until approved).
- Likely questions: R2 upload flow (presigned direct upload vs via API), KYC/KYB provider or manual review only in release 1, which fields are public, change-request granularity (whole version vs per field).

### Spec 4 — Members, roles and permissions (onboarding flow §25–§38, Fund-Manager-Detailed-Features §10–§12)
- Owner/Admin invite members by wallet + role (`OWNER/ADMIN/MANAGER/ANALYST/VIEWER`), membership lifecycle (`INVITED → PENDING_WALLET_VERIFICATION → PENDING_DOCUMENTS → UNDER_REVIEW → APPROVED → ACTIVE`, `CHANGES_REQUIRED`, `REJECTED`, `REMOVAL_REQUESTED`, `REVOKED`), platform review where required, never hard-delete memberships; configurable permission matrix; ownership transfer; manager removal notifications; public manager history.

### Later phases (each needs its own brainstorm → spec; decisions marked OPEN in `DECISION-REGISTER.md` must be resolved first)
1. **Asset registry** (`Assets-Registry.txt`): instrument / deployment / route model, platform approval, lifecycle, eligibility policy; CoinMarketCap pricing adapter (ADR-002).
2. **Basket creation & review** (`Basket-Creation.txt`): versioned baskets owned by organizations, creation wizard, validation, platform review, publication, pause/retire, manager assignments & history.
3. **Public discovery & research** (`User-Detailed-Features.txt` §2–§5): public basket pages, filters, manager/org profiles (AI search later).
4. **Custody/execution decision (blocking)**: resolve D-022/D-023/D-024 (custody model, shared-asset policy, spend authority) with an ADR before any money movement.
5. **First investment** (`First-Investment,-Rebalancing,-Drift-&-Fix.txt`): transition planner, execution orchestrator (operations/steps/transactions, idempotency, partial completion), reconciliation; USDC-on-Solana settlement; requires verified email+phone (Spec 1 contacts).
6. **Rebalance / skip / drift / fix**, notifications.
7. **Subscriptions & fees**, manager payouts to verified payout wallet.
8. **Future plans** (`Future-Plans.txt`): multiple independent wallets, wallet migration, more asset classes — only after explicit approval.
- A real job queue (BullMQ or similar) is **not** installed; introduce it only when execution/orchestration specs need it (record as decision update).

## 7. Pending user actions & known deferred items

**User actions:** Reown project ID (web + mobile), Resend API key + sender domain, Twilio Verify service + allowed countries, Alchemy key (confirm BNB/Arbitrum hosts), Supabase project (enable `pg_cron`, set runtime/role passwords, pooler URL), load balancer must **overwrite** `X-Forwarded-For` (API `TRUST_PROXY` trusts only the Next hop), confirm bundle id `com.bytesac.app` + production metadata URL/icons, 7-year audit retention (OPEN with compliance), enforce CSP after manual wallet E2E, run Spec 1 manual wallet checklists (web: MetaMask/Phantom; mobile: dev build).

**Deferred minors (fix opportunistically, don't expand scope):** double-click contact add can show 404; resend countdown resets on remount (server enforces cooldown); logout awaits wallet disconnect (has timeout on mobile); CSP report-only has no report-uri; iOS keyboard double-adjust check; web ops/app Switch hit-area verified on device; `@wagmi/connectors` pinned 6.2.0 until Reown RN supports wagmi 3.

## 8. Where things are

- Specs: `docs/superpowers/specs/` · Plans: `docs/superpowers/plans/` · Audit: `docs/superpowers/audits/` · Restructure report: `docs/superpowers/plans/2026-09-29-restructure-report.md`
- Decisions: `docs/decisions/DECISION-REGISTER.md`, `ADR-00*.md` · Architecture: `docs/architecture/ARCHITECTURE.md` · Domains: `docs/domains/*.md` · Design system: `docs/BYTESAC_Design_System.md`
- API setup/ops: `apps/api/README.md` · Mobile setup: `apps/mobile/README.md` · Web deployment: `apps/web/README.md`
