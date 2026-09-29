# Spec 1 · Plan A — Shared Packages + API (Foundation & User Auth Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/api` (Express 5 modular monolith) plus `packages/design-tokens`, `packages/contracts` and `packages/api-client`, delivering production-grade wallet sign-in (SIWE/SIWS), backend sessions, chain-account linking, contacts/OTP, notification preferences, ops commands, retention, and in-place documentation updates.

**Architecture:** Controllers are thin; application services own flows; domain modules are pure; Drizzle repositories and provider adapters implement interfaces. PostgreSQL (Supabase in deployed envs, Docker locally) holds all durable state in schema `app` accessed only by least-privilege roles; Redis holds rate-limit counters and BullMQ queues. Contracts (Zod) are shared with clients.

**Tech Stack:** Node 24, TypeScript (strict), Express 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit + postgres.js, ioredis, BullMQ, viem 2, @noble/curves 2, bs58, pino, Resend, Twilio Verify, libphonenumber-js, uuid (v7), Vitest 5 + Supertest, Turborepo 2.11, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-29-foundation-user-auth-design.md` (read it fully before starting; this plan argues from it).

**Series:** Plan A (this) → Plan B `2026-09-29-spec1-b-web.md` → Plan C `2026-09-29-spec1-c-mobile.md`. B and C consume the packages and API built here.

## Global Constraints

- Node `>=24`; pnpm `11.25.0`; `turbo` `2.11.5`. Before editing `turbo.json`, read the bundled docs at `node_modules/.pnpm/turbo@2.11.5/node_modules/turbo/docs/` (`crafting-your-repository/configuring-tasks.mdx`, `using-environment-variables.mdx`, `guides/tools/vitest.mdx`) — required by root `AGENTS.md`.
- TypeScript `strict`; no `any` (use `unknown` + narrowing). ESM everywhere (`"type": "module"`, NodeNext, relative imports end in `.js`).
- Validation library: **Zod 4** only. Test runner: **Vitest** only.
- Session lifetimes: web **12 h idle / 7 d absolute**; mobile **7 d idle / 30 d absolute**. Renewal writes at most once per **5 minutes**.
- Challenge TTL **5 min**; processing lease **30 s**. OTP TTL **10 min**; max **5** attempts; resend cooldown **60 s**.
- Release-1 chains: `ethereum` (1), `base` (8453), `bnb` (56), `arbitrum` (42161), `solana` (cluster `mainnet`).
- Sign-in statement text, exactly: `Sign in to Bytesac. This does not authorize any transaction or spending.`
- Session cookie name `bx_session`; `HttpOnly; Secure (env-controlled); SameSite=Lax; Path=/`.
- CSRF header, exactly: `X-Requested-With: bytesac`.
- Rate limits: challenge 20/min per IP and 10/min per address; verify 30/min per IP; OTP 5/h per user, 3/h and 10/day per destination, 10/h per IP; global SMS 200/min, global email 1000/min.
- Retention: challenges 7 days after `expires_at`; sessions and contact verifications 90 days; audit events not purged (7-year period OPEN).
- Never log tokens, token hashes, signatures, OTP codes, full email/phone or secrets. Never delete rows except in the retention job.
- Money/transactions: none in this plan. Nothing here signs or broadcasts transactions.
- Every behavior/decision change updates `docs/` in place (see Task 24). `docs/source/*` stays verbatim.

## Review Focus

1. **Wallet returns a signature in an unexpected encoding** (e.g. EVM signature without `0x`, Solana signature as base64) → must be `SIGNATURE_INVALID` (challenge `rejected`), never a 500. Test added in Task 13.
2. **User double-clicks "Sign message" / network retry resubmits the same verify** → exactly one session; second call gets `CHALLENGE_IN_PROGRESS` or `CHALLENGE_CONSUMED`, never a second user. Test in Task 13.
3. **Mixed-case (checksummed) EVM address on sign-in after a lowercase sign-up** → same user (canonicalization), not a new account. Test in Task 13.
4. **Email entered with surrounding spaces/uppercase, phone without `+`** → normalized email accepted; phone without country code rejected with `VALIDATION_FAILED` and a clear message. Test in Task 18.
5. **Clock skew: client device clock wrong** → expiry decided only by DB time; a challenge issued "in the future" by client clock still verifies within 5 min server time. Test in Task 13 (server-issued timestamps only).

---

## File Structure

```
docker-compose.yml                         Postgres 17 + Redis 7 for dev/test
docker/postgres/init.sql                   dev/test DBs + Supabase-like anon/authenticated roles
turbo.json                                 + test, test:watch, dev dependsOn ^build, env lists
package.json                               + test, db:up scripts
packages/design-tokens/                    TS constants (palette, semantic, radii, fonts)
packages/contracts/src/
  chains.ts        chain registry + helpers
  errors.ts        ErrorCode union + HTTP status map + ApiErrorBody
  auth.ts          challenge/verify schemas
  me.ts            me/sessions schemas
  contacts.ts      contact schemas
  preferences.ts   notification preference schemas
  index.ts
packages/api-client/src/
  api-error.ts     ApiError class
  client.ts        createApiClient (cookie | bearer transport)
  index.ts
apps/api/
  package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts, drizzle.config.ts, .env.example, README.md
  src/config/env.ts                        Zod env loader
  src/shared/errors.ts                     DomainError
  src/shared/logger.ts                     pino with redaction
  src/shared/request-context.ts            request id + RequestMeta + ipPrefix
  src/shared/error-handler.ts              Express error → ApiErrorBody
  src/shared/pg-errors.ts                  unique-violation detection
  src/shared/audit.ts                      AuditWriter
  src/shared/validate.ts                   Zod parse helper → DomainError
  src/db/schema/{enums,identity,contacts,audit,index}.ts
  src/db/client.ts                         createDb(url)
  src/db/migrate.ts                        run migrations (migrator role)
  src/db/dev-roles.ts                      local-only: give roles LOGIN + dev passwords
  src/db/migrations/                       generated + custom SQL
  src/adapters/rate-limiter.ts             RateLimiter + RedisRateLimiter
  src/adapters/evm-rpc.ts                  EvmRpc + AlchemyEvmRpc
  src/adapters/email-sender.ts             EmailSender + ResendEmailSender
  src/adapters/sms-otp.ts                  SmsOtpProvider + TwilioVerifySmsOtp
  src/http/security.ts                     noCors, csrfGuard, rejectDualAuth
  src/modules/identity/domain/{address,sign-in-message,session-policy,verification-scope}.ts
  src/modules/identity/infra/{evm-signature-verifier,solana-signature-verifier,signature-verifier,challenge-repository,session-repository,wallet-repository}.ts
  src/modules/identity/application/{challenge-service,sign-in-service,session-service}.ts
  src/modules/identity/http/{session-cookie,require-session,auth-routes,me-routes}.ts
  src/modules/contacts/domain/{contact-value,otp}.ts
  src/modules/contacts/infra/{contact-repository,preferences-repository}.ts
  src/modules/contacts/application/{contact-service,preferences-service}.ts
  src/modules/contacts/http/{contact-routes,preferences-routes}.ts
  src/ops/{ops-service,cli}.ts
  src/jobs/retention.ts
  src/app.ts, src/deps.ts, src/server.ts, src/worker.ts
  test/global-setup.ts, test/helpers/{db,app,wallets,fakes}.ts, test/**/*.test.ts
docs/…                                     in-place updates (Task 24)
```

---

### Task 1: Monorepo tooling, local infra

**Files:**
- Create: `docker-compose.yml`, `docker/postgres/init.sql`
- Modify: `turbo.json`, `package.json`, `.gitignore`

**Interfaces:**
- Produces: `pnpm db:up` (starts Postgres on `localhost:54329`, Redis on `localhost:63799`); databases `bytesac_dev`, `bytesac_test`; roles `anon`, `authenticated` (NOLOGIN, mirroring Supabase); turbo tasks `test`, `test:watch`.

- [ ] **Step 1: Read turbo docs** — read `configuring-tasks.mdx`, `using-environment-variables.mdx`, `guides/tools/vitest.mdx` under `node_modules/.pnpm/turbo@2.11.5/node_modules/turbo/docs/crafting-your-repository/` and `.../docs/guides/tools/`.

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    ports:
      - "54329:5432"
    volumes:
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - bytesac_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      retries: 30
  redis:
    image: redis:7
    ports:
      - "63799:6379"
volumes:
  bytesac_pg:
```

- [ ] **Step 3: Create `docker/postgres/init.sql`**

```sql
-- Local/test only. Mirrors Supabase client roles so grant/RLS tests are meaningful.
CREATE DATABASE bytesac_dev;
CREATE DATABASE bytesac_test;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
```

- [ ] **Step 4: Replace `turbo.json`**

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**", "!.next/dev/**", "dist/**"]
    },
    "lint": { "dependsOn": ["^build", "^lint"] },
    "check-types": { "dependsOn": ["^build", "^check-types"] },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env.test*"],
      "env": ["TEST_DATABASE_URL", "TEST_ADMIN_DATABASE_URL", "TEST_REDIS_URL"]
    },
    "test:watch": { "cache": false, "persistent": true },
    "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 5: Update root `package.json` scripts**

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "check-types": "turbo run check-types",
    "db:up": "docker compose up -d --wait",
    "db:down": "docker compose down"
  }
}
```
(Keep existing `devDependencies`, `packageManager`, `engines`.)

- [ ] **Step 6: Append to `.gitignore`**

```
# Env (keep examples)
!.env.example
.env.test.local
```

- [ ] **Step 7: Verify**

Run: `pnpm db:up && docker compose exec postgres psql -U postgres -c "\l" | grep bytesac`
Expected: `bytesac_dev` and `bytesac_test` listed. Run `docker compose exec redis redis-cli ping` → `PONG`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml docker/postgres/init.sql turbo.json package.json .gitignore
git commit -m "chore: add local Postgres/Redis and turbo test tasks"
```

---

### Task 2: `packages/design-tokens`

**Files:**
- Create: `packages/design-tokens/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`, `vitest.config.ts`

**Interfaces:**
- Produces: `import { palette, semantic, radii, fonts, surfaces } from "@repo/design-tokens"` — `palette.space === "#0B1117"` etc.; consumed by Plans B and C.

- [ ] **Step 1: Create `packages/design-tokens/package.json`**

```json
{
  "name": "@repo/design-tokens",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "typescript": "7.0.2",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

- [ ] **Step 2: Create `packages/design-tokens/tsconfig.json`**

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "lib": ["es2022"] },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

And `packages/design-tokens/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Write the failing test `src/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { fonts, palette, radii, semantic, surfaces } from "./index.js";

describe("design tokens match docs/BYTESAC_Design_System.md", () => {
  it("brand palette", () => {
    expect(palette).toEqual({
      space: "#0B1117", slate: "#1F2937", stone: "#6B7280", sage: "#10B981",
      mint: "#6EE7B7", sand: "#EEDCC8", ivory: "#FAFAF8",
    });
  });
  it("semantic colors", () => {
    expect(semantic).toEqual({
      success: "#22C55E", warning: "#F59E0B", danger: "#F87171", info: "#60A5FA",
      borderDark: "#26323D", overlay: "rgba(5, 9, 13, 0.72)",
    });
  });
  it("surfaces, radii and fonts", () => {
    expect(surfaces).toEqual({ card: "#111B24", mutedForeground: "#A1AAB5" });
    expect(radii).toEqual({ sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, pill: 999 });
    expect(fonts).toEqual({ display: "Manrope", body: "Inter" });
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (`Cannot find module './index.js'`)

Run: `pnpm install && pnpm --filter @repo/design-tokens test`

- [ ] **Step 5: Implement `src/index.ts`**

```ts
/** Single TS source of BYTESAC tokens. Values copied verbatim from docs/BYTESAC_Design_System.md. */
export const palette = {
  space: "#0B1117",
  slate: "#1F2937",
  stone: "#6B7280",
  sage: "#10B981",
  mint: "#6EE7B7",
  sand: "#EEDCC8",
  ivory: "#FAFAF8",
} as const;

export const semantic = {
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",
  info: "#60A5FA",
  borderDark: "#26323D",
  overlay: "rgba(5, 9, 13, 0.72)",
} as const;

/** Derived surfaces from design system §11 (`--card`, `--muted-foreground`). */
export const surfaces = { card: "#111B24", mutedForeground: "#A1AAB5" } as const;

/** Radii in px (design system §5). */
export const radii = { sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, pill: 999 } as const;

export const fonts = { display: "Manrope", body: "Inter" } as const;

export type PaletteColor = keyof typeof palette;
```

- [ ] **Step 6: Run tests and build — expect PASS**

Run: `pnpm --filter @repo/design-tokens test && pnpm --filter @repo/design-tokens build`

- [ ] **Step 7: Commit**

```bash
git add packages/design-tokens pnpm-lock.yaml
git commit -m "feat(design-tokens): add BYTESAC token package"
```

---

### Task 3: `packages/contracts` — chains and error codes

**Files:**
- Create: `packages/contracts/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/chains.ts`, `src/errors.ts`, `src/index.ts`, `src/chains.test.ts`, `src/errors.test.ts`

**Interfaces:**
- Produces:
  - `type Chain = "ethereum" | "base" | "bnb" | "arbitrum" | "solana"`; `type ChainFamily = "evm" | "solana"`; `chainSchema`, `chainFamilySchema`
  - `CHAINS: Record<Chain, { family: ChainFamily; label: string; evmChainId?: number; solanaCluster?: "mainnet" }>`
  - `familyOf(chain: Chain): ChainFamily`; `chainsInFamily(family: ChainFamily): Chain[]`; `chainFromEvmChainId(id: number): Chain | undefined`
  - `ERROR_CODES` (readonly tuple), `type ErrorCode`, `ERROR_HTTP_STATUS: Record<ErrorCode, number>`, `type ApiErrorBody = { error: { code: ErrorCode; message: string; details?: unknown } }`, `apiErrorBodySchema`

- [ ] **Step 1: Create `packages/contracts/package.json`**

```json
{
  "name": "@repo/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "4.6.5" },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "typescript": "7.0.2",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```
`tsconfig.json` and `vitest.config.ts`: identical to Task 2's files.

- [ ] **Step 2: Write failing tests**

`src/chains.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CHAINS, chainFromEvmChainId, chainsInFamily, familyOf } from "./chains.js";

describe("chains", () => {
  it("maps families", () => {
    expect(familyOf("base")).toBe("evm");
    expect(familyOf("solana")).toBe("solana");
    expect(chainsInFamily("evm")).toEqual(["ethereum", "base", "bnb", "arbitrum"]);
    expect(chainsInFamily("solana")).toEqual(["solana"]);
  });
  it("maps EVM chain ids", () => {
    expect(CHAINS.ethereum.evmChainId).toBe(1);
    expect(chainFromEvmChainId(8453)).toBe("base");
    expect(chainFromEvmChainId(56)).toBe("bnb");
    expect(chainFromEvmChainId(42161)).toBe("arbitrum");
    expect(chainFromEvmChainId(137)).toBeUndefined();
  });
});
```

`src/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_HTTP_STATUS, apiErrorBodySchema } from "./errors.js";

describe("errors", () => {
  it("every code has an HTTP status", () => {
    for (const code of ERROR_CODES) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
  it("parses the error body shape", () => {
    const body = { error: { code: "SESSION_EXPIRED", message: "Session expired" } };
    expect(apiErrorBodySchema.parse(body)).toEqual(body);
    expect(() => apiErrorBodySchema.parse({ error: { code: "NOPE", message: "x" } })).toThrow();
  });
});
```

- [ ] **Step 3: Run — expect FAIL** — `pnpm install && pnpm --filter @repo/contracts test`

- [ ] **Step 4: Implement `src/chains.ts`**

```ts
import { z } from "zod";

export const chainSchema = z.enum(["ethereum", "base", "bnb", "arbitrum", "solana"]);
export type Chain = z.infer<typeof chainSchema>;
export const chainFamilySchema = z.enum(["evm", "solana"]);
export type ChainFamily = z.infer<typeof chainFamilySchema>;

interface ChainInfo {
  family: ChainFamily;
  label: string;
  evmChainId?: number;
  solanaCluster?: "mainnet";
}

export const CHAINS: Readonly<Record<Chain, ChainInfo>> = {
  ethereum: { family: "evm", label: "Ethereum", evmChainId: 1 },
  base: { family: "evm", label: "Base", evmChainId: 8453 },
  bnb: { family: "evm", label: "BNB Chain", evmChainId: 56 },
  arbitrum: { family: "evm", label: "Arbitrum", evmChainId: 42161 },
  solana: { family: "solana", label: "Solana", solanaCluster: "mainnet" },
};

const ORDER: readonly Chain[] = chainSchema.options;

export function familyOf(chain: Chain): ChainFamily {
  return CHAINS[chain].family;
}

export function chainsInFamily(family: ChainFamily): Chain[] {
  return ORDER.filter((c) => CHAINS[c].family === family);
}

export function chainFromEvmChainId(id: number): Chain | undefined {
  return ORDER.find((c) => CHAINS[c].evmChainId === id);
}
```

- [ ] **Step 5: Implement `src/errors.ts`**

```ts
import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_FAILED", "UNSUPPORTED_CHAIN", "CHALLENGE_NOT_FOUND", "CHALLENGE_EXPIRED",
  "CHALLENGE_CONSUMED", "CHALLENGE_IN_PROGRESS", "SIGNATURE_INVALID", "VERIFIER_UNAVAILABLE",
  "ADDRESS_DISABLED", "ADDRESS_ALREADY_LINKED", "CHAIN_FAMILY_ALREADY_LINKED", "SESSION_EXPIRED",
  "USER_NOT_ACTIVE", "CSRF_REJECTED", "NOT_FOUND", "OTP_INVALID", "OTP_EXPIRED",
  "OTP_ATTEMPTS_EXCEEDED", "OTP_COOLDOWN", "OTP_DELIVERY_FAILED", "RATE_LIMITED", "INTERNAL",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNSUPPORTED_CHAIN: 400,
  CHALLENGE_NOT_FOUND: 404,
  CHALLENGE_EXPIRED: 410,
  CHALLENGE_CONSUMED: 409,
  CHALLENGE_IN_PROGRESS: 409,
  SIGNATURE_INVALID: 401,
  VERIFIER_UNAVAILABLE: 503,
  ADDRESS_DISABLED: 403,
  ADDRESS_ALREADY_LINKED: 409,
  CHAIN_FAMILY_ALREADY_LINKED: 409,
  SESSION_EXPIRED: 401,
  USER_NOT_ACTIVE: 401,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_ATTEMPTS_EXCEEDED: 429,
  OTP_COOLDOWN: 429,
  OTP_DELIVERY_FAILED: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const apiErrorBodySchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string(), details: z.unknown().optional() }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
```

- [ ] **Step 6: `src/index.ts`**

```ts
export * from "./chains.js";
export * from "./errors.js";
```

- [ ] **Step 7: Run tests + build — expect PASS** — `pnpm --filter @repo/contracts test && pnpm --filter @repo/contracts build`

- [ ] **Step 8: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): add chain registry and error codes"
```

---

### Task 4: `packages/contracts` — request/response schemas

**Files:**
- Create: `packages/contracts/src/auth.ts`, `me.ts`, `contacts.ts`, `preferences.ts`, `schemas.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces (all exported with inferred types of the same name minus `Schema`):
  - `clientKindSchema` (`"web" | "mobile"`), `challengePurposeSchema`, `challengeRequestSchema` `{purpose, chain, address}`, `challengeResponseSchema` `{challengeId, message, expiresAt}`, `verifyRequestSchema` `{challengeId, signature, walletProvider?, client}`, `verifyResponseSchema` `{userId, isNewUser, token?}`
  - `verificationMethodSchema` (`eoa_ecdsa|erc1271|erc6492|ed25519`), `walletAddressViewSchema`, `meResponseSchema`, `sessionViewSchema`, `sessionsResponseSchema`
  - `contactTypeSchema`, `contactStatusSchema`, `contactViewSchema`, `addContactRequestSchema`, `addContactResponseSchema`, `verifyContactRequestSchema`
  - `notificationPreferencesSchema`, `updateNotificationPreferencesSchema`

- [ ] **Step 1: Write failing test `src/schemas.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  addContactRequestSchema, challengeRequestSchema, updateNotificationPreferencesSchema,
  verifyContactRequestSchema, verifyRequestSchema,
} from "./index.js";

describe("schemas", () => {
  it("challenge request", () => {
    expect(challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc" }).chain).toBe("base");
    expect(() => challengeRequestSchema.parse({ purpose: "sign_in", chain: "polygon", address: "0xabc" })).toThrow();
  });
  it("verify request requires uuid challenge id and client", () => {
    expect(() => verifyRequestSchema.parse({ challengeId: "x", signature: "0x1", client: "web" })).toThrow();
    const ok = verifyRequestSchema.parse({
      challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", signature: "0x1", client: "mobile",
    });
    expect(ok.client).toBe("mobile");
  });
  it("otp code is 6 digits", () => {
    expect(() => verifyContactRequestSchema.parse({ code: "12345" })).toThrow();
    expect(verifyContactRequestSchema.parse({ code: "123456" }).code).toBe("123456");
  });
  it("contact type is email or phone", () => {
    expect(() => addContactRequestSchema.parse({ type: "fax", value: "1" })).toThrow();
  });
  it("preferences patch rejects empty and unknown keys", () => {
    expect(() => updateNotificationPreferencesSchema.parse({})).toThrow();
    expect(() => updateNotificationPreferencesSchema.parse({ security: false })).toThrow();
    expect(updateNotificationPreferencesSchema.parse({ marketing: true })).toEqual({ marketing: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `pnpm --filter @repo/contracts test`

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
import { z } from "zod";
import { chainSchema } from "./chains.js";

export const clientKindSchema = z.enum(["web", "mobile"]);
export type ClientKind = z.infer<typeof clientKindSchema>;

export const challengePurposeSchema = z.enum(["sign_in", "add_chain_account"]);
export type ChallengePurpose = z.infer<typeof challengePurposeSchema>;

export const challengeRequestSchema = z.strictObject({
  purpose: challengePurposeSchema,
  chain: chainSchema,
  address: z.string().trim().min(1).max(128),
});
export type ChallengeRequest = z.infer<typeof challengeRequestSchema>;

export const challengeResponseSchema = z.object({
  challengeId: z.uuid(),
  message: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

export const verifyRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  /** EVM: 0x-prefixed hex. Solana: base58 of the 64-byte ed25519 signature. */
  signature: z.string().min(1).max(20_000),
  walletProvider: z.string().trim().max(64).optional(),
  client: clientKindSchema,
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const verifyResponseSchema = z.object({
  userId: z.uuid(),
  isNewUser: z.boolean(),
  /** Present only for client "mobile" when a new session token was issued. */
  token: z.string().optional(),
});
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;
```

- [ ] **Step 4: Implement `src/me.ts`**

```ts
import { z } from "zod";
import { chainFamilySchema, chainSchema } from "./chains.js";
import { clientKindSchema } from "./auth.js";
import { contactViewSchema } from "./contacts.js";

export const verificationMethodSchema = z.enum(["eoa_ecdsa", "erc1271", "erc6492", "ed25519"]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const walletAddressViewSchema = z.object({
  chain: chainSchema,
  chainFamily: chainFamilySchema,
  address: z.string(),
  status: z.enum(["active", "disabled"]),
  verificationMethod: verificationMethodSchema,
  verifiedAt: z.iso.datetime({ offset: true }),
});
export type WalletAddressView = z.infer<typeof walletAddressViewSchema>;

export const meResponseSchema = z.object({
  user: z.object({ id: z.uuid(), status: z.enum(["pending", "active", "suspended"]), createdAt: z.iso.datetime({ offset: true }) }),
  wallet: z.object({
    id: z.uuid(),
    walletProvider: z.string().nullable(),
    addresses: z.array(walletAddressViewSchema),
  }),
  contacts: z.array(contactViewSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const sessionViewSchema = z.object({
  id: z.uuid(),
  client: clientKindSchema,
  createdAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  userAgent: z.string().nullable(),
  ipPrefix: z.string().nullable(),
  current: z.boolean(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const sessionsResponseSchema = z.object({ sessions: z.array(sessionViewSchema) });
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
```

- [ ] **Step 5: Implement `src/contacts.ts`**

```ts
import { z } from "zod";

export const contactTypeSchema = z.enum(["email", "phone"]);
export type ContactType = z.infer<typeof contactTypeSchema>;
export const contactStatusSchema = z.enum(["unverified", "verified"]);

export const contactViewSchema = z.object({
  id: z.uuid(),
  type: contactTypeSchema,
  value: z.string(),
  status: contactStatusSchema,
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ContactView = z.infer<typeof contactViewSchema>;

export const addContactRequestSchema = z.strictObject({
  type: contactTypeSchema,
  /** Email address, or phone in international format starting with "+". */
  value: z.string().trim().min(3).max(254),
});
export type AddContactRequest = z.infer<typeof addContactRequestSchema>;

export const addContactResponseSchema = z.object({
  contact: contactViewSchema,
  verification: z.object({
    expiresAt: z.iso.datetime({ offset: true }),
    resendAvailableAt: z.iso.datetime({ offset: true }),
  }),
});
export type AddContactResponse = z.infer<typeof addContactResponseSchema>;

export const verifyContactRequestSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export type VerifyContactRequest = z.infer<typeof verifyContactRequestSchema>;
```

- [ ] **Step 6: Implement `src/preferences.ts`**

```ts
import { z } from "zod";

const shape = {
  rebalance: z.boolean(),
  portfolioUpdates: z.boolean(),
  managerUpdates: z.boolean(),
  offers: z.boolean(),
  productUpdates: z.boolean(),
  marketing: z.boolean(),
};

export const notificationPreferencesSchema = z.strictObject(shape);
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesSchema = z
  .strictObject(shape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one preference is required" });
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
```

- [ ] **Step 7: Update `src/index.ts`**

```ts
export * from "./chains.js";
export * from "./errors.js";
export * from "./auth.js";
export * from "./contacts.js";
export * from "./me.js";
export * from "./preferences.js";
```

- [ ] **Step 8: Run tests + build — expect PASS** — `pnpm --filter @repo/contracts test && pnpm --filter @repo/contracts build`

- [ ] **Step 9: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add auth, me, contacts and preferences schemas"
```

---

### Task 5: `packages/api-client`

**Files:**
- Create: `packages/api-client/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/api-error.ts`, `src/client.ts`, `src/index.ts`, `src/client.test.ts`

**Interfaces:**
- Consumes: `@repo/contracts` schemas/types.
- Produces:
  ```ts
  type Transport = { kind: "cookie" } | { kind: "bearer"; getToken: () => Promise<string | null> };
  interface ApiClientOptions { baseUrl: string; transport: Transport; fetch?: typeof fetch }
  function createApiClient(o: ApiClientOptions): ApiClient;
  interface ApiClient {
    createChallenge(b: ChallengeRequest): Promise<ChallengeResponse>;
    verify(b: VerifyRequest): Promise<VerifyResponse>;
    logout(): Promise<void>; logoutAll(): Promise<void>;
    me(): Promise<MeResponse>; sessions(): Promise<SessionsResponse>; revokeSession(id: string): Promise<void>;
    addContact(b: AddContactRequest): Promise<AddContactResponse>;
    verifyContact(id: string, b: VerifyContactRequest): Promise<ContactView>;
    resendContact(id: string): Promise<AddContactResponse>;
    getPreferences(): Promise<NotificationPreferences>;
    updatePreferences(b: UpdateNotificationPreferences): Promise<NotificationPreferences>;
  }
  class ApiError extends Error { code: ErrorCode | "NETWORK_ERROR"; status: number; retryAfterSec?: number }
  ```
  Paths are relative to `baseUrl` and begin with `/v1/...` (web uses `baseUrl: "/api"`; mobile uses `EXPO_PUBLIC_API_URL`). Every request sends `X-Requested-With: bytesac`; bearer transport additionally sends `X-Client: mobile` (required by the API CSRF guard for Origin-less mobile `/v1/auth/challenge`).

- [ ] **Step 1: `package.json`** — same as contracts' with name `@repo/api-client`, plus `"dependencies": { "@repo/contracts": "workspace:*", "zod": "4.6.5" }`. `tsconfig.json`/`vitest.config.ts` as in Task 2, but `tsconfig.json` `lib: ["es2022", "DOM"]`.

- [ ] **Step 2: Write failing test `src/client.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("api client", () => {
  it("cookie transport sends credentials and CSRF header", async () => {
    const f = vi.fn(async () => jsonResponse(200, { challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", message: "m", expiresAt: "2026-01-01T00:00:00.000Z" }));
    const api = createApiClient({ baseUrl: "/api", transport: { kind: "cookie" }, fetch: f });
    await api.createChallenge({ purpose: "sign_in", chain: "base", address: "0xabc" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/challenge");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("X-Requested-With")).toBe("bytesac");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("bearer transport adds Authorization and omits credentials", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: "https://api.test", transport: { kind: "bearer", getToken: async () => "tok" }, fetch: f });
    await api.logout();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/auth/logout");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(new Headers(init.headers).get("X-Client")).toBe("mobile");
  });

  it("maps error bodies to ApiError with retry-after", async () => {
    const f = vi.fn(async () => jsonResponse(429, { error: { code: "RATE_LIMITED", message: "slow down" } }, { "retry-after": "12" }));
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("RATE_LIMITED");
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).retryAfterSec).toBe(12);
  });

  it("maps network failures to NETWORK_ERROR", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    const err = await api.me().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("NETWORK_ERROR");
  });

  it("rejects malformed success bodies", async () => {
    const f = vi.fn(async () => jsonResponse(200, { nope: true }));
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    await expect(api.me()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
```

- [ ] **Step 3: Run — expect FAIL** — `pnpm install && pnpm --filter @repo/api-client test`

- [ ] **Step 4: Implement `src/api-error.ts`**

```ts
import type { ErrorCode } from "@repo/contracts";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK_ERROR",
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

- [ ] **Step 5: Implement `src/client.ts`**

```ts
import {
  addContactResponseSchema, apiErrorBodySchema, challengeResponseSchema, contactViewSchema,
  meResponseSchema, notificationPreferencesSchema, sessionsResponseSchema, verifyResponseSchema,
  type AddContactRequest, type AddContactResponse, type ChallengeRequest, type ChallengeResponse,
  type ContactView, type MeResponse, type NotificationPreferences, type SessionsResponse,
  type UpdateNotificationPreferences, type VerifyContactRequest, type VerifyRequest, type VerifyResponse,
} from "@repo/contracts";
import type { z } from "zod";
import { ApiError } from "./api-error.js";

export type Transport = { kind: "cookie" } | { kind: "bearer"; getToken: () => Promise<string | null> };
export interface ApiClientOptions { baseUrl: string; transport: Transport; fetch?: typeof fetch }

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<S extends z.ZodType>(method: Method, path: string, schema: S | null, body?: unknown): Promise<z.infer<S>> {
    const headers = new Headers({ Accept: "application/json", "X-Requested-With": "bytesac" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (options.transport.kind === "bearer") {
      // Native clients identify themselves so the API's CSRF guard can exempt Origin-less mobile sign-in.
      headers.set("X-Client", "mobile");
      const token = await options.transport.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    let res: Response;
    try {
      res = await doFetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: options.transport.kind === "cookie" ? "same-origin" : "omit",
      });
    } catch {
      throw new ApiError("NETWORK_ERROR", 0, "Network request failed");
    }
    if (!res.ok) {
      const retry = res.headers.get("retry-after");
      const parsed = apiErrorBodySchema.safeParse(await res.json().catch(() => null));
      if (parsed.success) {
        throw new ApiError(parsed.data.error.code, res.status, parsed.data.error.message, retry ? Number(retry) : undefined);
      }
      throw new ApiError("INTERNAL", res.status, `Unexpected ${res.status} response`);
    }
    if (schema === null) return undefined as z.infer<S>;
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ApiError("INTERNAL", res.status, "Malformed response");
    return parsed.data;
  }

  return {
    createChallenge: (b: ChallengeRequest): Promise<ChallengeResponse> => request("POST", "/v1/auth/challenge", challengeResponseSchema, b),
    verify: (b: VerifyRequest): Promise<VerifyResponse> => request("POST", "/v1/auth/verify", verifyResponseSchema, b),
    logout: (): Promise<void> => request("POST", "/v1/auth/logout", null),
    logoutAll: (): Promise<void> => request("POST", "/v1/auth/logout-all", null),
    me: (): Promise<MeResponse> => request("GET", "/v1/me", meResponseSchema),
    sessions: (): Promise<SessionsResponse> => request("GET", "/v1/me/sessions", sessionsResponseSchema),
    revokeSession: (id: string): Promise<void> => request("DELETE", `/v1/me/sessions/${encodeURIComponent(id)}`, null),
    addContact: (b: AddContactRequest): Promise<AddContactResponse> => request("POST", "/v1/me/contacts", addContactResponseSchema, b),
    verifyContact: (id: string, b: VerifyContactRequest): Promise<ContactView> =>
      request("POST", `/v1/me/contacts/${encodeURIComponent(id)}/verify`, contactViewSchema, b),
    resendContact: (id: string): Promise<AddContactResponse> =>
      request("POST", `/v1/me/contacts/${encodeURIComponent(id)}/resend`, addContactResponseSchema),
    getPreferences: (): Promise<NotificationPreferences> => request("GET", "/v1/me/notification-preferences", notificationPreferencesSchema),
    updatePreferences: (b: UpdateNotificationPreferences): Promise<NotificationPreferences> =>
      request("PATCH", "/v1/me/notification-preferences", notificationPreferencesSchema, b),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

- [ ] **Step 6: `src/index.ts`**

```ts
export * from "./api-error.js";
export * from "./client.js";
```

- [ ] **Step 7: Run tests + build — expect PASS** — `pnpm --filter @repo/api-client test && pnpm --filter @repo/api-client build`

- [ ] **Step 8: Commit**

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "feat(api-client): add typed API client with cookie and bearer transports"
```

---

### Task 6: `apps/api` scaffold — env, errors, logger, request context, error handler, health

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.env.example`, `src/config/env.ts`, `src/shared/errors.ts`, `src/shared/logger.ts`, `src/shared/request-context.ts`, `src/shared/error-handler.ts`, `src/shared/validate.ts`, `src/app.ts`, `src/server.ts`, `test/shared/request-context.test.ts`, `test/shared/error-handler.test.ts`, `test/config/env.test.ts`

**Interfaces:**
- Produces:
  - `loadEnv(source?: NodeJS.ProcessEnv): Env` (throws listing invalid keys). `Env` fields: `NODE_ENV`, `PORT`, `DATABASE_URL`, `MIGRATOR_DATABASE_URL?`, `RETENTION_DATABASE_URL?`, `REDIS_URL`, `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET`, `ALCHEMY_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SMS_ALLOWED_COUNTRIES: string[]`, `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS: string[]`, `COOKIE_SECURE: boolean`, `TRUST_PROXY: string`, `LOG_LEVEL`.
  - `class DomainError extends Error { code: ErrorCode; details?: unknown; retryAfterSec?: number }`
  - `createLogger(level): Logger` (pino, redacted)
  - `requestContext` middleware setting `req.ctx: RequestMeta = { requestId, ip, ipPrefix, userAgent }`; `ipPrefixOf(ip: string): string | null`
  - `errorHandler(logger)` Express error middleware
  - `parseOrThrow<S>(schema: S, input: unknown): z.infer<S>`
  - `createApp(deps: AppDeps): express.Express` (routes added in later tasks through `deps`), `AppDeps` defined in `src/deps.ts` in Task 7.

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "worker": "tsx src/worker.ts",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:dev-roles": "tsx src/db/dev-roles.ts",
    "ops:address-disable": "tsx src/ops/cli.ts address-disable",
    "ops:address-reactivate": "tsx src/ops/cli.ts address-reactivate",
    "ops:user-suspend": "tsx src/ops/cli.ts user-suspend"
  }
}
```

- [ ] **Step 2: Install dependencies (from repo root)**

```bash
pnpm --filter api add express@5.2.1 cookie-parser@1.4.7 zod@4.6.5 drizzle-orm@0.45.3 postgres@3.4.9 ioredis@6.0.0 bullmq@6.3.9 viem@2.56.9 @noble/curves@2.4.0 bs58@6.0.0 pino@10.3.1 pino-http@11.0.0 resend@6.30.0 twilio@6.1.2 libphonenumber-js@1.13.14 uuid@14.0.2 @repo/contracts@workspace:*
pnpm --filter api add -D typescript@7.0.2 tsx@4.23.15 drizzle-kit@0.31.11 vitest@5.0.2 vite@8.3.1 supertest@7.3.0 @types/supertest@7.2.1 @types/express@5.0.6 @types/cookie-parser@1.4.10 @types/node@26.4.1 @repo/typescript-config@workspace:*
```

- [ ] **Step 3: Create TS configs**

`apps/api/tsconfig.json`:
```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": { "lib": ["es2022"], "types": ["node"], "noEmit": true },
  "include": ["src", "test", "vitest.config.ts", "drizzle.config.ts"]
}
```
`apps/api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "declaration": false, "declarationMap": false },
  "include": ["src"]
}
```
`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```
Create a placeholder `apps/api/test/global-setup.ts` (replaced in Task 7):
```ts
export default async function setup(): Promise<void> {}
```

- [ ] **Step 4: Create `apps/api/.env.example`**

```dotenv
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
# Runtime role (least privilege). Local: see README "Local setup".
DATABASE_URL=postgres://bytesac_api:bytesac_api_dev@localhost:54329/bytesac_dev
# Schema owner used only by db:migrate. Supabase: the project's postgres role.
MIGRATOR_DATABASE_URL=postgres://postgres:postgres@localhost:54329/bytesac_dev
# Worker retention role.
RETENTION_DATABASE_URL=postgres://bytesac_retention:bytesac_retention_dev@localhost:54329/bytesac_dev
REDIS_URL=redis://localhost:63799/0
SESSION_TOKEN_PEPPER=
OTP_HMAC_SECRET=
ALCHEMY_API_KEY=
RESEND_API_KEY=
EMAIL_FROM=Bytesac <no-reply@example.com>
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
SMS_ALLOWED_COUNTRIES=IN,US,GB,SG,AE
AUTH_DOMAIN=localhost:3000
AUTH_URI=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
COOKIE_SECURE=false
TRUST_PROXY=loopback
# Test (vitest)
TEST_DATABASE_URL=postgres://bytesac_api:bytesac_api_dev@localhost:54329/bytesac_test
TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:54329/bytesac_test
TEST_REDIS_URL=redis://localhost:63799/1
```

- [ ] **Step 5: Write failing tests**

`test/config/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

const base = {
  NODE_ENV: "test", PORT: "4000", DATABASE_URL: "postgres://a@b/c", REDIS_URL: "redis://x:1/0",
  SESSION_TOKEN_PEPPER: "p".repeat(32), OTP_HMAC_SECRET: "s".repeat(32), ALCHEMY_API_KEY: "k",
  RESEND_API_KEY: "r", EMAIL_FROM: "Bytesac <a@b.co>", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t",
  TWILIO_VERIFY_SERVICE_SID: "VA1", SMS_ALLOWED_COUNTRIES: "IN, us", AUTH_DOMAIN: "localhost:3000",
  AUTH_URI: "http://localhost:3000", ALLOWED_ORIGINS: "http://localhost:3000,https://app.bytesac.com",
};

describe("loadEnv", () => {
  it("parses lists and booleans", () => {
    const env = loadEnv(base);
    expect(env.SMS_ALLOWED_COUNTRIES).toEqual(["IN", "US"]);
    expect(env.ALLOWED_ORIGINS).toEqual(["http://localhost:3000", "https://app.bytesac.com"]);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.PORT).toBe(4000);
  });
  it("rejects short secrets and names the key", () => {
    expect(() => loadEnv({ ...base, SESSION_TOKEN_PEPPER: "short" })).toThrow(/SESSION_TOKEN_PEPPER/);
  });
});
```

`test/shared/request-context.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ipPrefixOf } from "../../src/shared/request-context.js";

describe("ipPrefixOf", () => {
  it("IPv4 /24", () => expect(ipPrefixOf("203.0.113.77")).toBe("203.0.113.0/24"));
  it("IPv4-mapped IPv6", () => expect(ipPrefixOf("::ffff:203.0.113.77")).toBe("203.0.113.0/24"));
  it("IPv6 /48", () => expect(ipPrefixOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48"));
  it("compressed IPv6", () => expect(ipPrefixOf("2001:db8::1")).toBe("2001:db8:0::/48"));
  it("garbage", () => expect(ipPrefixOf("not-an-ip")).toBeNull());
});
```

`test/shared/error-handler.test.ts`:
```ts
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DomainError } from "../../src/shared/errors.js";
import { errorHandler } from "../../src/shared/error-handler.js";
import { createLogger } from "../../src/shared/logger.js";
import { requestContext } from "../../src/shared/request-context.js";
import { parseOrThrow } from "../../src/shared/validate.js";

function appThrowing(err: unknown) {
  const app = express();
  app.use(requestContext);
  app.get("/x", () => { throw err; });
  app.use(errorHandler(createLogger("silent")));
  return app;
}

describe("errorHandler", () => {
  it("maps DomainError to code/status and Retry-After", async () => {
    const res = await request(appThrowing(new DomainError("RATE_LIMITED", "Too many requests", { retryAfterSec: 7 }))).get("/x");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("7");
    expect(res.body).toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("maps validation errors", async () => {
    let caught: unknown;
    try { parseOrThrow(z.object({ a: z.string() }), {}); } catch (e) { caught = e; }
    const res = await request(appThrowing(caught)).get("/x");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
  it("hides unknown errors", async () => {
    const res = await request(appThrowing(new Error("db password is hunter2"))).get("/x");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });
  it("maps malformed JSON bodies to VALIDATION_FAILED", async () => {
    const app = express();
    app.use(requestContext);
    app.use(express.json());
    app.post("/y", (_req, res) => { res.json({}); });
    app.use(errorHandler(createLogger("silent")));
    const res = await request(app).post("/y").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});
```

- [ ] **Step 6: Run — expect FAIL** — `pnpm --filter api test`

- [ ] **Step 7: Implement `src/config/env.ts`**

```ts
import { z } from "zod";

const list = (upper: boolean) =>
  z.string().transform((s) => s.split(",").map((x) => (upper ? x.trim().toUpperCase() : x.trim())).filter(Boolean));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url(),
  MIGRATOR_DATABASE_URL: z.url().optional(),
  RETENTION_DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url(),
  SESSION_TOKEN_PEPPER: z.string().min(32),
  OTP_HMAC_SECRET: z.string().min(32),
  ALCHEMY_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_VERIFY_SERVICE_SID: z.string().min(1),
  SMS_ALLOWED_COUNTRIES: list(true).pipe(z.array(z.string().length(2)).min(1)),
  AUTH_DOMAIN: z.string().min(1),
  AUTH_URI: z.url(),
  ALLOWED_ORIGINS: list(false).pipe(z.array(z.url()).min(1)),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  TRUST_PROXY: z.string().default("loopback"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  return parsed.data;
}

/** Loads apps/api/.env for local runs; production must inject real env vars. */
export function loadDotEnvIfPresent(): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file: rely on the process environment
  }
}
```

- [ ] **Step 8: Implement `src/shared/errors.ts`**

```ts
import type { ErrorCode } from "@repo/contracts";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly retryAfterSec?: number;

  constructor(code: ErrorCode, message: string, opts: { details?: unknown; retryAfterSec?: number } = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = opts.details;
    this.retryAfterSec = opts.retryAfterSec;
  }
}
```

- [ ] **Step 9: Implement `src/shared/logger.ts`**

```ts
import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.cookie", "req.headers.authorization", "res.headers[\"set-cookie\"]",
        "*.token", "*.tokenHash", "*.signature", "*.code", "*.codeHash", "*.password",
        "*.value", "*.destination", "*.secret",
      ],
      censor: "[redacted]",
    },
  });
}
```

- [ ] **Step 10: Implement `src/shared/request-context.ts`**

```ts
import { randomUUID } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { NextFunction, Request, Response } from "express";

export interface RequestMeta { requestId: string; ip: string; ipPrefix: string | null; userAgent: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { ctx: RequestMeta }
  }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

function expandIPv6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  if (ip.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...Array<string>(fill).fill("0"), ...t];
  }
  return h.length === 8 ? h : null;
}

export function ipPrefixOf(ip: string): string | null {
  const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIPv4(mapped)) {
    const [a, b, c] = mapped.split(".");
    return `${a}.${b}.${c}.0/24`;
  }
  if (isIPv6(ip)) {
    const parts = expandIPv6(ip);
    if (!parts) return null;
    return `${parts.slice(0, 3).map((p) => p.replace(/^0+(?=.)/, "")).join(":")}::/48`;
  }
  return null;
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const ip = req.ip ?? "";
  req.ctx = { requestId, ip, ipPrefix: ipPrefixOf(ip), userAgent: req.header("user-agent")?.slice(0, 512) ?? null };
  res.setHeader("X-Request-Id", requestId);
  next();
}
```

Note on the IPv6 test: `2001:db8::1` expands to `2001:db8:0:0:…`, so the prefix is `2001:db8:0::/48`; `2001:db8:abcd:12::1` → `2001:db8:abcd::/48`.

- [ ] **Step 11: Implement `src/shared/validate.ts`**

```ts
import type { z } from "zod";
import { DomainError } from "./errors.js";

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", "Request validation failed", {
      details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}
```

- [ ] **Step 12: Implement `src/shared/error-handler.ts`**

```ts
import { ERROR_HTTP_STATUS, type ApiErrorBody } from "@repo/contracts";
import type { ErrorRequestHandler } from "express";
import { DomainError } from "./errors.js";
import type { Logger } from "./logger.js";

function isBodyParseError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { type?: unknown }).type === "entity.parse.failed";
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let body: ApiErrorBody;
    let status: number;
    if (err instanceof DomainError) {
      status = ERROR_HTTP_STATUS[err.code];
      body = { error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) } };
      if (err.retryAfterSec !== undefined) res.setHeader("Retry-After", String(err.retryAfterSec));
      if (status >= 500) logger.warn({ requestId: req.ctx?.requestId, code: err.code }, "domain error");
    } else if (isBodyParseError(err)) {
      status = 400;
      body = { error: { code: "VALIDATION_FAILED", message: "Malformed JSON body" } };
    } else {
      status = 500;
      body = { error: { code: "INTERNAL", message: "Something went wrong" } };
      logger.error({ requestId: req.ctx?.requestId, err }, "unhandled error");
    }
    res.status(status).json(body);
  };
}
```

- [ ] **Step 13: Run tests — expect PASS** (the env/ctx/error tests). `pnpm --filter api test`

- [ ] **Step 14: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): scaffold Express app shared infrastructure"
```

(`src/app.ts`, `src/server.ts` are created in Task 7 once `AppDeps` exists.)

---

### Task 7: Database schema, roles/grants/RLS migration, DB client, test harness, `createApp` + `/health`

**Files:**
- Create: `apps/api/drizzle.config.ts`, `src/db/schema/enums.ts`, `src/db/schema/identity.ts`, `src/db/schema/contacts.ts`, `src/db/schema/audit.ts`, `src/db/schema/index.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/dev-roles.ts`, `src/db/migrations/*` (generated + custom), `src/deps.ts`, `src/app.ts`, `src/server.ts`, `src/shared/pg-errors.ts`
- Replace: `test/global-setup.ts`
- Create: `test/helpers/db.ts`, `test/helpers/app.ts`, `test/helpers/fakes.ts`, `test/db/schema.test.ts`, `test/health.test.ts`

**Interfaces:**
- Consumes: `Env`, `createLogger`, `requestContext`, `errorHandler`.
- Produces:
  - Drizzle tables: `users`, `investmentWallets`, `walletAddresses`, `authChallenges`, `sessions`, `contacts`, `contactVerifications`, `notificationPreferences`, `auditEvents` (camelCase TS, snake_case SQL) in schema `app`.
  - `type Db = PostgresJsDatabase<typeof schema>`; `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]`; `type DbOrTx = Db | Tx`; `createDb(url: string, opts?: { max?: number }): { db: Db; close(): Promise<void> }`
  - `isUniqueViolation(err: unknown, constraint?: string): boolean`
  - `interface AppDeps { env: Env; db: Db; logger: Logger; rateLimiter: RateLimiter; evmRpc: EvmRpc; emailSender: EmailSender; smsOtp: SmsOtpProvider; health: { db(): Promise<void>; redis(): Promise<void> } }` (adapter interfaces are declared in Task 8/10/17; until then `src/deps.ts` declares them as imports from files created in this task as stubs — see Step 12).
  - `createApp(deps: AppDeps): express.Express`
  - Test helpers: `testEnv(): Env`, `resetDb(): Promise<void>`, `adminSql` (postgres.js superuser client), `buildTestApp(overrides?): { app, deps, fakes }`.

- [ ] **Step 1: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  schemaFilter: ["app"],
  dbCredentials: { url: process.env.MIGRATOR_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/bytesac_dev" },
});
```

- [ ] **Step 2: `src/db/schema/enums.ts`**

```ts
import { pgSchema } from "drizzle-orm/pg-core";

export const app = pgSchema("app");

export const userStatus = app.enum("user_status", ["pending", "active", "suspended"]);
export const walletStatus = app.enum("wallet_status", ["active", "inactive"]);
export const addressStatus = app.enum("address_status", ["active", "disabled"]);
export const chainFamily = app.enum("chain_family", ["evm", "solana"]);
export const chain = app.enum("chain", ["ethereum", "base", "bnb", "arbitrum", "solana"]);
export const verificationMethod = app.enum("verification_method", ["eoa_ecdsa", "erc1271", "erc6492", "ed25519"]);
export const challengePurpose = app.enum("challenge_purpose", ["sign_in", "add_chain_account"]);
export const challengeStatus = app.enum("challenge_status", ["pending", "processing", "consumed", "rejected"]);
export const clientKind = app.enum("client_kind", ["web", "mobile"]);
export const revokeReason = app.enum("revoke_reason", ["logout", "logout_all", "user_revoked", "rotated", "user_suspended", "admin"]);
export const contactType = app.enum("contact_type", ["email", "phone"]);
export const contactStatus = app.enum("contact_status", ["unverified", "verified", "replaced"]);
export const otpChannel = app.enum("otp_channel", ["email", "sms"]);
export const verificationStatus = app.enum("contact_verification_status", ["pending", "verified", "superseded", "expired", "failed"]);
export const actorType = app.enum("actor_type", ["user", "ops", "system"]);
```

- [ ] **Step 3: `src/db/schema/identity.ts`**

```ts
import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import {
  addressStatus, app, chain, chainFamily, challengePurpose, challengeStatus, clientKind, revokeReason,
  userStatus, verificationMethod, walletStatus,
} from "./enums.js";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = app.table("users", {
  id: id(),
  status: userStatus("status").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const investmentWallets = app.table(
  "investment_wallets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    walletProvider: text("wallet_provider"),
    status: walletStatus("status").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("investment_wallets_one_active_per_user").on(t.userId).where(sql`${t.status} = 'active'`)],
);

export const sessions = app.table(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique("sessions_token_hash_key"),
    client: clientKind("client").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    idleExpiresAt: ts("idle_expires_at").notNull(),
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    revokeReason: revokeReason("revoke_reason"),
    replacedBySessionId: uuid("replaced_by_session_id").references((): AnyPgColumn => sessions.id, { onDelete: "set null" }),
    userAgent: text("user_agent"),
    ipPrefix: text("ip_prefix"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const authChallenges = app.table(
  "auth_challenges",
  {
    id: id(),
    nonce: text("nonce").notNull().unique("auth_challenges_nonce_key"),
    purpose: challengePurpose("purpose").notNull(),
    chainFamily: chainFamily("chain_family").notNull(),
    chain: chain("chain").notNull(),
    address: text("address").notNull(),
    message: text("message").notNull(),
    domain: text("domain").notNull(),
    uri: text("uri").notNull(),
    chainId: text("chain_id").notNull(),
    status: challengeStatus("status").notNull().default("pending"),
    claimId: uuid("claim_id"),
    leaseExpiresAt: ts("lease_expires_at"),
    issuedAt: ts("issued_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    resolvedAt: ts("resolved_at"),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  },
  (t) => [
    index("auth_challenges_expires_at_idx").on(t.expiresAt),
    check("auth_challenges_session_for_add", sql`${t.purpose} <> 'add_chain_account' OR ${t.sessionId} IS NOT NULL OR ${t.status} <> 'pending'`),
  ],
);

export const walletAddresses = app.table(
  "wallet_addresses",
  {
    id: id(),
    investmentWalletId: uuid("investment_wallet_id").notNull().references(() => investmentWallets.id),
    chainFamily: chainFamily("chain_family").notNull(),
    chain: chain("chain").notNull(),
    address: text("address").notNull(),
    status: addressStatus("status").notNull().default("active"),
    verificationMethod: verificationMethod("verification_method").notNull(),
    verifiedOnChain: chain("verified_on_chain").notNull(),
    verificationChallengeId: uuid("verification_challenge_id").references(() => authChallenges.id),
    verifiedAt: ts("verified_at").notNull().defaultNow(),
    disabledAt: ts("disabled_at"),
    disabledReason: text("disabled_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_addresses_chain_address_key").on(t.chain, t.address),
    index("wallet_addresses_wallet_idx").on(t.investmentWalletId),
    check("wallet_addresses_chain_family", sql`(${t.chainFamily} = 'solana') = (${t.chain} = 'solana')`),
    check("wallet_addresses_method_family", sql`(${t.chainFamily} = 'solana') = (${t.verificationMethod} = 'ed25519')`),
    check("wallet_addresses_disabled_reason", sql`${t.status} = 'active' OR ${t.disabledReason} IS NOT NULL`),
  ],
);
```

Note: `auth_challenges_session_for_add` keeps the add-chain session requirement enforced for fresh challenges while allowing `ON DELETE SET NULL` from retention on resolved rows.

- [ ] **Step 4: `src/db/schema/contacts.ts`**

```ts
import { sql } from "drizzle-orm";
import { boolean, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { app, contactStatus, contactType, otpChannel, verificationStatus } from "./enums.js";
import { users } from "./identity.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const contacts = app.table(
  "contacts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid("user_id").notNull().references(() => users.id),
    type: contactType("type").notNull(),
    value: text("value").notNull(),
    status: contactStatus("status").notNull().default("unverified"),
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_one_current_per_type").on(t.userId, t.type).where(sql`${t.status} <> 'replaced'`)],
);

export const contactVerifications = app.table(
  "contact_verifications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    destination: text("destination").notNull(),
    channel: otpChannel("channel").notNull(),
    status: verificationStatus("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contact_verifications_contact_idx").on(t.contactId),
    uniqueIndex("contact_verifications_one_pending").on(t.contactId).where(sql`${t.status} = 'pending'`),
  ],
);

export const notificationPreferences = app.table("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  rebalance: boolean("rebalance").notNull().default(true),
  portfolioUpdates: boolean("portfolio_updates").notNull().default(true),
  managerUpdates: boolean("manager_updates").notNull().default(true),
  offers: boolean("offers").notNull().default(false),
  productUpdates: boolean("product_updates").notNull().default(false),
  marketing: boolean("marketing").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 5: `src/db/schema/audit.ts` and `index.ts`**

```ts
// audit.ts
import { index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { actorType, app } from "./enums.js";

export const auditEvents = app.table(
  "audit_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorOpsId: text("actor_ops_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requestId: text("request_id").notNull(),
    sessionId: uuid("session_id"),
    challengeId: uuid("challenge_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId), index("audit_events_actor_idx").on(t.actorUserId)],
);
```
`audit_events` deliberately has no foreign keys so audit history survives retention purges.

```ts
// index.ts
export * from "./enums.js";
export * from "./identity.js";
export * from "./contacts.js";
export * from "./audit.js";
```

- [ ] **Step 6: Generate the table migration**

Run: `cd apps/api && MIGRATOR_DATABASE_URL=postgres://postgres:postgres@localhost:54329/bytesac_dev pnpm db:generate --name=init`
Expected: `src/db/migrations/0000_init.sql` containing `CREATE SCHEMA "app";`, all enums and tables. Review the SQL: every constraint name above must appear.

- [ ] **Step 7: Create the custom roles/grants/RLS migration**

Run: `pnpm db:generate --custom --name=roles_grants_rls` and fill `src/db/migrations/0001_roles_grants_rls.sql`:

```sql
-- Runtime and retention roles. Passwords/LOGIN are set per environment outside migrations
-- (local: pnpm db:dev-roles; Supabase: ALTER ROLE ... LOGIN PASSWORD by an operator).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bytesac_api') THEN CREATE ROLE bytesac_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bytesac_retention') THEN CREATE ROLE bytesac_retention NOLOGIN; END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated'; END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO bytesac_api, bytesac_retention;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.users, app.investment_wallets, app.wallet_addresses, app.auth_challenges, app.sessions,
  app.contacts, app.contact_verifications, app.notification_preferences
TO bytesac_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.audit_events TO bytesac_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON app.auth_challenges, app.sessions, app.contact_verifications TO bytesac_retention;
--> statement-breakpoint
GRANT SELECT ON app.wallet_addresses TO bytesac_retention;
--> statement-breakpoint
GRANT INSERT ON app.audit_events TO bytesac_retention;
--> statement-breakpoint
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.investment_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.wallet_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Role-scoped permissive policies: only the backend roles see rows; Supabase client roles see nothing.
CREATE POLICY api_all ON app.users FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.investment_wallets FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.wallet_addresses FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.auth_challenges FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.sessions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.contacts FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.contact_verifications FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.notification_preferences FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.audit_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY retention_all ON app.auth_challenges FOR ALL TO bytesac_retention USING (true);
CREATE POLICY retention_all ON app.sessions FOR ALL TO bytesac_retention USING (true);
CREATE POLICY retention_all ON app.contact_verifications FOR ALL TO bytesac_retention USING (true);
CREATE POLICY retention_read ON app.wallet_addresses FOR SELECT TO bytesac_retention USING (true);
CREATE POLICY retention_audit ON app.audit_events FOR INSERT TO bytesac_retention WITH CHECK (true);
```

This resolves spec §4.2's open item: no `BYPASSRLS` is needed — role-scoped policies work identically on Supabase and local Postgres. Grants (not policies) are what forbid `DELETE`/`UPDATE` for `bytesac_api` on audit rows.

- [ ] **Step 8: `src/db/client.ts`, `src/db/migrate.ts`, `src/db/dev-roles.ts`, `src/shared/pg-errors.ts`**

```ts
// client.ts
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  // prepare:false is required behind Supabase's transaction-mode pooler.
  const client = postgres(url, { max: opts.max ?? 10, prepare: false, onnotice: () => undefined });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
```

```ts
// migrate.ts
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadDotEnvIfPresent } from "../config/env.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnvIfPresent();
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is required");
  await runMigrations(url);
  console.log("migrations applied");
}
```

```ts
// dev-roles.ts — local/test only: enable LOGIN with fixed dev passwords.
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadDotEnvIfPresent } from "../config/env.js";

export async function setDevRolePasswords(adminUrl: string): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe("ALTER ROLE bytesac_api LOGIN PASSWORD 'bytesac_api_dev'");
    await sql.unsafe("ALTER ROLE bytesac_retention LOGIN PASSWORD 'bytesac_retention_dev'");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnvIfPresent();
  if (process.env.NODE_ENV === "production") throw new Error("dev-roles must never run in production");
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is required");
  await setDevRolePasswords(url);
  console.log("dev role passwords set");
}
```

```ts
// shared/pg-errors.ts
interface PgLikeError { code?: string; constraint_name?: string; constraint?: string; cause?: unknown }

function pgError(err: unknown): PgLikeError | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && typeof cur === "object" && cur !== null; i++) {
    const e = cur as PgLikeError;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    cur = e.cause;
  }
  return null;
}

/** Drizzle wraps driver errors (DrizzleQueryError.cause); walk the cause chain. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  if (!e || e.code !== "23505") return false;
  return constraint === undefined || (e.constraint_name ?? e.constraint) === constraint;
}
```

- [ ] **Step 9: Adapter interface stubs (bodies filled in later tasks)**

Create these files now with interfaces only, so `AppDeps` compiles; later tasks add implementations below the interfaces.

```ts
// src/adapters/rate-limiter.ts
export interface RateLimitResult { allowed: boolean; retryAfterSec: number; bucketKey: string }
export interface RateLimiter {
  consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
  refund(bucketKey: string): Promise<void>;
}
```
```ts
// src/adapters/evm-rpc.ts
import type { Chain } from "@repo/contracts";
export class VerifierUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "VerifierUnavailableError"; }
}
export interface EvmRpc {
  /** ERC-1271 / ERC-6492 validation on `chain`. Returns false for a definitive "not valid"; throws VerifierUnavailableError on transport failures. */
  verifyContractSignature(input: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean>;
}
```
```ts
// src/adapters/email-sender.ts
export class DeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "DeliveryError"; }
}
export interface EmailSender { sendOtp(input: { to: string; code: string }): Promise<void> }
```
```ts
// src/adapters/sms-otp.ts
export interface SmsOtpProvider {
  start(input: { to: string }): Promise<{ providerRef: string }>;
  check(input: { to: string; code: string }): Promise<"approved" | "rejected">;
}
```

- [ ] **Step 10: `src/deps.ts`, `src/app.ts`, `src/server.ts`**

```ts
// deps.ts
import type { EmailSender } from "./adapters/email-sender.js";
import type { EvmRpc } from "./adapters/evm-rpc.js";
import type { RateLimiter } from "./adapters/rate-limiter.js";
import type { SmsOtpProvider } from "./adapters/sms-otp.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import type { Logger } from "./shared/logger.js";

export interface AppDeps {
  env: Env;
  db: Db;
  logger: Logger;
  rateLimiter: RateLimiter;
  evmRpc: EvmRpc;
  emailSender: EmailSender;
  smsOtp: SmsOtpProvider;
  health: { db(): Promise<void>; redis(): Promise<void> };
}
```

```ts
// app.ts
import cookieParser from "cookie-parser";
import express from "express";
import type { AppDeps } from "./deps.js";
import { errorHandler } from "./shared/error-handler.js";
import { requestContext } from "./shared/request-context.js";

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.env.TRUST_PROXY);
  app.use(requestContext);
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    const checks = await Promise.allSettled([deps.health.db(), deps.health.redis()]);
    const [db, redis] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"));
    const ok = db === "ok" && redis === "ok";
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db, redis });
  });

  // Routers are mounted here by later tasks (security middleware, /v1/auth, /v1/me ...).

  app.use((_req, res) => { res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } }); });
  app.use(errorHandler(deps.logger));
  return app;
}
```

```ts
// server.ts
import { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { AlchemyEvmRpc } from "./adapters/evm-rpc.js";
import { ResendEmailSender } from "./adapters/email-sender.js";
import { RedisRateLimiter } from "./adapters/rate-limiter.js";
import { TwilioVerifySmsOtp } from "./adapters/sms-otp.js";
import { createApp } from "./app.js";
import { loadDotEnvIfPresent, loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { createLogger } from "./shared/logger.js";

loadDotEnvIfPresent();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { db } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

const app = createApp({
  env, db, logger,
  rateLimiter: new RedisRateLimiter(redis),
  evmRpc: new AlchemyEvmRpc(env.ALCHEMY_API_KEY),
  emailSender: new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM),
  smsOtp: new TwilioVerifySmsOtp(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_VERIFY_SERVICE_SID),
  health: { db: async () => { await db.execute(sql`select 1`); }, redis: async () => { await redis.ping(); } },
});

app.listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));
```
`server.ts` will not type-check until Tasks 8, 10 and 17 add the concrete adapter classes; that is expected. Do not run `check-types` for the whole package until Task 17; run the tests.

- [ ] **Step 11: Test harness**

`test/global-setup.ts`:
```ts
import postgres from "postgres";
import { runMigrations } from "../src/db/migrate.js";
import { setDevRolePasswords } from "../src/db/dev-roles.js";

export default async function setup(): Promise<void> {
  try { process.loadEnvFile(".env"); } catch { /* CI provides env */ }
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error("TEST_ADMIN_DATABASE_URL is required (see apps/api/.env.example)");
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await sql.unsafe("DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await sql.end();
  await runMigrations(adminUrl);
  await setDevRolePasswords(adminUrl);
}
```

`test/helpers/db.ts`:
```ts
import postgres from "postgres";
import { createDb } from "../../src/db/client.js";

try { process.loadEnvFile(".env"); } catch { /* CI */ }

export const adminSql = postgres(process.env.TEST_ADMIN_DATABASE_URL ?? "", { max: 2, onnotice: () => undefined });
export const testDb = createDb(process.env.TEST_DATABASE_URL ?? "", { max: 8 });

const TABLES = [
  "audit_events", "contact_verifications", "contacts", "notification_preferences", "wallet_addresses",
  "auth_challenges", "sessions", "investment_wallets", "users",
];

export async function resetDb(): Promise<void> {
  await adminSql.unsafe(`TRUNCATE ${TABLES.map((t) => `app.${t}`).join(", ")} CASCADE`);
}
```

`test/helpers/fakes.ts`:
```ts
import type { EmailSender } from "../../src/adapters/email-sender.js";
import type { EvmRpc } from "../../src/adapters/evm-rpc.js";
import type { RateLimiter, RateLimitResult } from "../../src/adapters/rate-limiter.js";
import type { SmsOtpProvider } from "../../src/adapters/sms-otp.js";

export class FakeEvmRpc implements EvmRpc {
  behavior: "valid" | "invalid" | "unavailable" = "invalid";
  delayMs = 0;
  onCall: (() => Promise<void>) | null = null;
  calls: Array<{ chain: string; address: string }> = [];
  async verifyContractSignature(input: Parameters<EvmRpc["verifyContractSignature"]>[0]): Promise<boolean> {
    this.calls.push({ chain: input.chain, address: input.address });
    if (this.onCall) await this.onCall();
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.behavior === "unavailable") {
      const { VerifierUnavailableError } = await import("../../src/adapters/evm-rpc.js");
      throw new VerifierUnavailableError("rpc down");
    }
    return this.behavior === "valid";
  }
}

export class FakeEmailSender implements EmailSender {
  sent: Array<{ to: string; code: string }> = [];
  fail = false;
  async sendOtp(input: { to: string; code: string }): Promise<void> {
    if (this.fail) {
      const { DeliveryError } = await import("../../src/adapters/email-sender.js");
      throw new DeliveryError("resend down");
    }
    this.sent.push(input);
  }
}

export class FakeSmsOtp implements SmsOtpProvider {
  started: string[] = [];
  approveCode = "123456";
  fail = false;
  async start(input: { to: string }): Promise<{ providerRef: string }> {
    if (this.fail) {
      const { DeliveryError } = await import("../../src/adapters/email-sender.js");
      throw new DeliveryError("twilio down");
    }
    this.started.push(input.to);
    return { providerRef: `VE${this.started.length}` };
  }
  async check(input: { to: string; code: string }): Promise<"approved" | "rejected"> {
    return input.code === this.approveCode ? "approved" : "rejected";
  }
}

/** Allows everything unless a key prefix is listed in `deny`. */
export class FakeRateLimiter implements RateLimiter {
  deny: string[] = [];
  refunded: string[] = [];
  async consume(key: string): Promise<RateLimitResult> {
    const blocked = this.deny.some((p) => key.startsWith(p));
    return { allowed: !blocked, retryAfterSec: blocked ? 30 : 0, bucketKey: `${key}:b` };
  }
  async refund(bucketKey: string): Promise<void> { this.refunded.push(bucketKey); }
}
```

`test/helpers/app.ts`:
```ts
import { sql } from "drizzle-orm";
import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { loadEnv, type Env } from "../../src/config/env.js";
import type { AppDeps } from "../../src/deps.js";
import { createLogger } from "../../src/shared/logger.js";
import { testDb } from "./db.js";
import { FakeEmailSender, FakeEvmRpc, FakeRateLimiter, FakeSmsOtp } from "./fakes.js";

export const ORIGIN = "http://localhost:3000";

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: "test", PORT: "0", LOG_LEVEL: "silent",
    DATABASE_URL: process.env.TEST_DATABASE_URL, REDIS_URL: process.env.TEST_REDIS_URL,
    SESSION_TOKEN_PEPPER: "test-pepper-test-pepper-test-pepper-00", OTP_HMAC_SECRET: "test-otp-secret-test-otp-secret-000",
    ALCHEMY_API_KEY: "x", RESEND_API_KEY: "x", EMAIL_FROM: "Bytesac <no-reply@test.dev>",
    TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "x", TWILIO_VERIFY_SERVICE_SID: "VA",
    SMS_ALLOWED_COUNTRIES: "IN,US,GB", AUTH_DOMAIN: "localhost:3000", AUTH_URI: ORIGIN,
    ALLOWED_ORIGINS: ORIGIN, COOKIE_SECURE: "false", TRUST_PROXY: "loopback",
    ...overrides,
  });
}

export interface TestApp {
  app: Express;
  deps: AppDeps;
  fakes: { evmRpc: FakeEvmRpc; email: FakeEmailSender; sms: FakeSmsOtp; rateLimiter: FakeRateLimiter };
}

export function buildTestApp(overrides: Partial<AppDeps> = {}): TestApp {
  const fakes = { evmRpc: new FakeEvmRpc(), email: new FakeEmailSender(), sms: new FakeSmsOtp(), rateLimiter: new FakeRateLimiter() };
  const deps: AppDeps = {
    env: testEnv(), db: testDb.db, logger: createLogger("silent"),
    rateLimiter: fakes.rateLimiter, evmRpc: fakes.evmRpc, emailSender: fakes.email, smsOtp: fakes.sms,
    health: { db: async () => { await testDb.db.execute(sql`select 1`); }, redis: async () => undefined },
    ...overrides,
  };
  return { app: createApp(deps), deps, fakes };
}
```

- [ ] **Step 12: Write failing tests**

`test/db/schema.test.ts`:
```ts
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { investmentWallets, users, walletAddresses } from "../../src/db/schema/index.js";
import { isUniqueViolation } from "../../src/shared/pg-errors.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";

const db = testDb.db;
beforeEach(resetDb);

async function newUser() {
  const [u] = await db.insert(users).values({ status: "active" }).returning();
  return u!;
}

describe("database access model", () => {
  it("every app table has RLS enabled", async () => {
    const rows = await adminSql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it("runtime role cannot delete or run DDL, and cannot modify audit rows", async () => {
    const api = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => undefined });
    try {
      await expect(api`DELETE FROM app.users`).rejects.toThrow(/permission denied/);
      await expect(api`CREATE TABLE app.x (id int)`).rejects.toThrow(/permission denied/);
      await expect(api`UPDATE app.audit_events SET action = 'x'`).rejects.toThrow(/permission denied/);
    } finally { await api.end(); }
  });

  it("Supabase client roles cannot read app tables", async () => {
    await expect(adminSql.begin(async (tx) => { await tx`SET LOCAL ROLE anon`; return tx`SELECT * FROM app.users`; })).rejects.toThrow(/permission denied/);
    await expect(adminSql.begin(async (tx) => { await tx`SET LOCAL ROLE authenticated`; return tx`SELECT * FROM app.sessions`; })).rejects.toThrow(/permission denied/);
  });
});

describe("identity invariants", () => {
  it("one active investment wallet per user, enforced under concurrency", async () => {
    const u = await newUser();
    const results = await Promise.allSettled([1, 2, 3].map(() => db.insert(investmentWallets).values({ userId: u.id, status: "active" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(isUniqueViolation(rejected.reason, "investment_wallets_one_active_per_user")).toBe(true);
  });

  it("(chain, address) is globally unique", async () => {
    const a = await newUser();
    const b = await newUser();
    const [wa] = await db.insert(investmentWallets).values({ userId: a.id, status: "active" }).returning();
    const [wb] = await db.insert(investmentWallets).values({ userId: b.id, status: "active" }).returning();
    const row = { chainFamily: "evm" as const, chain: "base" as const, address: "0xabc", verificationMethod: "eoa_ecdsa" as const, verifiedOnChain: "base" as const };
    await db.insert(walletAddresses).values({ ...row, investmentWalletId: wa!.id });
    const err = await db.insert(walletAddresses).values({ ...row, investmentWalletId: wb!.id }).catch((e: unknown) => e);
    expect(isUniqueViolation(err, "wallet_addresses_chain_address_key")).toBe(true);
    expect(await db.select().from(walletAddresses).where(eq(walletAddresses.chain, "base"))).toHaveLength(1);
  });

  it("chain/family/method consistency is checked", async () => {
    const u = await newUser();
    const [w] = await db.insert(investmentWallets).values({ userId: u.id, status: "active" }).returning();
    await expect(db.insert(walletAddresses).values({
      investmentWalletId: w!.id, chainFamily: "evm", chain: "solana", address: "x", verificationMethod: "eoa_ecdsa", verifiedOnChain: "solana",
    })).rejects.toThrow();
  });
});
```

`test/health.test.ts`:
```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app.js";

describe("GET /health", () => {
  it("reports ok when db and redis are up", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
  it("reports 503 when a dependency is down", async () => {
    const { app } = buildTestApp({ health: { db: async () => undefined, redis: async () => { throw new Error("down"); } } });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe("down");
  });
});
```

- [ ] **Step 13: Run tests — expect PASS**

Run: `pnpm db:up && cp apps/api/.env.example apps/api/.env` (then fill `SESSION_TOKEN_PEPPER`/`OTP_HMAC_SECRET` with `openssl rand -hex 32`), `pnpm --filter api test`.
Expected: schema, health, env, request-context and error-handler suites pass.

- [ ] **Step 14: Apply to dev DB and commit**

Run: `pnpm --filter api db:migrate && pnpm --filter api db:dev-roles`

```bash
git add apps/api
git commit -m "feat(api): add identity/contacts/audit schema with least-privilege roles and RLS"
```

---

### Task 8: Rate limiter (Redis) + security middleware (no CORS, CSRF, dual-auth)

**Files:**
- Modify: `apps/api/src/adapters/rate-limiter.ts` (add `RedisRateLimiter`), `apps/api/src/app.ts`
- Create: `apps/api/src/http/security.ts`, `test/adapters/rate-limiter.test.ts`, `test/http/security.test.ts`

**Interfaces:**
- Produces:
  - `class RedisRateLimiter implements RateLimiter` (fixed window)
  - `enforceRateLimit(limiter, key, limit, windowSec): Promise<RateLimitResult>` (throws `DomainError("RATE_LIMITED")` with `retryAfterSec`)
  - Middlewares: `noCors`, `rejectDualAuth`, `csrfGuard(allowedOrigins: string[])`
  - Constant `SESSION_COOKIE = "bx_session"` exported from `src/http/security.ts`.

- [ ] **Step 1: Failing test `test/adapters/rate-limiter.test.ts`**

```ts
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RedisRateLimiter } from "../../src/adapters/rate-limiter.js";

const redis = new Redis(process.env.TEST_REDIS_URL ?? "");
afterAll(() => redis.quit());
beforeEach(async () => { await redis.flushdb(); });

describe("RedisRateLimiter", () => {
  it("allows up to the limit then blocks with retry-after", async () => {
    const rl = new RedisRateLimiter(redis);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rl.consume("t:k", 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSec).toBeGreaterThan(0);
    expect(results[3]!.retryAfterSec).toBeLessThanOrEqual(60);
  });
  it("refund returns capacity", async () => {
    const rl = new RedisRateLimiter(redis);
    const a = await rl.consume("t:r", 1, 60);
    await rl.refund(a.bucketKey);
    expect((await rl.consume("t:r", 1, 60)).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Failing test `test/http/security.test.ts`**

```ts
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { csrfGuard, noCors, rejectDualAuth } from "../../src/http/security.js";
import { errorHandler } from "../../src/shared/error-handler.js";
import { createLogger } from "../../src/shared/logger.js";
import { requestContext } from "../../src/shared/request-context.js";

const ORIGIN = "http://localhost:3000";
function app() {
  const a = express();
  a.use(requestContext, express.json(), cookieParser(), noCors, rejectDualAuth, csrfGuard([ORIGIN]));
  a.post("/v1/auth/verify", (_req, res) => { res.json({ ok: true }); });
  a.post("/v1/auth/logout", (_req, res) => { res.json({ ok: true }); });
  a.get("/v1/me", (_req, res) => { res.json({ ok: true }); });
  a.use(errorHandler(createLogger("silent")));
  return a;
}

describe("security middleware", () => {
  it("never sends CORS headers and rejects preflight", async () => {
    const pre = await request(app()).options("/v1/me").set("Origin", "https://evil.test").set("Access-Control-Request-Method", "POST");
    expect(pre.status).toBe(403);
    const get = await request(app()).get("/v1/me").set("Origin", "https://evil.test");
    expect(get.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("cookie mutation without Origin → 403", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("X-Requested-With", "bytesac");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });
  it("cookie mutation from foreign Origin → 403", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("Origin", "https://evil.test").set("X-Requested-With", "bytesac");
    expect(res.status).toBe(403);
  });
  it("cookie mutation without custom header → 403", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("Origin", ORIGIN);
    expect(res.status).toBe(403);
  });
  it("cookie mutation with allowed Origin and header passes", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("Origin", ORIGIN).set("X-Requested-With", "bytesac");
    expect(res.status).toBe(200);
  });
  it("web sign-in without cookie still requires Origin (login CSRF)", async () => {
    const res = await request(app()).post("/v1/auth/verify").send({ client: "web" });
    expect(res.status).toBe(403);
  });
  it("mobile sign-in without Origin is allowed", async () => {
    const res = await request(app()).post("/v1/auth/verify").send({ client: "mobile" });
    expect(res.status).toBe(200);
  });
  it("bearer mutation is exempt", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
  });
  it("cookie and bearer together → 400", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Authorization", "Bearer t").set("Cookie", "bx_session=t");
    expect(res.status).toBe(400);
  });
  it("GET with cookie is not CSRF-checked", async () => {
    const res = await request(app()).get("/v1/me").set("Cookie", "bx_session=t");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** — `pnpm --filter api test -- rate-limiter security`

- [ ] **Step 4: Implement `RedisRateLimiter` (append to `src/adapters/rate-limiter.ts`)**

```ts
import type { Redis } from "ioredis";
import { DomainError } from "../shared/errors.js";

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSec / windowSec);
    const bucketKey = `rl:${key}:${windowSec}:${bucket}`;
    const [[, count]] = (await this.redis.multi().incr(bucketKey).expire(bucketKey, windowSec + 1).exec()) as [[null, number], [null, number]];
    const retryAfterSec = (bucket + 1) * windowSec - nowSec;
    return { allowed: count <= limit, retryAfterSec: count <= limit ? 0 : Math.max(1, retryAfterSec), bucketKey };
  }

  async refund(bucketKey: string): Promise<void> {
    await this.redis.decr(bucketKey);
  }
}

export async function enforceRateLimit(limiter: RateLimiter, key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const r = await limiter.consume(key, limit, windowSec);
  if (!r.allowed) throw new DomainError("RATE_LIMITED", "Too many requests. Try again later.", { retryAfterSec: r.retryAfterSec });
  return r;
}
```
(Move the `import` lines to the top of the file.)

- [ ] **Step 5: Implement `src/http/security.ts`**

```ts
import type { NextFunction, Request, Response } from "express";
import { DomainError } from "../shared/errors.js";

export const SESSION_COOKIE = "bx_session";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_ENTRY = new Set(["/v1/auth/challenge", "/v1/auth/verify"]);

/** The API is never called cross-origin by browsers: no CORS headers, preflight refused. */
export function noCors(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS") {
    res.status(403).json({ error: { code: "CSRF_REJECTED", message: "Cross-origin requests are not allowed" } });
    return;
  }
  next();
}

export function rejectDualAuth(req: Request, _res: Response, next: NextFunction): void {
  const hasBearer = /^Bearer\s+/i.test(req.header("authorization") ?? "");
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (hasBearer && cookies?.[SESSION_COOKIE]) {
    throw new DomainError("VALIDATION_FAILED", "Use either a session cookie or a bearer token, not both");
  }
  next();
}

export function csrfGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!MUTATING.has(req.method)) return next();
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const hasCookie = Boolean(cookies?.[SESSION_COOKIE]);
    const body = req.body as { client?: unknown } | undefined;
    const webAuthEntry = AUTH_ENTRY.has(req.path) && body?.client === "web";
    const challengeWithoutClient = req.path === "/v1/auth/challenge" && !/^Bearer\s+/i.test(req.header("authorization") ?? "") && req.header("x-client") !== "mobile";
    if (!hasCookie && !webAuthEntry && !challengeWithoutClient) return next();
    const origin = req.header("origin");
    if (!origin || !allowed.has(origin) || req.header("x-requested-with") !== "bytesac") {
      throw new DomainError("CSRF_REJECTED", "Request rejected by CSRF protection");
    }
    next();
  };
}
```

Note: `POST /v1/auth/challenge` has no `client` field; mobile sends header `X-Client: mobile` (documented in Plan C) and browsers are Origin-checked. Add one more test to `security.test.ts`:

```ts
it("challenge without cookie: browser needs Origin, mobile sends X-Client", async () => {
  const a = express();
  a.use(requestContext, express.json(), cookieParser(), csrfGuard([ORIGIN]));
  a.post("/v1/auth/challenge", (_req, res) => { res.json({ ok: true }); });
  a.use(errorHandler(createLogger("silent")));
  expect((await request(a).post("/v1/auth/challenge").send({})).status).toBe(403);
  expect((await request(a).post("/v1/auth/challenge").set("X-Client", "mobile").send({})).status).toBe(200);
  expect((await request(a).post("/v1/auth/challenge").set("Origin", ORIGIN).set("X-Requested-With", "bytesac").send({})).status).toBe(200);
});
```

- [ ] **Step 6: Mount in `src/app.ts`** — after `app.use(cookieParser());` add:

```ts
  app.use(noCors, rejectDualAuth, csrfGuard(deps.env.ALLOWED_ORIGINS));
```
with `import { csrfGuard, noCors, rejectDualAuth } from "./http/security.js";`

- [ ] **Step 7: Run tests — expect PASS** — `pnpm --filter api test`

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add Redis rate limiter, no-CORS and CSRF guards"
```

---

### Task 9: Identity domain — address canonicalization, sign-in messages, session policy, verification scope

**Files:**
- Create: `apps/api/src/modules/identity/domain/address.ts`, `sign-in-message.ts`, `session-policy.ts`, `verification-scope.ts`
- Test: `apps/api/test/identity/domain.test.ts`

**Interfaces:**
- Produces:
  - `canonicalizeAddress(chain: Chain, raw: string): string` (throws `DomainError("VALIDATION_FAILED")`)
  - `buildSignInMessage(input: { chain: Chain; address: string; domain: string; uri: string; nonce: string; issuedAt: Date; expiresAt: Date }): { message: string; chainId: string }`
  - `SIGN_IN_STATEMENT`
  - `SESSION_POLICY: Record<ClientKind, { idle: string; absolute: string; idleMs: number; absoluteMs: number }>` (`idle`/`absolute` are Postgres interval literals)
  - `RENEWAL_THROTTLE = "5 minutes"`, `CHALLENGE_TTL = "5 minutes"`, `CHALLENGE_LEASE = "30 seconds"`
  - `chainsForVerification(method: VerificationMethod, chain: Chain): Chain[]`

- [ ] **Step 1: Failing test `test/identity/domain.test.ts`**

```ts
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { canonicalizeAddress } from "../../src/modules/identity/domain/address.js";
import { buildSignInMessage, SIGN_IN_STATEMENT } from "../../src/modules/identity/domain/sign-in-message.js";
import { SESSION_POLICY } from "../../src/modules/identity/domain/session-policy.js";
import { chainsForVerification } from "../../src/modules/identity/domain/verification-scope.js";

const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SOL = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

describe("canonicalizeAddress", () => {
  it("lowercases valid EVM addresses (checksummed or not)", () => {
    expect(canonicalizeAddress("base", acct.address)).toBe(acct.address.toLowerCase());
    expect(canonicalizeAddress("base", acct.address.toLowerCase())).toBe(acct.address.toLowerCase());
  });
  it("rejects bad EVM checksum and malformed input", () => {
    const bad = acct.address.slice(0, -1) + (acct.address.endsWith("a") ? "B" : "a");
    expect(() => canonicalizeAddress("ethereum", bad.replace(/[a-f]/, (c) => c.toUpperCase()))).toThrow();
    expect(() => canonicalizeAddress("ethereum", "0x123")).toThrow();
  });
  it("accepts canonical base58 32-byte Solana keys only", () => {
    expect(canonicalizeAddress("solana", SOL)).toBe(SOL);
    expect(() => canonicalizeAddress("solana", "0OIl")).toThrow();
    expect(() => canonicalizeAddress("solana", "11111111111111111111111111111111111")).toThrow();
  });
});

describe("buildSignInMessage", () => {
  const base = { domain: "localhost:3000", uri: "http://localhost:3000", nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", issuedAt: new Date("2026-09-29T10:00:00.000Z"), expiresAt: new Date("2026-09-29T10:05:00.000Z") };
  it("EVM → EIP-4361 with checksummed address and numeric chain id", () => {
    const { message, chainId } = buildSignInMessage({ ...base, chain: "base", address: acct.address.toLowerCase() });
    expect(chainId).toBe("8453");
    expect(message.startsWith("localhost:3000 wants you to sign in with your Ethereum account:\n" + acct.address + "\n")).toBe(true);
    expect(message).toContain(SIGN_IN_STATEMENT);
    expect(message).toContain("Chain ID: 8453");
    expect(message).toContain("Nonce: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    expect(message).toContain("Expiration Time: 2026-09-29T10:05:00.000Z");
  });
  it("Solana → SIWS text", () => {
    const { message, chainId } = buildSignInMessage({ ...base, chain: "solana", address: SOL });
    expect(chainId).toBe("mainnet");
    expect(message).toBe([
      "localhost:3000 wants you to sign in with your Solana account:", SOL, "", SIGN_IN_STATEMENT, "",
      "URI: http://localhost:3000", "Version: 1", "Chain ID: mainnet", "Nonce: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "Issued At: 2026-09-29T10:00:00.000Z", "Expiration Time: 2026-09-29T10:05:00.000Z",
    ].join("\n"));
  });
});

describe("policies", () => {
  it("session lifetimes per client", () => {
    expect(SESSION_POLICY.web).toMatchObject({ idle: "12 hours", absolute: "7 days" });
    expect(SESSION_POLICY.mobile).toMatchObject({ idle: "7 days", absolute: "30 days" });
  });
  it("verification scope", () => {
    expect(chainsForVerification("eoa_ecdsa", "base")).toEqual(["ethereum", "base", "bnb", "arbitrum"]);
    expect(chainsForVerification("erc1271", "base")).toEqual(["base"]);
    expect(chainsForVerification("erc6492", "arbitrum")).toEqual(["arbitrum"]);
    expect(chainsForVerification("ed25519", "solana")).toEqual(["solana"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `pnpm --filter api test -- identity/domain`

- [ ] **Step 3: Implement `address.ts`**

```ts
import { familyOf, type Chain } from "@repo/contracts";
import bs58 from "bs58";
import { isAddress } from "viem";
import { DomainError } from "../../../shared/errors.js";

export function canonicalizeAddress(chain: Chain, raw: string): string {
  const value = raw.trim();
  if (familyOf(chain) === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value) || !isAddress(value, { strict: true })) {
      throw new DomainError("VALIDATION_FAILED", "Invalid EVM address");
    }
    return value.toLowerCase();
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Invalid Solana address");
  }
  if (bytes.length !== 32 || bs58.encode(bytes) !== value) {
    throw new DomainError("VALIDATION_FAILED", "Invalid Solana address");
  }
  return value;
}
```

- [ ] **Step 4: Implement `sign-in-message.ts`**

```ts
import { CHAINS, familyOf, type Chain } from "@repo/contracts";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";

export const SIGN_IN_STATEMENT = "Sign in to Bytesac. This does not authorize any transaction or spending.";

export interface SignInMessageInput {
  chain: Chain;
  address: string;
  domain: string;
  uri: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export function buildSignInMessage(i: SignInMessageInput): { message: string; chainId: string } {
  const info = CHAINS[i.chain];
  if (familyOf(i.chain) === "evm") {
    const chainId = info.evmChainId as number;
    const message = createSiweMessage({
      domain: i.domain,
      address: getAddress(i.address),
      statement: SIGN_IN_STATEMENT,
      uri: i.uri,
      version: "1",
      chainId,
      nonce: i.nonce,
      issuedAt: i.issuedAt,
      expirationTime: i.expiresAt,
    });
    return { message, chainId: String(chainId) };
  }
  const chainId = info.solanaCluster as string;
  const message = [
    `${i.domain} wants you to sign in with your Solana account:`,
    i.address,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${i.uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${i.nonce}`,
    `Issued At: ${i.issuedAt.toISOString()}`,
    `Expiration Time: ${i.expiresAt.toISOString()}`,
  ].join("\n");
  return { message, chainId };
}
```

- [ ] **Step 5: Implement `session-policy.ts` and `verification-scope.ts`**

```ts
// session-policy.ts
import type { ClientKind } from "@repo/contracts";

const H = 3_600_000;
export const SESSION_POLICY: Readonly<Record<ClientKind, { idle: string; absolute: string; idleMs: number; absoluteMs: number }>> = {
  web: { idle: "12 hours", absolute: "7 days", idleMs: 12 * H, absoluteMs: 7 * 24 * H },
  mobile: { idle: "7 days", absolute: "30 days", idleMs: 7 * 24 * H, absoluteMs: 30 * 24 * H },
};
export const RENEWAL_THROTTLE = "5 minutes";
export const CHALLENGE_TTL = "5 minutes";
export const CHALLENGE_LEASE = "30 seconds";
```

```ts
// verification-scope.ts
import { chainsInFamily, familyOf, type Chain, type VerificationMethod } from "@repo/contracts";

/** Only an ECDSA-recovered EOA key proves control on every EVM chain; contract wallets are per chain. */
export function chainsForVerification(method: VerificationMethod, chain: Chain): Chain[] {
  return method === "eoa_ecdsa" ? chainsInFamily(familyOf(chain)) : [chain];
}
```

- [ ] **Step 6: Run — expect PASS** — `pnpm --filter api test -- identity/domain`

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add identity domain rules (addresses, SIWE/SIWS, policies)"
```

---

### Task 10: Signature verifiers — EVM (ECDSA → ERC-1271/6492 via RPC) and Solana (ed25519)

**Files:**
- Modify: `apps/api/src/adapters/evm-rpc.ts` (add `AlchemyEvmRpc`)
- Create: `apps/api/src/modules/identity/infra/evm-signature-verifier.ts`, `solana-signature-verifier.ts`, `signature-verifier.ts`
- Create: `apps/api/test/helpers/wallets.ts`, `apps/api/test/identity/verifiers.test.ts`

**Interfaces:**
- Consumes: `EvmRpc`, `VerifierUnavailableError`.
- Produces:
  - `type VerifyOutcome = { kind: "valid"; method: VerificationMethod } | { kind: "invalid" }`
  - `interface SignatureVerifier { verify(i: { chain: Chain; address: string; message: string; signature: string }): Promise<VerifyOutcome> }` — throws `VerifierUnavailableError` on transient failure.
  - `createSignatureVerifier(evmRpc: EvmRpc): SignatureVerifier`
  - Test helpers: `newEvmWallet(): { address: string; sign(message: string): Promise<string> }`, `newSolanaWallet(): { address: string; sign(message: string): string }`, `ERC6492_SUFFIX`.

- [ ] **Step 1: `test/helpers/wallets.ts`**

```ts
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const ERC6492_SUFFIX = "6492649264926492649264926492649264926492649264926492649264926492";

export function newEvmWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address as string, sign: (message: string) => account.signMessage({ message }) as Promise<string> };
}

export function newSolanaWallet() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    address: bs58.encode(publicKey),
    sign: (message: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), secretKey)),
  };
}
```
(If `@noble/curves@2` names differ, check `node_modules/@noble/curves/README.md` — v2 uses `.js` subpath imports and `utils.randomSecretKey`.)

- [ ] **Step 2: Failing test `test/identity/verifiers.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { VerifierUnavailableError } from "../../src/adapters/evm-rpc.js";
import { createSignatureVerifier } from "../../src/modules/identity/infra/signature-verifier.js";
import { FakeEvmRpc } from "../helpers/fakes.js";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../helpers/wallets.js";

const MSG = "hello bytesac";

describe("EVM verification", () => {
  it("EOA signature recovers offline → eoa_ecdsa, no RPC call", async () => {
    const rpc = new FakeEvmRpc();
    const w = newEvmWallet();
    const out = await createSignatureVerifier(rpc).verify({ chain: "base", address: w.address.toLowerCase(), message: MSG, signature: await w.sign(MSG) });
    expect(out).toEqual({ kind: "valid", method: "eoa_ecdsa" });
    expect(rpc.calls).toHaveLength(0);
  });
  it("signature by another key → RPC consulted → invalid", async () => {
    const rpc = new FakeEvmRpc();
    const a = newEvmWallet();
    const b = newEvmWallet();
    const out = await createSignatureVerifier(rpc).verify({ chain: "base", address: a.address.toLowerCase(), message: MSG, signature: await b.sign(MSG) });
    expect(out).toEqual({ kind: "invalid" });
  });
  it("contract wallet signature valid on chain → erc1271", async () => {
    const rpc = new FakeEvmRpc();
    rpc.behavior = "valid";
    const out = await createSignatureVerifier(rpc).verify({ chain: "arbitrum", address: "0x" + "ab".repeat(20), message: MSG, signature: "0x" + "11".repeat(100) });
    expect(out).toEqual({ kind: "valid", method: "erc1271" });
    expect(rpc.calls[0]).toEqual({ chain: "arbitrum", address: "0x" + "ab".repeat(20) });
  });
  it("ERC-6492 wrapped signature → erc6492", async () => {
    const rpc = new FakeEvmRpc();
    rpc.behavior = "valid";
    const out = await createSignatureVerifier(rpc).verify({ chain: "base", address: "0x" + "cd".repeat(20), message: MSG, signature: "0x" + "22".repeat(96) + ERC6492_SUFFIX });
    expect(out).toEqual({ kind: "valid", method: "erc6492" });
  });
  it("RPC outage propagates as VerifierUnavailableError", async () => {
    const rpc = new FakeEvmRpc();
    rpc.behavior = "unavailable";
    await expect(createSignatureVerifier(rpc).verify({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "0x" + "11".repeat(100) }))
      .rejects.toBeInstanceOf(VerifierUnavailableError);
  });
  it("non-hex / missing 0x signatures are invalid, not errors", async () => {
    const v = createSignatureVerifier(new FakeEvmRpc());
    expect(await v.verify({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "abcd" })).toEqual({ kind: "invalid" });
    expect(await v.verify({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "0xzz" })).toEqual({ kind: "invalid" });
  });
});

describe("Solana verification", () => {
  it("valid ed25519 signature", async () => {
    const w = newSolanaWallet();
    expect(await createSignatureVerifier(new FakeEvmRpc()).verify({ chain: "solana", address: w.address, message: MSG, signature: w.sign(MSG) }))
      .toEqual({ kind: "valid", method: "ed25519" });
  });
  it("wrong key, tampered message, base64 signature → invalid", async () => {
    const v = createSignatureVerifier(new FakeEvmRpc());
    const a = newSolanaWallet();
    const b = newSolanaWallet();
    expect(await v.verify({ chain: "solana", address: a.address, message: MSG, signature: b.sign(MSG) })).toEqual({ kind: "invalid" });
    expect(await v.verify({ chain: "solana", address: a.address, message: MSG + "!", signature: a.sign(MSG) })).toEqual({ kind: "invalid" });
    expect(await v.verify({ chain: "solana", address: a.address, message: MSG, signature: "c2lnbmF0dXJl+/==" })).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 3: Run — expect FAIL** — `pnpm --filter api test -- verifiers`

- [ ] **Step 4: Implement `evm-signature-verifier.ts`**

```ts
import type { Chain } from "@repo/contracts";
import { isErc6492Signature, isHex, recoverMessageAddress, size, type Hex } from "viem";
import type { EvmRpc } from "../../../adapters/evm-rpc.js";
import type { VerifyOutcome } from "./signature-verifier.js";

export async function verifyEvmSignature(rpc: EvmRpc, i: { chain: Chain; address: string; message: string; signature: string }): Promise<VerifyOutcome> {
  if (!isHex(i.signature, { strict: true }) || i.signature.length < 4) return { kind: "invalid" };
  const signature = i.signature as Hex;
  const address = i.address.toLowerCase() as `0x${string}`;
  const wrapped = isErc6492Signature(signature);

  // 1. Offline ECDSA: covers EOAs, including EIP-7702-delegated EOAs (same key controls every EVM chain).
  if (!wrapped && size(signature) === 65) {
    try {
      const recovered = await recoverMessageAddress({ message: i.message, signature });
      if (recovered.toLowerCase() === address) return { kind: "valid", method: "eoa_ecdsa" };
    } catch {
      // malformed ECDSA signature: fall through to contract validation
    }
  }

  // 2. Contract wallet on the challenge's chain only. Throws VerifierUnavailableError on transport failure.
  const ok = await rpc.verifyContractSignature({ chain: i.chain, address, message: i.message, signature });
  if (!ok) return { kind: "invalid" };
  return { kind: "valid", method: wrapped ? "erc6492" : "erc1271" };
}
```

- [ ] **Step 5: Implement `solana-signature-verifier.ts` and `signature-verifier.ts`**

```ts
// solana-signature-verifier.ts
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import type { VerifyOutcome } from "./signature-verifier.js";

export function verifySolanaSignature(i: { address: string; message: string; signature: string }): VerifyOutcome {
  try {
    const sig = bs58.decode(i.signature);
    const pub = bs58.decode(i.address);
    if (sig.length !== 64 || pub.length !== 32) return { kind: "invalid" };
    return ed25519.verify(sig, new TextEncoder().encode(i.message), pub) ? { kind: "valid", method: "ed25519" } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}
```

```ts
// signature-verifier.ts
import { familyOf, type Chain, type VerificationMethod } from "@repo/contracts";
import type { EvmRpc } from "../../../adapters/evm-rpc.js";
import { verifyEvmSignature } from "./evm-signature-verifier.js";
import { verifySolanaSignature } from "./solana-signature-verifier.js";

export type VerifyOutcome = { kind: "valid"; method: VerificationMethod } | { kind: "invalid" };

export interface SignatureVerifier {
  verify(i: { chain: Chain; address: string; message: string; signature: string }): Promise<VerifyOutcome>;
}

export function createSignatureVerifier(evmRpc: EvmRpc): SignatureVerifier {
  return {
    verify: async (i) => (familyOf(i.chain) === "evm" ? verifyEvmSignature(evmRpc, i) : verifySolanaSignature(i)),
  };
}
```

- [ ] **Step 6: Implement `AlchemyEvmRpc` (append to `src/adapters/evm-rpc.ts`)**

```ts
import { createPublicClient, http, HttpRequestError, RpcRequestError, TimeoutError, type PublicClient } from "viem";

const ALCHEMY_HOST: Record<Exclude<Chain, "solana">, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  bnb: "bnb-mainnet",
  arbitrum: "arb-mainnet",
};

export class AlchemyEvmRpc implements EvmRpc {
  private readonly clients = new Map<Chain, PublicClient>();
  constructor(private readonly apiKey: string) {}

  private client(chain: Chain): PublicClient {
    if (chain === "solana") throw new Error("not an EVM chain");
    let c = this.clients.get(chain);
    if (!c) {
      c = createPublicClient({ transport: http(`https://${ALCHEMY_HOST[chain]}.g.alchemy.com/v2/${this.apiKey}`, { timeout: 5_000, retryCount: 1 }) });
      this.clients.set(chain, c);
    }
    return c;
  }

  async verifyContractSignature(i: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
    try {
      // viem handles ERC-1271 (deployed) and ERC-6492 (counterfactual) via eth_call.
      return await this.client(i.chain).verifyMessage({ address: i.address, message: i.message, signature: i.signature });
    } catch (err) {
      if (err instanceof HttpRequestError || err instanceof TimeoutError || err instanceof RpcRequestError) {
        throw new VerifierUnavailableError("EVM RPC unavailable", { cause: err });
      }
      return false; // reverted / malformed contract response: definitive "not valid"
    }
  }
}
```
(Keep imports at the file top; `Chain` is already imported there.) Before release, confirm Alchemy hostnames for BNB and Arbitrum in current Alchemy docs.

- [ ] **Step 7: Run — expect PASS** — `pnpm --filter api test -- verifiers`

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add EVM (EOA/ERC-1271/ERC-6492) and Solana signature verification"
```

---

### Task 11: Audit writer + repositories (challenges, sessions, wallets)

**Files:**
- Create: `apps/api/src/shared/audit.ts`, `apps/api/src/modules/identity/infra/challenge-repository.ts`, `session-repository.ts`, `wallet-repository.ts`
- Test: `apps/api/test/identity/repositories.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // audit.ts
  type AuditAction = "user.signed_up" | "user.signed_in" | "user.suspended" | "wallet.chain_account_added"
    | "wallet.address_disabled" | "wallet.address_reactivated" | "session.created" | "session.rotated"
    | "session.revoked" | "session.revoked_all" | "contact.added" | "contact.replaced" | "contact.verified"
    | "notification_preferences.updated" | "challenge.rejected" | "retention.purged";
  interface AuditEntry { actorType: "user" | "ops" | "system"; actorUserId?: string | null; actorOpsId?: string | null;
    action: AuditAction; entityType: string; entityId: string; requestId: string; sessionId?: string | null;
    challengeId?: string | null; metadata?: Record<string, unknown> }
  function writeAudit(db: DbOrTx, e: AuditEntry): Promise<void>

  // challenge-repository.ts
  type ChallengeRow = typeof authChallenges.$inferSelect
  const challenges = {
    dbNow(db): Promise<Date>,
    insert(db, v: typeof authChallenges.$inferInsert): Promise<ChallengeRow>,
    findById(db, id): Promise<ChallengeRow | undefined>,
    claim(db, id, claimId): Promise<ChallengeRow | undefined>,       // pending|expired-lease → processing
    release(db, id, claimId): Promise<void>,                           // processing → pending
    reject(db, id, claimId): Promise<void>,                            // processing → rejected
    consume(tx, id, claimId): Promise<boolean>,                        // processing → consumed
  }

  // session-repository.ts
  type SessionRow = typeof sessions.$inferSelect
  interface IssuedSession { id: string; token: string; client: ClientKind; absoluteExpiresAt: Date }
  const sessionRepo = {
    create(db, i: { userId; client; pepper; meta: RequestMeta }): Promise<IssuedSession>,
    findActiveByToken(db, token, pepper): Promise<{ session: SessionRow; userStatus: "pending"|"active"|"suspended" } | undefined>,
    touch(db, sessionId, client): Promise<void>,
    revoke(db, sessionId, reason, replacedBy?): Promise<boolean>,
    revokeAllForUser(db, userId, reason): Promise<number>,
    listActiveForUser(db, userId): Promise<SessionRow[]>,
  }
  function hashToken(token: string, pepper: string): string

  // wallet-repository.ts
  interface AddressOwner { userId: string; userStatus: "pending"|"active"|"suspended"; walletId: string; status: "active"|"disabled" }
  const walletRepo = {
    findOwner(db, chain, address): Promise<AddressOwner | undefined>,
    createUserWithWallet(tx, i: { walletProvider?: string; rows: NewAddressRow[] }): Promise<{ userId: string; walletId: string }>,
    activeWalletForUser(db, userId): Promise<{ id: string } | undefined>,
    addressesForWallet(db, walletId): Promise<(typeof walletAddresses.$inferSelect)[]>,
    insertAddresses(tx, walletId, rows: NewAddressRow[]): Promise<void>,
  }
  type NewAddressRow = { chain: Chain; address: string; method: VerificationMethod; verifiedOnChain: Chain; challengeId: string }
  ```

- [ ] **Step 1: Failing test `test/identity/repositories.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, authChallenges, notificationPreferences, sessions } from "../../src/db/schema/index.js";
import { challenges } from "../../src/modules/identity/infra/challenge-repository.js";
import { hashToken, sessionRepo } from "../../src/modules/identity/infra/session-repository.js";
import { walletRepo } from "../../src/modules/identity/infra/wallet-repository.js";
import { writeAudit } from "../../src/shared/audit.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";

const db = testDb.db;
const meta = { requestId: "req-1", ip: "203.0.113.9", ipPrefix: "203.0.113.0/24", userAgent: "vitest" };
const PEPPER = "p".repeat(32);
beforeEach(resetDb);

async function makeChallenge(overrides: Partial<typeof authChallenges.$inferInsert> = {}) {
  const now = await challenges.dbNow(db);
  return challenges.insert(db, {
    nonce: crypto.randomUUID().replaceAll("-", ""), purpose: "sign_in", chainFamily: "evm", chain: "base", address: "0xabc",
    message: "m", domain: "d", uri: "u", chainId: "8453", issuedAt: now, expiresAt: new Date(now.getTime() + 300_000), ...overrides,
  });
}

describe("challenge state machine", () => {
  it("claim → consume once", async () => {
    const c = await makeChallenge();
    const claimA = crypto.randomUUID();
    expect(await challenges.claim(db, c.id, claimA)).toBeDefined();
    expect(await challenges.claim(db, c.id, crypto.randomUUID())).toBeUndefined(); // live lease
    expect(await db.transaction((tx) => challenges.consume(tx, c.id, claimA))).toBe(true);
    expect(await db.transaction((tx) => challenges.consume(tx, c.id, claimA))).toBe(false);
    expect((await challenges.findById(db, c.id))!.status).toBe("consumed");
  });
  it("release returns to pending; reject is terminal", async () => {
    const c = await makeChallenge();
    const k = crypto.randomUUID();
    await challenges.claim(db, c.id, k);
    await challenges.release(db, c.id, k);
    expect((await challenges.findById(db, c.id))!.status).toBe("pending");
    const k2 = crypto.randomUUID();
    await challenges.claim(db, c.id, k2);
    await challenges.reject(db, c.id, k2);
    expect(await challenges.claim(db, c.id, crypto.randomUUID())).toBeUndefined();
    expect((await challenges.findById(db, c.id))!.status).toBe("rejected");
  });
  it("expired lease can be re-claimed; expired challenge cannot", async () => {
    const c = await makeChallenge();
    await challenges.claim(db, c.id, crypto.randomUUID());
    await adminSql`UPDATE app.auth_challenges SET lease_expires_at = now() - interval '1 second' WHERE id = ${c.id}`;
    expect(await challenges.claim(db, c.id, crypto.randomUUID())).toBeDefined();
    const old = await makeChallenge();
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '1 second' WHERE id = ${old.id}`;
    expect(await challenges.claim(db, old.id, crypto.randomUUID())).toBeUndefined();
  });
  it("stale claimant cannot consume after lease was taken over", async () => {
    const c = await makeChallenge();
    const first = crypto.randomUUID();
    await challenges.claim(db, c.id, first);
    await adminSql`UPDATE app.auth_challenges SET lease_expires_at = now() - interval '1 second' WHERE id = ${c.id}`;
    await challenges.claim(db, c.id, crypto.randomUUID());
    expect(await db.transaction((tx) => challenges.consume(tx, c.id, first))).toBe(false);
  });
});

describe("sessions", () => {
  it("stores only the token hash and finds active sessions using DB time", async () => {
    const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
    const s = await sessionRepo.create(db, { userId, client: "web", pepper: PEPPER, meta });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(row!.tokenHash).toBe(hashToken(s.token, PEPPER));
    expect(row!.tokenHash).not.toContain(s.token);
    expect((await sessionRepo.findActiveByToken(db, s.token, PEPPER))?.session.id).toBe(s.id);
    await adminSql`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${s.id}`;
    expect(await sessionRepo.findActiveByToken(db, s.token, PEPPER)).toBeUndefined();
  });
  it("touch slides idle expiry but never beyond absolute, and only after 5 minutes", async () => {
    const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
    const s = await sessionRepo.create(db, { userId, client: "web", pepper: PEPPER, meta });
    const before = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    await sessionRepo.touch(db, s.id, "web");
    const same = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    expect(same.idleExpiresAt.getTime()).toBe(before.idleExpiresAt.getTime());
    await adminSql`UPDATE app.sessions SET last_seen_at = now() - interval '6 minutes', absolute_expires_at = now() + interval '1 hour' WHERE id = ${s.id}`;
    await Promise.all([sessionRepo.touch(db, s.id, "web"), sessionRepo.touch(db, s.id, "web")]);
    const after = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    expect(after.idleExpiresAt.getTime()).toBeLessThanOrEqual(after.absoluteExpiresAt.getTime());
  });
  it("revokeAllForUser revokes every active session", async () => {
    const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
    await sessionRepo.create(db, { userId, client: "web", pepper: PEPPER, meta });
    await sessionRepo.create(db, { userId, client: "mobile", pepper: PEPPER, meta });
    expect(await sessionRepo.revokeAllForUser(db, userId, "logout_all")).toBe(2);
    expect(await sessionRepo.listActiveForUser(db, userId)).toHaveLength(0);
  });
});

describe("wallets and audit", () => {
  it("createUserWithWallet creates user, active wallet, addresses and default preferences", async () => {
    const c = await makeChallenge();
    const res = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, {
      walletProvider: "MetaMask",
      rows: [{ chain: "base", address: "0xabc", method: "eoa_ecdsa", verifiedOnChain: "base", challengeId: c.id }],
    }));
    const owner = await walletRepo.findOwner(db, "base", "0xabc");
    expect(owner).toMatchObject({ userId: res.userId, status: "active", userStatus: "active" });
    const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, res.userId));
    expect(prefs).toMatchObject({ rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false });
  });
  it("writeAudit persists correlation references", async () => {
    await writeAudit(db, { actorType: "system", action: "retention.purged", entityType: "system", entityId: "retention", requestId: "req-9", metadata: { n: 1 } });
    const [row] = await db.select().from(auditEvents);
    expect(row).toMatchObject({ requestId: "req-9", action: "retention.purged", metadata: { n: 1 } });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/shared/audit.ts`**

```ts
import type { DbOrTx } from "../db/client.js";
import { auditEvents } from "../db/schema/index.js";

export type AuditAction =
  | "user.signed_up" | "user.signed_in" | "user.suspended" | "wallet.chain_account_added"
  | "wallet.address_disabled" | "wallet.address_reactivated" | "session.created" | "session.rotated"
  | "session.revoked" | "session.revoked_all" | "contact.added" | "contact.replaced" | "contact.verified"
  | "notification_preferences.updated" | "challenge.rejected" | "retention.purged";

export interface AuditEntry {
  actorType: "user" | "ops" | "system";
  actorUserId?: string | null;
  actorOpsId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  requestId: string;
  sessionId?: string | null;
  challengeId?: string | null;
  /** Never put tokens, signatures, OTP codes or unmasked contact values here. */
  metadata?: Record<string, unknown>;
}

export async function writeAudit(db: DbOrTx, e: AuditEntry): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: e.actorType,
    actorUserId: e.actorUserId ?? null,
    actorOpsId: e.actorOpsId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    requestId: e.requestId,
    sessionId: e.sessionId ?? null,
    challengeId: e.challengeId ?? null,
    metadata: e.metadata ?? {},
  });
}
```

- [ ] **Step 4: Implement `challenge-repository.ts`**

```ts
import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "../../../db/client.js";
import { authChallenges } from "../../../db/schema/index.js";
import { CHALLENGE_LEASE } from "../domain/session-policy.js";

export type ChallengeRow = typeof authChallenges.$inferSelect;

export const challenges = {
  async dbNow(db: DbOrTx): Promise<Date> {
    const rows = await db.execute<{ now: string | Date }>(sql`select now() as now`);
    const v = (rows as unknown as Array<{ now: string | Date }>)[0]!.now;
    return v instanceof Date ? v : new Date(v);
  },

  async insert(db: DbOrTx, v: typeof authChallenges.$inferInsert): Promise<ChallengeRow> {
    const [row] = await db.insert(authChallenges).values(v).returning();
    return row!;
  },

  async findById(db: DbOrTx, id: string): Promise<ChallengeRow | undefined> {
    const [row] = await db.select().from(authChallenges).where(eq(authChallenges.id, id));
    return row;
  },

  async claim(db: DbOrTx, id: string, claimId: string): Promise<ChallengeRow | undefined> {
    const [row] = await db
      .update(authChallenges)
      .set({ status: "processing", claimId, leaseExpiresAt: sql`now() + ${CHALLENGE_LEASE}::interval` })
      .where(and(
        eq(authChallenges.id, id),
        gt(authChallenges.expiresAt, sql`now()`),
        or(eq(authChallenges.status, "pending"), and(eq(authChallenges.status, "processing"), lt(authChallenges.leaseExpiresAt, sql`now()`))),
      ))
      .returning();
    return row;
  },

  async release(db: DbOrTx, id: string, claimId: string): Promise<void> {
    await db.update(authChallenges).set({ status: "pending", claimId: null, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
  },

  async reject(db: DbOrTx, id: string, claimId: string): Promise<void> {
    await db.update(authChallenges).set({ status: "rejected", resolvedAt: sql`now()`, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
  },

  async consume(tx: Tx, id: string, claimId: string): Promise<boolean> {
    const rows = await tx.update(authChallenges).set({ status: "consumed", resolvedAt: sql`now()`, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")))
      .returning({ id: authChallenges.id });
    return rows.length === 1;
  },
};
```

- [ ] **Step 5: Implement `session-repository.ts`**

```ts
import { createHmac, randomBytes } from "node:crypto";
import type { ClientKind } from "@repo/contracts";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../db/client.js";
import { sessions, users } from "../../../db/schema/index.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { RENEWAL_THROTTLE, SESSION_POLICY } from "../domain/session-policy.js";

export type SessionRow = typeof sessions.$inferSelect;
export type RevokeReason = NonNullable<SessionRow["revokeReason"]>;
export interface IssuedSession { id: string; token: string; client: ClientKind; absoluteExpiresAt: Date }

export function hashToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

const activeNow = () => and(isNull(sessions.revokedAt), gt(sessions.idleExpiresAt, sql`now()`), gt(sessions.absoluteExpiresAt, sql`now()`));

export const sessionRepo = {
  async create(db: DbOrTx, i: { userId: string; client: ClientKind; pepper: string; meta: RequestMeta }): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const p = SESSION_POLICY[i.client];
    const [row] = await db.insert(sessions).values({
      userId: i.userId,
      tokenHash: hashToken(token, i.pepper),
      client: i.client,
      idleExpiresAt: sql`now() + ${p.idle}::interval`,
      absoluteExpiresAt: sql`now() + ${p.absolute}::interval`,
      userAgent: i.meta.userAgent,
      ipPrefix: i.meta.ipPrefix,
    }).returning({ id: sessions.id, absoluteExpiresAt: sessions.absoluteExpiresAt });
    return { id: row!.id, token, client: i.client, absoluteExpiresAt: row!.absoluteExpiresAt };
  },

  async findActiveByToken(db: DbOrTx, token: string, pepper: string) {
    const [row] = await db.select({ session: sessions, userStatus: users.status })
      .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token, pepper)), activeNow()));
    return row;
  },

  /** Idempotent under concurrency: conditional update, monotonic values, capped at absolute expiry. */
  async touch(db: DbOrTx, sessionId: string, client: ClientKind): Promise<void> {
    const p = SESSION_POLICY[client];
    await db.update(sessions)
      .set({ lastSeenAt: sql`now()`, idleExpiresAt: sql`LEAST(now() + ${p.idle}::interval, ${sessions.absoluteExpiresAt})` })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), lt(sessions.lastSeenAt, sql`now() - ${RENEWAL_THROTTLE}::interval`)));
  },

  async revoke(db: DbOrTx, sessionId: string, reason: RevokeReason, replacedBy?: string): Promise<boolean> {
    const rows = await db.update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason, replacedBySessionId: replacedBy ?? null })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length === 1;
  },

  async revokeAllForUser(db: DbOrTx, userId: string, reason: RevokeReason): Promise<number> {
    const rows = await db.update(sessions).set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  },

  async listActiveForUser(db: DbOrTx, userId: string): Promise<SessionRow[]> {
    return db.select().from(sessions).where(and(eq(sessions.userId, userId), activeNow())).orderBy(desc(sessions.lastSeenAt));
  },
};
```

- [ ] **Step 6: Implement `wallet-repository.ts`**

```ts
import { familyOf, type Chain, type VerificationMethod } from "@repo/contracts";
import { and, eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "../../../db/client.js";
import { investmentWallets, notificationPreferences, users, walletAddresses } from "../../../db/schema/index.js";

export interface NewAddressRow { chain: Chain; address: string; method: VerificationMethod; verifiedOnChain: Chain; challengeId: string }
export interface AddressOwner { userId: string; userStatus: "pending" | "active" | "suspended"; walletId: string; status: "active" | "disabled" }

export const walletRepo = {
  async findOwner(db: DbOrTx, chain: Chain, address: string): Promise<AddressOwner | undefined> {
    const [row] = await db
      .select({ userId: users.id, userStatus: users.status, walletId: investmentWallets.id, status: walletAddresses.status })
      .from(walletAddresses)
      .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
      .innerJoin(users, eq(users.id, investmentWallets.userId))
      .where(and(eq(walletAddresses.chain, chain), eq(walletAddresses.address, address)));
    return row;
  },

  async createUserWithWallet(tx: Tx, i: { walletProvider?: string; rows: NewAddressRow[] }): Promise<{ userId: string; walletId: string }> {
    const [user] = await tx.insert(users).values({ status: "active" }).returning({ id: users.id });
    const [wallet] = await tx.insert(investmentWallets).values({ userId: user!.id, status: "active", walletProvider: i.walletProvider ?? null })
      .returning({ id: investmentWallets.id });
    await tx.insert(notificationPreferences).values({ userId: user!.id });
    await walletRepo.insertAddresses(tx, wallet!.id, i.rows);
    return { userId: user!.id, walletId: wallet!.id };
  },

  async activeWalletForUser(db: DbOrTx, userId: string): Promise<{ id: string; walletProvider: string | null } | undefined> {
    const [row] = await db.select({ id: investmentWallets.id, walletProvider: investmentWallets.walletProvider }).from(investmentWallets)
      .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")));
    return row;
  },

  async addressesForWallet(db: DbOrTx, walletId: string) {
    return db.select().from(walletAddresses).where(eq(walletAddresses.investmentWalletId, walletId)).orderBy(walletAddresses.createdAt);
  },

  async insertAddresses(tx: Tx, walletId: string, rows: NewAddressRow[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(walletAddresses).values(rows.map((r) => ({
      investmentWalletId: walletId,
      chainFamily: familyOf(r.chain),
      chain: r.chain,
      address: r.address,
      verificationMethod: r.method,
      verifiedOnChain: r.verifiedOnChain,
      verificationChallengeId: r.challengeId,
    })));
  },
};
```

- [ ] **Step 7: Run — expect PASS** — `pnpm --filter api test -- repositories`

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add audit writer and identity repositories"
```

---

### Task 12: Session service, `requireSession`, session cookie helpers

**Files:**
- Create: `apps/api/src/modules/identity/application/session-service.ts`, `apps/api/src/modules/identity/http/session-cookie.ts`, `apps/api/src/modules/identity/http/require-session.ts`
- Test: `apps/api/test/identity/require-session.test.ts`

**Interfaces:**
- Consumes: `sessionRepo`, `SESSION_COOKIE`, `SESSION_POLICY`.
- Produces:
  - `interface AuthContext { userId: string; sessionId: string; client: ClientKind; transport: "cookie" | "bearer" }` and `req.auth?: AuthContext` (global Express augmentation)
  - `readSessionToken(req): { token: string; transport: "cookie" | "bearer" } | null`
  - `requireSession(deps: AppDeps): RequestHandler` — 401 `SESSION_EXPIRED` / `USER_NOT_ACTIVE`; performs `touch`.
  - `optionalSession(deps: AppDeps): RequestHandler` — same but no-op when absent/invalid.
  - `setSessionCookie(res, env, issued: IssuedSession)`, `clearSessionCookie(res, env)`
  - `respondWithSession(res, env, client: ClientKind, issued: IssuedSession | null): { token?: string }` — web: sets cookie; mobile: returns token.

- [ ] **Step 1: Failing test `test/identity/require-session.test.ts`**

```ts
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { requireSession } from "../../src/modules/identity/http/require-session.js";
import { sessionRepo } from "../../src/modules/identity/infra/session-repository.js";
import { walletRepo } from "../../src/modules/identity/infra/wallet-repository.js";
import { errorHandler } from "../../src/shared/error-handler.js";
import { createLogger } from "../../src/shared/logger.js";
import { requestContext } from "../../src/shared/request-context.js";
import { buildTestApp } from "../helpers/app.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";

const db = testDb.db;
const meta = { requestId: "r", ip: "", ipPrefix: null, userAgent: null };
beforeEach(resetDb);

function probe() {
  const { deps } = buildTestApp();
  const app = express();
  app.use(requestContext, cookieParser());
  app.get("/p", requireSession(deps), (req, res) => { res.json(req.auth); });
  app.use(errorHandler(createLogger("silent")));
  return { app, pepper: deps.env.SESSION_TOKEN_PEPPER };
}

async function issue(client: "web" | "mobile", pepper: string) {
  const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
  return { userId, s: await sessionRepo.create(db, { userId, client, pepper, meta }) };
}

describe("requireSession", () => {
  it("accepts cookie and bearer", async () => {
    const { app, pepper } = probe();
    const { s, userId } = await issue("web", pepper);
    const a = await request(app).get("/p").set("Cookie", `bx_session=${s.token}`);
    expect(a.body).toMatchObject({ userId, sessionId: s.id, transport: "cookie", client: "web" });
    const m = await issue("mobile", pepper);
    const b = await request(app).get("/p").set("Authorization", `Bearer ${m.s.token}`);
    expect(b.body).toMatchObject({ userId: m.userId, transport: "bearer", client: "mobile" });
  });
  it("missing, unknown, revoked, idle-expired, absolute-expired → 401 SESSION_EXPIRED", async () => {
    const { app, pepper } = probe();
    expect((await request(app).get("/p")).body.error.code).toBe("SESSION_EXPIRED");
    expect((await request(app).get("/p").set("Authorization", "Bearer nope")).status).toBe(401);
    const r = await issue("web", pepper);
    await sessionRepo.revoke(db, r.s.id, "logout");
    expect((await request(app).get("/p").set("Cookie", `bx_session=${r.s.token}`)).status).toBe(401);
    const i = await issue("web", pepper);
    await adminSql`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${i.s.id}`;
    expect((await request(app).get("/p").set("Cookie", `bx_session=${i.s.token}`)).status).toBe(401);
    const x = await issue("web", pepper);
    await adminSql`UPDATE app.sessions SET absolute_expires_at = now() - interval '1 second' WHERE id = ${x.s.id}`;
    expect((await request(app).get("/p").set("Cookie", `bx_session=${x.s.token}`)).status).toBe(401);
  });
  it("suspended user → 401 USER_NOT_ACTIVE", async () => {
    const { app, pepper } = probe();
    const { s, userId } = await issue("web", pepper);
    await adminSql`UPDATE app.users SET status = 'suspended' WHERE id = ${userId}`;
    const res = await request(app).get("/p").set("Cookie", `bx_session=${s.token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("USER_NOT_ACTIVE");
  });
  it("concurrent requests during renewal all succeed with the same token", async () => {
    const { app, pepper } = probe();
    const { s } = await issue("mobile", pepper);
    await adminSql`UPDATE app.sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = ${s.id}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).get("/p").set("Authorization", `Bearer ${s.token}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `session-cookie.ts`**

```ts
import type { ClientKind } from "@repo/contracts";
import type { Response } from "express";
import type { Env } from "../../../config/env.js";
import { SESSION_COOKIE } from "../../../http/security.js";
import type { IssuedSession } from "../infra/session-repository.js";

export function setSessionCookie(res: Response, env: Env, issued: IssuedSession): void {
  res.cookie(SESSION_COOKIE, issued.token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: issued.absoluteExpiresAt,
  });
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: "/" });
}

/** Web gets an httpOnly cookie; mobile gets the token in the body. `null` = keep the current session. */
export function respondWithSession(res: Response, env: Env, client: ClientKind, issued: IssuedSession | null): { token?: string } {
  if (!issued) return {};
  if (client === "web") {
    setSessionCookie(res, env, issued);
    return {};
  }
  return { token: issued.token };
}
```

- [ ] **Step 4: Implement `require-session.ts`**

```ts
import type { ClientKind } from "@repo/contracts";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppDeps } from "../../../deps.js";
import { SESSION_COOKIE } from "../../../http/security.js";
import { DomainError } from "../../../shared/errors.js";
import { sessionRepo } from "../infra/session-repository.js";

export interface AuthContext { userId: string; sessionId: string; client: ClientKind; transport: "cookie" | "bearer" }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export function readSessionToken(req: Request): { token: string; transport: "cookie" | "bearer" } | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  if (m) return { token: m[1]!, transport: "bearer" };
  const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
  return cookie ? { token: cookie, transport: "cookie" } : null;
}

async function resolve(deps: AppDeps, req: Request): Promise<AuthContext> {
  const t = readSessionToken(req);
  if (!t) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
  const found = await sessionRepo.findActiveByToken(deps.db, t.token, deps.env.SESSION_TOKEN_PEPPER);
  if (!found) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
  if (found.userStatus !== "active") throw new DomainError("USER_NOT_ACTIVE", "This account is not active");
  await sessionRepo.touch(deps.db, found.session.id, found.session.client);
  return { userId: found.session.userId, sessionId: found.session.id, client: found.session.client, transport: t.transport };
}

export function requireSession(deps: AppDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.auth = await resolve(deps, req);
    next();
  };
}

export function optionalSession(deps: AppDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (readSessionToken(req)) {
      try { req.auth = await resolve(deps, req); } catch { req.auth = undefined; }
    }
    next();
  };
}
```

- [ ] **Step 5: Implement `session-service.ts`**

```ts
import type { ClientKind } from "@repo/contracts";
import type { Tx } from "../../../db/client.js";
import { writeAudit } from "../../../shared/audit.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { sessionRepo, type IssuedSession } from "../infra/session-repository.js";

/** Issue a replacement session and revoke the old one inside the caller's transaction. */
export async function rotateSession(tx: Tx, i: { userId: string; oldSessionId: string; client: ClientKind; pepper: string; meta: RequestMeta }): Promise<IssuedSession> {
  const next = await sessionRepo.create(tx, { userId: i.userId, client: i.client, pepper: i.pepper, meta: i.meta });
  await sessionRepo.revoke(tx, i.oldSessionId, "rotated", next.id);
  await writeAudit(tx, {
    actorType: "user", actorUserId: i.userId, action: "session.rotated", entityType: "session", entityId: next.id,
    requestId: i.meta.requestId, sessionId: next.id, metadata: { previousSessionId: i.oldSessionId },
  });
  return next;
}
```

- [ ] **Step 6: Run — expect PASS** — `pnpm --filter api test -- require-session`

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add session middleware, cookie helpers and rotation"
```

---

### Task 13: Sign-in — challenge issuance and three-phase verification (`/v1/auth/challenge`, `/v1/auth/verify`)

**Files:**
- Create: `apps/api/src/modules/identity/application/challenge-service.ts`, `apps/api/src/modules/identity/application/sign-in-service.ts`, `apps/api/src/modules/identity/http/auth-routes.ts`
- Modify: `apps/api/src/app.ts` (mount `/v1/auth`)
- Test: `apps/api/test/identity/sign-in.test.ts`, `apps/api/test/helpers/auth.ts`

**Interfaces:**
- Consumes: everything from Tasks 8–12.
- Produces:
  - `issueChallenge(deps, i: { purpose; chain; rawAddress; sessionId: string | null; meta }): Promise<ChallengeResponse>`
  - `verifyChallenge(deps, i: { challengeId; signature; walletProvider?; client; auth?: AuthContext; meta }): Promise<{ userId: string; isNewUser: boolean; issued: IssuedSession | null }>`
  - `authRouter(deps): express.Router` with `POST /challenge`, `POST /verify`, `POST /logout`, `POST /logout-all` (logout routes added in Task 15).
  - Test helper `signIn(app, wallet, chain, client?)` returning `{ userId, cookie?, token? }` and `challengeFor(app, body, headers?)`.

- [ ] **Step 1: `test/helpers/auth.ts`**

```ts
import type { Chain } from "@repo/contracts";
import type { Express } from "express";
import request from "supertest";
import { ORIGIN } from "./app.js";

export interface TestWallet { address: string; sign(message: string): Promise<string> | string }

export function webHeaders(cookie?: string): Record<string, string> {
  return { Origin: ORIGIN, "X-Requested-With": "bytesac", ...(cookie ? { Cookie: cookie } : {}) };
}

export async function challengeFor(app: Express, body: { purpose: "sign_in" | "add_chain_account"; chain: Chain; address: string }, headers: Record<string, string> = webHeaders()) {
  return request(app).post("/v1/auth/challenge").set(headers).send(body);
}

export async function signIn(app: Express, wallet: TestWallet, chain: Chain, client: "web" | "mobile" = "web") {
  const headers = client === "web" ? webHeaders() : { "X-Client": "mobile" };
  const ch = await challengeFor(app, { purpose: "sign_in", chain, address: wallet.address }, headers);
  if (ch.status !== 200) throw new Error(`challenge failed: ${JSON.stringify(ch.body)}`);
  const signature = await wallet.sign(ch.body.message);
  const res = await request(app).post("/v1/auth/verify").set(headers).send({ challengeId: ch.body.challengeId, signature, client, walletProvider: "Test" });
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = setCookie?.map((c) => c.split(";")[0]).find((c) => c?.startsWith("bx_session="));
  return { res, userId: res.body.userId as string, cookie, token: res.body.token as string | undefined };
}
```

- [ ] **Step 2: Failing test `test/identity/sign-in.test.ts`**

```ts
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, authChallenges, sessions, users, walletAddresses } from "../../src/db/schema/index.js";
import { buildTestApp } from "../helpers/app.js";
import { challengeFor, signIn, webHeaders } from "../helpers/auth.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../helpers/wallets.js";

const db = testDb.db;
beforeEach(resetDb);

describe("sign-in", () => {
  it("EOA sign-up registers 4 EVM chains, sets httpOnly cookie, audits", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const r = await signIn(app, w, "base");
    expect(r.res.status).toBe(200);
    expect(r.res.body.isNewUser).toBe(true);
    expect(r.res.body.token).toBeUndefined();
    expect(String(r.res.headers["set-cookie"])).toMatch(/bx_session=.*HttpOnly.*SameSite=Lax/i);
    const rows = await db.select().from(walletAddresses);
    expect(rows.map((x) => x.chain).sort()).toEqual(["arbitrum", "base", "bnb", "ethereum"]);
    expect(rows.every((x) => x.verificationMethod === "eoa_ecdsa" && x.verifiedOnChain === "base" && x.address === w.address.toLowerCase())).toBe(true);
    const actions = (await db.select().from(auditEvents)).map((a) => a.action).sort();
    expect(actions).toEqual(["session.created", "user.signed_in", "user.signed_up"]);
  });

  it("Solana mobile sign-up returns token in body, registers solana only", async () => {
    const { app } = buildTestApp();
    const r = await signIn(app, newSolanaWallet(), "solana", "mobile");
    expect(r.res.status).toBe(200);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.res.headers["set-cookie"]).toBeUndefined();
    expect((await db.select().from(walletAddresses)).map((x) => x.chain)).toEqual(["solana"]);
  });

  it("repeat sign-in (checksummed vs lowercase) logs into the same user", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const first = await signIn(app, { address: w.address.toLowerCase(), sign: w.sign }, "ethereum");
    const second = await signIn(app, w, "arbitrum");
    expect(second.res.body).toMatchObject({ userId: first.userId, isNewUser: false });
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("smart wallet (ERC-1271) registers only the verified chain", async () => {
    const { app, fakes } = buildTestApp();
    fakes.evmRpc.behavior = "valid";
    const address = "0x" + "ab".repeat(20);
    const r = await signIn(app, { address, sign: () => "0x" + "11".repeat(100) }, "base");
    expect(r.res.status).toBe(200);
    const rows = await db.select().from(walletAddresses);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chain: "base", verificationMethod: "erc1271" });
  });

  it("undeployed smart wallet (ERC-6492) registers only the verified chain", async () => {
    const { app, fakes } = buildTestApp();
    fakes.evmRpc.behavior = "valid";
    const r = await signIn(app, { address: "0x" + "cd".repeat(20), sign: () => "0x" + "22".repeat(96) + ERC6492_SUFFIX }, "arbitrum");
    expect(r.res.status).toBe(200);
    expect((await db.select().from(walletAddresses))[0]).toMatchObject({ chain: "arbitrum", verificationMethod: "erc6492" });
  });

  it("invalid signature → 401 SIGNATURE_INVALID, challenge rejected, not retryable", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const other = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const bad = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await other.sign(ch.body.message), client: "web" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("SIGNATURE_INVALID");
    const retry = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
    expect(retry.body.error.code).toBe("CHALLENGE_CONSUMED");
    const [row] = await db.select().from(authChallenges);
    expect(row!.status).toBe("rejected");
  });

  it("malformed signature encodings are SIGNATURE_INVALID, never 500", async () => {
    const { app } = buildTestApp();
    for (const [chain, wallet, sig] of [
      ["base", newEvmWallet(), "deadbeef"],
      ["solana", newSolanaWallet(), "c2lnbmF0dXJl+/=="],
    ] as const) {
      const ch = await challengeFor(app, { purpose: "sign_in", chain, address: wallet.address });
      const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: sig, client: "web" });
      expect(res.status).toBe(401);
    }
  });

  it("verifier outage → 503 and the same signature succeeds on retry", async () => {
    const { app, fakes } = buildTestApp();
    fakes.evmRpc.behavior = "unavailable";
    const address = "0x" + "ab".repeat(20);
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address });
    const body = { challengeId: ch.body.challengeId, signature: "0x" + "11".repeat(100), client: "web" };
    const first = await request(app).post("/v1/auth/verify").set(webHeaders()).send(body);
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe("VERIFIER_UNAVAILABLE");
    fakes.evmRpc.behavior = "valid";
    expect((await request(app).post("/v1/auth/verify").set(webHeaders()).send(body)).status).toBe(200);
  });

  it("no DB transaction is open while the RPC call runs", async () => {
    const { app, fakes } = buildTestApp();
    let idleInTx = -1;
    fakes.evmRpc.behavior = "valid";
    fakes.evmRpc.onCall = async () => {
      const rows = await adminSql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'bytesac_api' AND state LIKE 'idle in transaction%'`;
      idleInTx = rows[0]!.n;
    };
    await signIn(app, { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) }, "base");
    expect(idleInTx).toBe(0);
  });

  it("double submit of one challenge → exactly one session", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const body = { challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" };
    const results = await Promise.all([1, 2, 3].map(() => request(app).post("/v1/auth/verify").set(webHeaders()).send(body)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(["CHALLENGE_IN_PROGRESS", "CHALLENGE_CONSUMED"]).toContain(r.body.error.code);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it("concurrent sign-up of one new address with two challenges → one user, both logged in", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const [a, b] = await Promise.all([signIn(app, w, "base"), signIn(app, w, "ethereum")]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(a.userId).toBe(b.userId);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("expired challenge → 410 CHALLENGE_EXPIRED; unknown → 404", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '1 second'`;
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
    expect(res.status).toBe(410);
    const nf = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", signature: "0x00", client: "web" });
    expect(nf.status).toBe(404);
  });

  it("message signed for a different domain fails", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const forged = String(ch.body.message).replace("localhost:3000", "evil.test");
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(forged), client: "web" });
    expect(res.status).toBe(401);
  });

  it("disabled address → 403 ADDRESS_DISABLED; suspended user → 401 USER_NOT_ACTIVE", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const first = await signIn(app, w, "base");
    await adminSql`UPDATE app.wallet_addresses SET status = 'disabled', disabled_reason = 'test'`;
    expect((await signIn(app, w, "base")).res.body.error.code).toBe("ADDRESS_DISABLED");
    await adminSql`UPDATE app.wallet_addresses SET status = 'active', disabled_reason = null`;
    await adminSql`UPDATE app.users SET status = 'suspended' WHERE id = ${first.userId}`;
    expect((await signIn(app, w, "base")).res.body.error.code).toBe("USER_NOT_ACTIVE");
  });

  it("challenge uses server time only and stores the exact message", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const [row] = await db.select().from(authChallenges).where(eq(authChallenges.id, ch.body.challengeId));
    expect(row!.message).toBe(ch.body.message);
    expect(row!.expiresAt.getTime() - row!.issuedAt.getTime()).toBe(300_000);
  });

  it("invalid address or unsupported chain → 400", async () => {
    const { app } = buildTestApp();
    expect((await challengeFor(app, { purpose: "sign_in", chain: "base", address: "0x123" })).status).toBe(400);
    expect((await request(app).post("/v1/auth/challenge").set(webHeaders()).send({ purpose: "sign_in", chain: "polygon", address: "0x" + "1".repeat(40) })).status).toBe(400);
  });

  it("challenge and verify are rate limited", async () => {
    const { app, fakes } = buildTestApp();
    fakes.rateLimiter.deny = ["challenge:ip:"];
    const res = await challengeFor(app, { purpose: "sign_in", chain: "base", address: newEvmWallet().address });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `challenge-service.ts`**

```ts
import { randomBytes } from "node:crypto";
import { familyOf, type Chain, type ChallengePurpose, type ChallengeResponse } from "@repo/contracts";
import { enforceRateLimit } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { canonicalizeAddress } from "../domain/address.js";
import { buildSignInMessage } from "../domain/sign-in-message.js";
import { challenges } from "../infra/challenge-repository.js";

const TTL_MS = 5 * 60 * 1000;

export async function issueChallenge(
  deps: AppDeps,
  i: { purpose: ChallengePurpose; chain: Chain; rawAddress: string; sessionId: string | null; meta: RequestMeta },
): Promise<ChallengeResponse> {
  const address = canonicalizeAddress(i.chain, i.rawAddress);
  await enforceRateLimit(deps.rateLimiter, `challenge:ip:${i.meta.ip}`, 20, 60);
  await enforceRateLimit(deps.rateLimiter, `challenge:addr:${address}`, 10, 60);

  const issuedAt = await challenges.dbNow(deps.db);
  const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
  const nonce = randomBytes(16).toString("hex");
  const domain = deps.env.AUTH_DOMAIN;
  const uri = deps.env.AUTH_URI;
  const { message, chainId } = buildSignInMessage({ chain: i.chain, address, domain, uri, nonce, issuedAt, expiresAt });

  const row = await challenges.insert(deps.db, {
    nonce, purpose: i.purpose, chainFamily: familyOf(i.chain), chain: i.chain, address, message, domain, uri, chainId,
    issuedAt, expiresAt, sessionId: i.sessionId,
  });
  return { challengeId: row.id, message, expiresAt: expiresAt.toISOString() };
}
```

- [ ] **Step 5: Implement `sign-in-service.ts`**

```ts
import { randomUUID } from "node:crypto";
import { familyOf, type ClientKind, type VerificationMethod } from "@repo/contracts";
import { VerifierUnavailableError } from "../../../adapters/evm-rpc.js";
import type { Tx } from "../../../db/client.js";
import type { AppDeps } from "../../../deps.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import { isUniqueViolation } from "../../../shared/pg-errors.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { chainsForVerification } from "../domain/verification-scope.js";
import { challenges, type ChallengeRow } from "../infra/challenge-repository.js";
import { sessionRepo, type IssuedSession } from "../infra/session-repository.js";
import { createSignatureVerifier } from "../infra/signature-verifier.js";
import { walletRepo, type NewAddressRow } from "../infra/wallet-repository.js";
import type { AuthContext } from "../http/require-session.js";
import { rotateSession } from "./session-service.js";

export interface VerifyInput {
  challengeId: string;
  signature: string;
  walletProvider?: string;
  client: ClientKind;
  auth?: AuthContext;
  meta: RequestMeta;
}
export interface VerifyResult { userId: string; isNewUser: boolean; issued: IssuedSession | null }

/** Business rejections that make the challenge terminal (it is marked `rejected`). */
const TERMINAL = new Set(["SIGNATURE_INVALID", "ADDRESS_DISABLED", "USER_NOT_ACTIVE", "ADDRESS_ALREADY_LINKED", "CHAIN_FAMILY_ALREADY_LINKED"]);

export async function verifyChallenge(deps: AppDeps, input: VerifyInput): Promise<VerifyResult> {
  // Phase A — claim
  const claimId = randomUUID();
  const ch = await challenges.claim(deps.db, input.challengeId, claimId);
  if (!ch) throw await claimFailure(deps, input.challengeId);

  try {
    if (ch.purpose === "add_chain_account" && (!input.auth || input.auth.sessionId !== ch.sessionId)) {
      throw new DomainError("SIGNATURE_INVALID", "This challenge belongs to another session");
    }

    // Phase B — verify outside any transaction
    let outcome;
    try {
      outcome = await createSignatureVerifier(deps.evmRpc).verify({ chain: ch.chain, address: ch.address, message: ch.message, signature: input.signature });
    } catch (err) {
      if (err instanceof VerifierUnavailableError) {
        await challenges.release(deps.db, ch.id, claimId);
        throw new DomainError("VERIFIER_UNAVAILABLE", "Wallet verification is temporarily unavailable. Please try again.");
      }
      throw err;
    }
    if (outcome.kind === "invalid") throw new DomainError("SIGNATURE_INVALID", "Signature could not be verified");

    // Phase C — finalize atomically (retry once on sign-up race)
    try {
      return await deps.db.transaction((tx) => finalize(deps, tx, ch, claimId, outcome.method, input));
    } catch (err) {
      if (ch.purpose === "sign_in" && isUniqueViolation(err, "wallet_addresses_chain_address_key")) {
        return await deps.db.transaction((tx) => finalize(deps, tx, ch, claimId, outcome.method, input));
      }
      if (ch.purpose === "add_chain_account" && isUniqueViolation(err, "wallet_addresses_chain_address_key")) {
        throw new DomainError("ADDRESS_ALREADY_LINKED", "This address is linked to another account");
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof DomainError && TERMINAL.has(err.code)) {
      await challenges.reject(deps.db, ch.id, claimId);
      await writeAudit(deps.db, {
        actorType: input.auth ? "user" : "system", actorUserId: input.auth?.userId ?? null, action: "challenge.rejected",
        entityType: "auth_challenge", entityId: ch.id, requestId: input.meta.requestId, challengeId: ch.id,
        sessionId: input.auth?.sessionId ?? null, metadata: { reason: err.code, chain: ch.chain, address: ch.address },
      });
    }
    throw err;
  }
}

async function claimFailure(deps: AppDeps, id: string): Promise<DomainError> {
  const row = await challenges.findById(deps.db, id);
  const now = await challenges.dbNow(deps.db);
  if (!row) return new DomainError("CHALLENGE_NOT_FOUND", "Sign-in request not found. Start again.");
  if (row.status === "consumed" || row.status === "rejected") return new DomainError("CHALLENGE_CONSUMED", "This sign-in request was already used. Start again.");
  if (row.expiresAt <= now) return new DomainError("CHALLENGE_EXPIRED", "This sign-in request expired. Start again.");
  return new DomainError("CHALLENGE_IN_PROGRESS", "This sign-in request is already being verified.");
}

async function finalize(deps: AppDeps, tx: Tx, ch: ChallengeRow, claimId: string, method: VerificationMethod, input: VerifyInput): Promise<VerifyResult> {
  if (!(await challenges.consume(tx, ch.id, claimId))) {
    throw new DomainError("CHALLENGE_IN_PROGRESS", "This sign-in request is already being verified.");
  }
  const rows: NewAddressRow[] = chainsForVerification(method, ch.chain).map((chain) => ({
    chain, address: ch.address, method, verifiedOnChain: ch.chain, challengeId: ch.id,
  }));
  const owner = await walletRepo.findOwner(tx, ch.chain, ch.address);
  const audit = { requestId: input.meta.requestId, challengeId: ch.id };

  if (ch.purpose === "sign_in") {
    let userId: string;
    let isNewUser = false;
    if (owner) {
      if (owner.status === "disabled") throw new DomainError("ADDRESS_DISABLED", "This wallet address has been disabled. Contact support.");
      if (owner.userStatus !== "active") throw new DomainError("USER_NOT_ACTIVE", "This account is not active");
      userId = owner.userId;
    } else {
      ({ userId } = await walletRepo.createUserWithWallet(tx, { walletProvider: input.walletProvider, rows }));
      isNewUser = true;
      await writeAudit(tx, {
        ...audit, actorType: "user", actorUserId: userId, action: "user.signed_up", entityType: "user", entityId: userId,
        metadata: { chain: ch.chain, address: ch.address, method, chains: rows.map((r) => r.chain) },
      });
    }
    const issued = await sessionRepo.create(tx, { userId, client: input.client, pepper: deps.env.SESSION_TOKEN_PEPPER, meta: input.meta });
    await writeAudit(tx, { ...audit, actorType: "user", actorUserId: userId, action: "session.created", entityType: "session", entityId: issued.id, sessionId: issued.id, metadata: { client: input.client } });
    await writeAudit(tx, { ...audit, actorType: "user", actorUserId: userId, action: "user.signed_in", entityType: "user", entityId: userId, sessionId: issued.id, metadata: { chain: ch.chain, method } });
    return { userId, isNewUser, issued };
  }

  // add_chain_account
  const auth = input.auth!;
  if (owner) {
    if (owner.userId !== auth.userId) throw new DomainError("ADDRESS_ALREADY_LINKED", "This address is linked to another account");
    return { userId: auth.userId, isNewUser: false, issued: null }; // idempotent: no rotation
  }
  const wallet = await walletRepo.activeWalletForUser(tx, auth.userId);
  if (!wallet) throw new DomainError("USER_NOT_ACTIVE", "No active investment wallet");
  const existing = await walletRepo.addressesForWallet(tx, wallet.id);
  const family = familyOf(ch.chain);
  if (existing.some((a) => a.chainFamily === family && a.address !== ch.address)) {
    throw new DomainError("CHAIN_FAMILY_ALREADY_LINKED", "A different address in this chain family is already linked");
  }
  const have = new Set(existing.filter((a) => a.address === ch.address).map((a) => a.chain));
  const toInsert = rows.filter((r) => !have.has(r.chain));
  await walletRepo.insertAddresses(tx, wallet.id, toInsert);
  await writeAudit(tx, {
    ...audit, actorType: "user", actorUserId: auth.userId, action: "wallet.chain_account_added", entityType: "investment_wallet",
    entityId: wallet.id, sessionId: auth.sessionId, metadata: { chain: ch.chain, address: ch.address, method, chains: toInsert.map((r) => r.chain) },
  });
  const issued = await rotateSession(tx, { userId: auth.userId, oldSessionId: auth.sessionId, client: auth.client, pepper: deps.env.SESSION_TOKEN_PEPPER, meta: input.meta });
  return { userId: auth.userId, isNewUser: false, issued };
}
```

Behavior note: in the sign-up race, the loser's first `finalize` rolls back fully (its challenge returns to `processing` under its own `claimId`), so the retry's `consume` succeeds and `findOwner` now returns the winner's user → login.

- [ ] **Step 6: Implement `auth-routes.ts`**

```ts
import { challengeRequestSchema, verifyRequestSchema, type VerifyResponse } from "@repo/contracts";
import { Router } from "express";
import { enforceRateLimit } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import { DomainError } from "../../../shared/errors.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { issueChallenge } from "../application/challenge-service.js";
import { verifyChallenge } from "../application/sign-in-service.js";
import { optionalSession } from "./require-session.js";
import { respondWithSession } from "./session-cookie.js";

export function authRouter(deps: AppDeps): Router {
  const r = Router();

  r.post("/challenge", optionalSession(deps), async (req, res) => {
    const body = parseOrThrow(challengeRequestSchema, req.body);
    if (body.purpose === "add_chain_account" && !req.auth) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
    const out = await issueChallenge(deps, {
      purpose: body.purpose, chain: body.chain, rawAddress: body.address,
      sessionId: body.purpose === "add_chain_account" ? req.auth!.sessionId : null, meta: req.ctx,
    });
    res.json(out);
  });

  r.post("/verify", optionalSession(deps), async (req, res) => {
    const body = parseOrThrow(verifyRequestSchema, req.body);
    await enforceRateLimit(deps.rateLimiter, `verify:ip:${req.ctx.ip}`, 30, 60);
    const result = await verifyChallenge(deps, {
      challengeId: body.challengeId, signature: body.signature, walletProvider: body.walletProvider,
      client: req.auth?.client ?? body.client, auth: req.auth, meta: req.ctx,
    });
    const out: VerifyResponse = { userId: result.userId, isNewUser: result.isNewUser, ...respondWithSession(res, deps.env, req.auth?.client ?? body.client, result.issued) };
    res.json(out);
  });

  return r;
}
```

- [ ] **Step 7: Mount in `src/app.ts`** before the 404 handler:

```ts
  app.use("/v1/auth", authRouter(deps));
```

- [ ] **Step 8: Run — expect PASS** — `pnpm --filter api test -- sign-in`

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): add wallet sign-in with challenge state machine and race-safe finalize"
```

---

### Task 14: Add chain account flow (tests for the `add_chain_account` path)

**Files:**
- Test: `apps/api/test/identity/add-chain-account.test.ts`
- Modify (only if a test exposes a gap): `sign-in-service.ts`, `auth-routes.ts`

**Interfaces:**
- Consumes: `signIn`, `challengeFor`, `webHeaders` helpers; `/v1/auth/*` from Task 13.
- Produces: verified behavior of spec §5.2 including session rotation.

- [ ] **Step 1: Write the test**

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, walletAddresses } from "../../src/db/schema/index.js";
import { buildTestApp } from "../helpers/app.js";
import { challengeFor, signIn, webHeaders } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets.js";

const db = testDb.db;
beforeEach(resetDb);

async function addChain(app: Parameters<typeof challengeFor>[0], cookie: string, wallet: { address: string; sign(m: string): Promise<string> | string }, chain: "solana" | "base" | "ethereum" | "arbitrum" | "bnb") {
  const ch = await challengeFor(app, { purpose: "add_chain_account", chain, address: wallet.address }, webHeaders(cookie));
  if (ch.status !== 200) return ch;
  return request(app).post("/v1/auth/verify").set(webHeaders(cookie)).send({ challengeId: ch.body.challengeId, signature: await wallet.sign(ch.body.message), client: "web" });
}

describe("add chain account", () => {
  it("adds Solana to an EVM user, rotates the session, old token rejected", async () => {
    const { app } = buildTestApp();
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await addChain(app, s.cookie!, newSolanaWallet(), "solana");
    expect(res.status).toBe(200);
    const newCookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="))!;
    expect(newCookie).not.toBe(s.cookie);
    expect((await request(app).get("/v1/me").set("Cookie", s.cookie!)).status).toBe(401);
    expect((await request(app).get("/v1/me").set("Cookie", newCookie)).status).toBe(200);
    const rotated = (await db.select().from(sessions)).find((x) => x.revokeReason === "rotated");
    expect(rotated?.replacedBySessionId).toBeTruthy();
    expect((await db.select().from(walletAddresses)).map((a) => a.chain).sort()).toEqual(["arbitrum", "base", "bnb", "ethereum", "solana"]);
  });

  it("same address already on this user → idempotent, no rotation", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    const res = await addChain(app, s.cookie!, w, "arbitrum");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await request(app).get("/v1/me").set("Cookie", s.cookie!)).status).toBe(200);
  });

  it("address owned by another user → 409 ADDRESS_ALREADY_LINKED", async () => {
    const { app } = buildTestApp();
    const sol = newSolanaWallet();
    await signIn(app, sol, "solana");
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await addChain(app, s.cookie!, sol, "solana");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_ALREADY_LINKED");
  });

  it("two users racing to link the same new address → exactly one wins", async () => {
    const { app } = buildTestApp();
    const sol = newSolanaWallet();
    const a = await signIn(app, newEvmWallet(), "base");
    const b = await signIn(app, newEvmWallet(), "base");
    const [ra, rb] = await Promise.all([addChain(app, a.cookie!, sol, "solana"), addChain(app, b.cookie!, sol, "solana")]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect((await db.select().from(walletAddresses)).filter((x) => x.chain === "solana")).toHaveLength(1);
  });

  it("different address in an already-linked family → 409 CHAIN_FAMILY_ALREADY_LINKED", async () => {
    const { app } = buildTestApp();
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await addChain(app, s.cookie!, newEvmWallet(), "base");
    expect(res.body.error.code).toBe("CHAIN_FAMILY_ALREADY_LINKED");
  });

  it("smart wallet can add the same address on another EVM chain", async () => {
    const { app, fakes } = buildTestApp();
    fakes.evmRpc.behavior = "valid";
    const sw = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };
    const s = await signIn(app, sw, "base");
    const res = await addChain(app, s.cookie!, sw, "arbitrum");
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).map((a) => a.chain).sort()).toEqual(["arbitrum", "base"]);
  });

  it("add_chain_account challenge without a session → 401; used from another session → rejected", async () => {
    const { app } = buildTestApp();
    expect((await challengeFor(app, { purpose: "add_chain_account", chain: "solana", address: newSolanaWallet().address })).status).toBe(401);
    const a = await signIn(app, newEvmWallet(), "base");
    const b = await signIn(app, newEvmWallet(), "base");
    const sol = newSolanaWallet();
    const ch = await challengeFor(app, { purpose: "add_chain_account", chain: "solana", address: sol.address }, webHeaders(a.cookie));
    const res = await request(app).post("/v1/auth/verify").set(webHeaders(b.cookie)).send({ challengeId: ch.body.challengeId, signature: sol.sign(ch.body.message), client: "web" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
  });
});
```
- [ ] **Step 2: Run** — `pnpm --filter api test -- add-chain-account`. Expected: the `/v1/me` assertions FAIL (route not built yet — Task 15). Temporarily run the other cases with `-t "409|smart|without a session"` to confirm they PASS now; the full file passes after Task 15.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/identity/add-chain-account.test.ts
git commit -m "test(api): cover add-chain-account linking, races and rotation"
```

---

### Task 15: Logout, logout-all, `/v1/me`, sessions list and revoke

**Files:**
- Modify: `apps/api/src/modules/identity/http/auth-routes.ts` (logout routes)
- Create: `apps/api/src/modules/identity/http/me-routes.ts`
- Modify: `apps/api/src/app.ts` (mount `/v1/me`)
- Test: `apps/api/test/identity/me.test.ts`

**Interfaces:**
- Produces: `meRouter(deps): Router` (`GET /`, `GET /sessions`, `DELETE /sessions/:id`); contacts and preferences routers are mounted on the same `/v1/me` prefix in Tasks 17–19. `toIso(d: Date): string` in `src/shared/time.ts`.

- [ ] **Step 1: Failing test `test/identity/me.test.ts`**

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { meResponseSchema, sessionsResponseSchema } from "@repo/contracts";
import { buildTestApp } from "../helpers/app.js";
import { signIn, webHeaders } from "../helpers/auth.js";
import { resetDb } from "../helpers/db.js";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets.js";

beforeEach(resetDb);

describe("/v1/me", () => {
  it("returns the user, wallet addresses and contacts in contract shape", async () => {
    const { app } = buildTestApp();
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await request(app).get("/v1/me").set("Cookie", s.cookie!);
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(res.body);
    expect(me.user.id).toBe(s.userId);
    expect(me.wallet.addresses).toHaveLength(4);
    expect(me.contacts).toEqual([]);
  });

  it("sessions list marks current; revoke own; other user's session → 404", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const web = await signIn(app, w, "base");
    const mob = await signIn(app, w, "base", "mobile");
    const other = await signIn(app, newSolanaWallet(), "solana", "mobile");
    const list = sessionsResponseSchema.parse((await request(app).get("/v1/me/sessions").set("Cookie", web.cookie!)).body);
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.filter((x) => x.current)).toHaveLength(1);
    const mobileId = list.sessions.find((x) => x.client === "mobile")!.id;
    const otherList = sessionsResponseSchema.parse((await request(app).get("/v1/me/sessions").set("Authorization", `Bearer ${other.token}`)).body);
    expect((await request(app).delete(`/v1/me/sessions/${otherList.sessions[0]!.id}`).set(webHeaders(web.cookie))).status).toBe(404);
    expect((await request(app).delete(`/v1/me/sessions/${mobileId}`).set(webHeaders(web.cookie))).status).toBe(204);
    expect((await request(app).get("/v1/me").set("Authorization", `Bearer ${mob.token}`)).status).toBe(401);
  });

  it("logout revokes current and clears cookie; logout-all revokes every session", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const a = await signIn(app, w, "base");
    const out = await request(app).post("/v1/auth/logout").set(webHeaders(a.cookie));
    expect(out.status).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/bx_session=;/);
    expect((await request(app).get("/v1/me").set("Cookie", a.cookie!)).status).toBe(401);
    const b = await signIn(app, w, "base");
    const c = await signIn(app, w, "base", "mobile");
    expect((await request(app).post("/v1/auth/logout-all").set("Authorization", `Bearer ${c.token}`)).status).toBe(204);
    expect((await request(app).get("/v1/me").set("Cookie", b.cookie!)).status).toBe(401);
  });

  it("logout requires CSRF headers on the cookie path", async () => {
    const { app } = buildTestApp();
    const a = await signIn(app, newEvmWallet(), "base");
    expect((await request(app).post("/v1/auth/logout").set("Cookie", a.cookie!)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Create `src/shared/time.ts`**

```ts
export const toIso = (d: Date): string => d.toISOString();
export const toIsoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);
```

- [ ] **Step 4: Add logout routes to `authRouter`** (inside `authRouter`, before `return r;`; add imports `requireSession`, `clearSessionCookie`, `sessionRepo`, `writeAudit`):

```ts
  r.post("/logout", requireSession(deps), async (req, res) => {
    const auth = req.auth!;
    await sessionRepo.revoke(deps.db, auth.sessionId, "logout");
    await writeAudit(deps.db, { actorType: "user", actorUserId: auth.userId, action: "session.revoked", entityType: "session", entityId: auth.sessionId, requestId: req.ctx.requestId, sessionId: auth.sessionId, metadata: { reason: "logout" } });
    if (auth.transport === "cookie") clearSessionCookie(res, deps.env);
    res.status(204).end();
  });

  r.post("/logout-all", requireSession(deps), async (req, res) => {
    const auth = req.auth!;
    const n = await sessionRepo.revokeAllForUser(deps.db, auth.userId, "logout_all");
    await writeAudit(deps.db, { actorType: "user", actorUserId: auth.userId, action: "session.revoked_all", entityType: "user", entityId: auth.userId, requestId: req.ctx.requestId, sessionId: auth.sessionId, metadata: { count: n } });
    if (auth.transport === "cookie") clearSessionCookie(res, deps.env);
    res.status(204).end();
  });
```

- [ ] **Step 5: Create `me-routes.ts`**

```ts
import { familyOf, type MeResponse, type SessionsResponse } from "@repo/contracts";
import { and, eq, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../../../deps.js";
import { contacts, sessions, users } from "../../../db/schema/index.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import { toIso, toIsoOrNull } from "../../../shared/time.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { sessionRepo } from "../infra/session-repository.js";
import { walletRepo } from "../infra/wallet-repository.js";
import { requireSession } from "./require-session.js";

export function meRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireSession(deps));

  r.get("/", async (req, res) => {
    const userId = req.auth!.userId;
    const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
    const wallet = await walletRepo.activeWalletForUser(deps.db, userId);
    if (!user || !wallet) throw new DomainError("USER_NOT_ACTIVE", "This account is not active");
    const addresses = await walletRepo.addressesForWallet(deps.db, wallet.id);
    const current = await deps.db.select().from(contacts).where(and(eq(contacts.userId, userId), ne(contacts.status, "replaced")));
    const body: MeResponse = {
      user: { id: user.id, status: user.status, createdAt: toIso(user.createdAt) },
      wallet: {
        id: wallet.id,
        walletProvider: wallet.walletProvider,
        addresses: addresses.map((a) => ({
          chain: a.chain, chainFamily: familyOf(a.chain), address: a.address, status: a.status,
          verificationMethod: a.verificationMethod, verifiedAt: toIso(a.verifiedAt),
        })),
      },
      contacts: current.map((c) => ({ id: c.id, type: c.type, value: c.value, status: c.status === "verified" ? "verified" : "unverified", verifiedAt: toIsoOrNull(c.verifiedAt) })),
    };
    res.json(body);
  });

  r.get("/sessions", async (req, res) => {
    const rows = await sessionRepo.listActiveForUser(deps.db, req.auth!.userId);
    const body: SessionsResponse = {
      sessions: rows.map((s) => ({
        id: s.id, client: s.client, createdAt: toIso(s.createdAt), lastSeenAt: toIso(s.lastSeenAt),
        userAgent: s.userAgent, ipPrefix: s.ipPrefix, current: s.id === req.auth!.sessionId,
      })),
    };
    res.json(body);
  });

  r.delete("/sessions/:id", async (req, res) => {
    const { id } = parseOrThrow(z.object({ id: z.uuid() }), req.params);
    const [owned] = await deps.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, req.auth!.userId)));
    if (!owned) throw new DomainError("NOT_FOUND", "Session not found");
    await sessionRepo.revoke(deps.db, id, "user_revoked");
    await writeAudit(deps.db, { actorType: "user", actorUserId: req.auth!.userId, action: "session.revoked", entityType: "session", entityId: id, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { reason: "user_revoked" } });
    res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 6: Mount** in `app.ts`: `app.use("/v1/me", meRouter(deps));`

- [ ] **Step 7: Run all identity tests — expect PASS** (including Task 14's file) — `pnpm --filter api test -- identity`

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add me, sessions, logout and logout-all endpoints"
```

---

### Task 16: Ops commands — disable/reactivate address, suspend user

**Files:**
- Create: `apps/api/src/ops/ops-service.ts`, `apps/api/src/ops/cli.ts`
- Test: `apps/api/test/ops/ops.test.ts`

**Interfaces:**
- Produces:
  - `disableAddress(db, i: { chain: Chain; address: string; reason: string; operator: string; requestId: string }): Promise<{ disabledRows: number; revokedSessions: number }>` — disables **all chains** for that address and revokes all the owner's sessions.
  - `reactivateAddress(db, i: { chain; address; operator; requestId }): Promise<number>`
  - `suspendUser(db, i: { userId; reason; operator; requestId }): Promise<number>` (returns revoked sessions)
  - CLI: `pnpm --filter api ops:address-disable -- --chain base --address 0x… --reason "…" --operator alice@ops`

- [ ] **Step 1: Failing test `test/ops/ops.test.ts`**

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, walletAddresses } from "../../src/db/schema/index.js";
import { disableAddress, reactivateAddress, suspendUser } from "../../src/ops/ops-service.js";
import { buildTestApp } from "../helpers/app.js";
import { signIn } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets.js";

const db = testDb.db;
beforeEach(resetDb);

describe("ops", () => {
  it("disable blocks sign-in on every chain, revokes sessions, blocks linking by others; reactivate restores", async () => {
    const { app } = buildTestApp();
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    const out = await disableAddress(db, { chain: "ethereum", address: w.address, reason: "reported compromised", operator: "ops@bytesac", requestId: "ops-1" });
    expect(out).toEqual({ disabledRows: 4, revokedSessions: 1 });
    expect((await request(app).get("/v1/me").set("Cookie", s.cookie!)).status).toBe(401);
    expect((await signIn(app, w, "arbitrum")).res.body.error.code).toBe("ADDRESS_DISABLED");
    expect((await db.select().from(walletAddresses)).every((a) => a.status === "disabled" && a.disabledReason === "reported compromised")).toBe(true);
    expect(await reactivateAddress(db, { chain: "base", address: w.address, operator: "ops@bytesac", requestId: "ops-2" })).toBe(4);
    expect((await signIn(app, w, "base")).res.status).toBe(200);
    const actions = (await db.select().from(auditEvents)).filter((a) => a.actorType === "ops").map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["wallet.address_disabled", "session.revoked_all", "wallet.address_reactivated"]));
  });

  it("suspend revokes all sessions and blocks sign-in", async () => {
    const { app } = buildTestApp();
    const w = newSolanaWallet();
    const s = await signIn(app, w, "solana", "mobile");
    expect(await suspendUser(db, { userId: s.userId, reason: "fraud review", operator: "ops@bytesac", requestId: "ops-3" })).toBe(1);
    expect((await signIn(app, w, "solana")).res.body.error.code).toBe("USER_NOT_ACTIVE");
  });

  it("requires a reason and an operator", async () => {
    await expect(disableAddress(db, { chain: "base", address: newEvmWallet().address, reason: "", operator: "x", requestId: "r" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `ops-service.ts`**

```ts
import type { Chain } from "@repo/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users, walletAddresses } from "../db/schema/index.js";
import { canonicalizeAddress } from "../modules/identity/domain/address.js";
import { walletRepo } from "../modules/identity/infra/wallet-repository.js";
import { sessionRepo } from "../modules/identity/infra/session-repository.js";
import { writeAudit } from "../shared/audit.js";

function required(name: string, v: string): void {
  if (!v.trim()) throw new Error(`${name} is required`);
}

export async function disableAddress(db: Db, i: { chain: Chain; address: string; reason: string; operator: string; requestId: string }) {
  required("reason", i.reason);
  required("operator", i.operator);
  const address = canonicalizeAddress(i.chain, i.address);
  return db.transaction(async (tx) => {
    const owner = await walletRepo.findOwner(tx, i.chain, address);
    if (!owner) throw new Error("Address not found");
    const rows = await tx.update(walletAddresses)
      .set({ status: "disabled", disabledAt: sql`now()`, disabledReason: i.reason })
      .where(and(eq(walletAddresses.address, address), eq(walletAddresses.investmentWalletId, owner.walletId), eq(walletAddresses.status, "active")))
      .returning({ id: walletAddresses.id });
    const revoked = await sessionRepo.revokeAllForUser(tx, owner.userId, "admin");
    const base = { actorType: "ops" as const, actorOpsId: i.operator, requestId: i.requestId };
    await writeAudit(tx, { ...base, action: "wallet.address_disabled", entityType: "investment_wallet", entityId: owner.walletId, metadata: { address, rows: rows.length, reason: i.reason } });
    await writeAudit(tx, { ...base, action: "session.revoked_all", entityType: "user", entityId: owner.userId, metadata: { count: revoked, reason: "address_disabled" } });
    return { disabledRows: rows.length, revokedSessions: revoked };
  });
}

export async function reactivateAddress(db: Db, i: { chain: Chain; address: string; operator: string; requestId: string }): Promise<number> {
  required("operator", i.operator);
  const address = canonicalizeAddress(i.chain, i.address);
  return db.transaction(async (tx) => {
    const owner = await walletRepo.findOwner(tx, i.chain, address);
    if (!owner) throw new Error("Address not found");
    const rows = await tx.update(walletAddresses)
      .set({ status: "active", disabledAt: null, disabledReason: null })
      .where(and(eq(walletAddresses.address, address), eq(walletAddresses.investmentWalletId, owner.walletId), eq(walletAddresses.status, "disabled")))
      .returning({ id: walletAddresses.id });
    await writeAudit(tx, { actorType: "ops", actorOpsId: i.operator, requestId: i.requestId, action: "wallet.address_reactivated", entityType: "investment_wallet", entityId: owner.walletId, metadata: { address, rows: rows.length } });
    return rows.length;
  });
}

export async function suspendUser(db: Db, i: { userId: string; reason: string; operator: string; requestId: string }): Promise<number> {
  required("reason", i.reason);
  required("operator", i.operator);
  return db.transaction(async (tx) => {
    const updated = await tx.update(users).set({ status: "suspended", updatedAt: sql`now()` }).where(eq(users.id, i.userId)).returning({ id: users.id });
    if (updated.length !== 1) throw new Error("User not found");
    const revoked = await sessionRepo.revokeAllForUser(tx, i.userId, "user_suspended");
    await writeAudit(tx, { actorType: "ops", actorOpsId: i.operator, requestId: i.requestId, action: "user.suspended", entityType: "user", entityId: i.userId, metadata: { reason: i.reason, revokedSessions: revoked } });
    return revoked;
  });
}
```

- [ ] **Step 4: Implement `cli.ts`**

```ts
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { chainSchema } from "@repo/contracts";
import { loadDotEnvIfPresent, loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { disableAddress, reactivateAddress, suspendUser } from "./ops-service.js";

loadDotEnvIfPresent();
const env = loadEnv();
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const { values } = parseArgs({
  args: rest,
  options: { chain: { type: "string" }, address: { type: "string" }, reason: { type: "string" }, operator: { type: "string" }, user: { type: "string" } },
});
const requestId = `ops-${randomUUID()}`;
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });

try {
  const operator = values.operator ?? "";
  if (command === "address-disable") {
    console.log(await disableAddress(db, { chain: chainSchema.parse(values.chain), address: values.address ?? "", reason: values.reason ?? "", operator, requestId }));
  } else if (command === "address-reactivate") {
    console.log({ reactivated: await reactivateAddress(db, { chain: chainSchema.parse(values.chain), address: values.address ?? "", operator, requestId }) });
  } else if (command === "user-suspend") {
    console.log({ revokedSessions: await suspendUser(db, { userId: values.user ?? "", reason: values.reason ?? "", operator, requestId }) });
  } else {
    throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
  console.log(`requestId=${requestId}`);
} finally {
  await close();
}
```

- [ ] **Step 5: Run — expect PASS** — `pnpm --filter api test -- ops`

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add audited ops commands for address disable/reactivate and suspension"
```

---

### Task 17: Contacts — email OTP (Resend), phone OTP (Twilio Verify), contact versioning

**Files:**
- Modify: `apps/api/src/adapters/email-sender.ts` (add `ResendEmailSender`), `apps/api/src/adapters/sms-otp.ts` (add `TwilioVerifySmsOtp`)
- Create: `apps/api/src/modules/contacts/domain/contact-value.ts`, `otp.ts`; `infra/contact-repository.ts`; `application/contact-service.ts`; `http/contact-routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/contacts/contact-value.test.ts`, `apps/api/test/contacts/contacts.test.ts`

**Interfaces:**
- Produces:
  - `normalizeContact(type: ContactType, raw: string, allowedCountries: string[]): string` (throws `VALIDATION_FAILED`)
  - `maskContact(type, value): string`
  - `generateOtp(): string` (6 digits, CSPRNG); `hashOtp(secret, verificationId, code): string`; `otpMatches(secret, verificationId, code, hash): boolean`
  - `contactService.add(deps, { userId, sessionId, type, rawValue, meta }): Promise<AddContactResponse>`
  - `contactService.resend(deps, { userId, sessionId, contactId, meta }): Promise<AddContactResponse>`
  - `contactService.verify(deps, { userId, sessionId, contactId, code, meta }): Promise<ContactView>`
  - `contactsRouter(deps): Router` (mounted at `/v1/me/contacts`)

- [ ] **Step 1: Failing unit test `test/contacts/contact-value.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { maskContact, normalizeContact } from "../../src/modules/contacts/domain/contact-value.js";
import { generateOtp, hashOtp, otpMatches } from "../../src/modules/contacts/domain/otp.js";

const ALLOWED = ["IN", "US"];

describe("contact values", () => {
  it("normalizes email (trim, lowercase)", () => {
    expect(normalizeContact("email", "  Alice@Example.COM ", ALLOWED)).toBe("alice@example.com");
    expect(() => normalizeContact("email", "not-an-email", ALLOWED)).toThrow();
  });
  it("requires international phone format and an allowed country", () => {
    expect(normalizeContact("phone", "+91 98765 43210", ALLOWED)).toBe("+919876543210");
    expect(() => normalizeContact("phone", "9876543210", ALLOWED)).toThrow(/country code/);
    expect(() => normalizeContact("phone", "+44 7911 123456", ALLOWED)).toThrow(/not supported/);
  });
  it("masks values for audit", () => {
    expect(maskContact("email", "alice@example.com")).toBe("a***@example.com");
    expect(maskContact("phone", "+919876543210")).toBe("+*********10");
  });
});

describe("otp", () => {
  it("6 digits; hash binds to verification id", () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
    const h = hashOtp("s".repeat(32), "v1", code);
    expect(otpMatches("s".repeat(32), "v1", code, h)).toBe(true);
    expect(otpMatches("s".repeat(32), "v2", code, h)).toBe(false);
  });
});
```

- [ ] **Step 2: Failing integration test `test/contacts/contacts.test.ts`**

```ts
import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, contactVerifications, contacts } from "../../src/db/schema/index.js";
import { buildTestApp } from "../helpers/app.js";
import { signIn, webHeaders } from "../helpers/auth.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";
import { newEvmWallet } from "../helpers/wallets.js";

const db = testDb.db;
beforeEach(resetDb);

async function setup() {
  const t = buildTestApp();
  const s = await signIn(t.app, newEvmWallet(), "base");
  const h = webHeaders(s.cookie);
  return { ...t, s, h };
}

describe("contacts", () => {
  it("email: add → code emailed → verify", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: " Alice@Example.com " });
    expect(add.status).toBe(201);
    expect(add.body.contact).toMatchObject({ type: "email", value: "alice@example.com", status: "unverified" });
    const code = fakes.email.sent[0]!.code;
    const bad = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: code === "000000" ? "111111" : "000000" });
    expect(bad.body.error.code).toBe("OTP_INVALID");
    const ok = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("verified");
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "contact.verified"));
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain("alice@example.com");
  });

  it("phone: Twilio Verify start/check with the stored destination", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "+1 415 555 2671" });
    expect(fakes.sms.started).toEqual(["+14155552671"]);
    expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: "123456" })).body.status).toBe("verified");
  });

  it("phone without country code → 400 with clear message", async () => {
    const { app, h } = await setup();
    const res = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "4155552671" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/country code/);
  });

  it("5 wrong attempts → OTP_ATTEMPTS_EXCEEDED, then even the right code fails", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    const code = fakes.email.sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: wrong });
    const res = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code });
    expect(res.body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("expired code → OTP_EXPIRED", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    await adminSql`UPDATE app.contact_verifications SET expires_at = now() - interval '1 second'`;
    const res = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: fakes.email.sent[0]!.code });
    expect(res.body.error.code).toBe("OTP_EXPIRED");
  });

  it("replacing a contact supersedes old OTPs; old code cannot verify the new contact", async () => {
    const { app, fakes, h } = await setup();
    const first = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "old@b.co" });
    const oldCode = fakes.email.sent[0]!.code;
    const second = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "new@b.co" });
    expect((await request(app).post(`/v1/me/contacts/${first.body.contact.id}/verify`).set(h).send({ code: oldCode })).status).toBe(404);
    const newCode = fakes.email.sent[1]!.code;
    if (newCode !== oldCode) {
      expect((await request(app).post(`/v1/me/contacts/${second.body.contact.id}/verify`).set(h).send({ code: oldCode })).body.error.code).toBe("OTP_INVALID");
    }
    const rows = await db.select().from(contacts);
    expect(rows.map((r) => r.status).sort()).toEqual(["replaced", "unverified"]);
    expect((await db.select().from(contactVerifications)).map((v) => v.status).sort()).toEqual(["pending", "superseded"]);
  });

  it("resend: 60 s cooldown, then supersedes the previous code", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    const early = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/resend`).set(h);
    expect(early.status).toBe(429);
    expect(early.body.error.code).toBe("OTP_COOLDOWN");
    await adminSql`UPDATE app.contact_verifications SET created_at = now() - interval '61 seconds'`;
    const again = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/resend`).set(h);
    expect(again.status).toBe(200);
    const firstCode = fakes.email.sent[0]!.code;
    const secondCode = fakes.email.sent[1]!.code;
    if (firstCode !== secondCode) {
      expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: firstCode })).body.error.code).toBe("OTP_INVALID");
    }
    expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: secondCode })).status).toBe(200);
  });

  it("limits: per-user, per-destination, per-IP, global; delivery failure refunds", async () => {
    const { app, fakes, h } = await setup();
    fakes.rateLimiter.deny = ["otp:dest:"];
    expect((await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" })).status).toBe(429);
    fakes.rateLimiter.deny = ["otp:global:sms"];
    const g = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "+14155552671" });
    expect(g.status).toBe(503);
    expect(g.body.error.code).toBe("OTP_DELIVERY_FAILED");
    fakes.rateLimiter.deny = [];
    fakes.email.fail = true;
    const f = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "c@d.co" });
    expect(f.body.error.code).toBe("OTP_DELIVERY_FAILED");
    expect(fakes.rateLimiter.refunded.length).toBeGreaterThanOrEqual(3);
  });

  it("another user's contact → 404; cookie path requires CSRF headers", async () => {
    const a = await setup();
    const add = await request(a.app).post("/v1/me/contacts").set(a.h).send({ type: "email", value: "a@b.co" });
    const b = await signIn(a.app, newEvmWallet(), "base");
    expect((await request(a.app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(webHeaders(b.cookie)).send({ code: "123456" })).status).toBe(404);
    expect((await request(a.app).post("/v1/me/contacts").set("Cookie", a.s.cookie!).send({ type: "email", value: "x@y.co" })).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement `contact-value.ts` and `otp.ts`**

```ts
// contact-value.ts
import type { ContactType } from "@repo/contracts";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import { z } from "zod";
import { DomainError } from "../../../shared/errors.js";

export function normalizeContact(type: ContactType, raw: string, allowedCountries: string[]): string {
  const value = raw.trim();
  if (type === "email") {
    const email = value.toLowerCase();
    if (!z.email().safeParse(email).success) throw new DomainError("VALIDATION_FAILED", "Enter a valid email address");
    return email;
  }
  if (!value.startsWith("+")) throw new DomainError("VALIDATION_FAILED", "Enter the phone number with its country code, e.g. +91 98765 43210");
  let parsed;
  try { parsed = parsePhoneNumberWithError(value); } catch { throw new DomainError("VALIDATION_FAILED", "Enter a valid phone number"); }
  if (!parsed.isValid()) throw new DomainError("VALIDATION_FAILED", "Enter a valid phone number");
  if (!parsed.country || !allowedCountries.includes(parsed.country)) {
    throw new DomainError("VALIDATION_FAILED", "SMS verification is not supported for this country yet");
  }
  return parsed.number;
}

export function maskContact(type: ContactType, value: string): string {
  if (type === "email") {
    const [local, domain] = value.split("@");
    return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
  }
  return `+${"*".repeat(Math.max(0, value.length - 3))}${value.slice(-2)}`;
}
```

```ts
// otp.ts
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL = "10 minutes";
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(secret: string, verificationId: string, code: string): string {
  return createHmac("sha256", secret).update(`${verificationId}:${code}`).digest("hex");
}

export function otpMatches(secret: string, verificationId: string, code: string, hash: string): boolean {
  const a = Buffer.from(hashOtp(secret, verificationId, code), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 5: Implement `contact-repository.ts`**

```ts
import type { ContactType } from "@repo/contracts";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "../../../db/client.js";
import { contactVerifications, contacts } from "../../../db/schema/index.js";
import { OTP_MAX_ATTEMPTS, OTP_TTL } from "../domain/otp.js";

export type ContactRow = typeof contacts.$inferSelect;
export type VerificationRow = typeof contactVerifications.$inferSelect;

export const contactRepo = {
  async current(db: DbOrTx, userId: string, type: ContactType): Promise<ContactRow | undefined> {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.type, type), ne(contacts.status, "replaced")));
    return row;
  },

  async ownedCurrent(db: DbOrTx, userId: string, contactId: string): Promise<ContactRow | undefined> {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.userId, userId), ne(contacts.status, "replaced")));
    return row;
  },

  async replace(tx: Tx, userId: string, type: ContactType, value: string): Promise<{ contact: ContactRow; replaced: ContactRow | undefined }> {
    const replaced = await contactRepo.current(tx, userId, type);
    if (replaced) {
      await tx.update(contacts).set({ status: "replaced" }).where(eq(contacts.id, replaced.id));
      await contactRepo.supersedePending(tx, replaced.id);
    }
    const [contact] = await tx.insert(contacts).values({ userId, type, value }).returning();
    return { contact: contact!, replaced };
  },

  async supersedePending(tx: DbOrTx, contactId: string): Promise<void> {
    await tx.update(contactVerifications).set({ status: "superseded", resolvedAt: sql`now()` })
      .where(and(eq(contactVerifications.contactId, contactId), eq(contactVerifications.status, "pending")));
  },

  async createVerification(tx: DbOrTx, v: { id: string; contactId: string; destination: string; channel: "email" | "sms"; codeHash: string | null }): Promise<VerificationRow> {
    const [row] = await tx.insert(contactVerifications).values({ ...v, expiresAt: sql`now() + ${OTP_TTL}::interval` }).returning();
    return row!;
  },

  async setProviderRef(db: DbOrTx, id: string, providerRef: string): Promise<void> {
    await db.update(contactVerifications).set({ providerRef }).where(eq(contactVerifications.id, id));
  },

  async markFailed(db: DbOrTx, id: string): Promise<void> {
    await db.update(contactVerifications).set({ status: "failed", resolvedAt: sql`now()` }).where(and(eq(contactVerifications.id, id), eq(contactVerifications.status, "pending")));
  },

  async latestPending(db: DbOrTx, contactId: string): Promise<VerificationRow | undefined> {
    const [row] = await db.select().from(contactVerifications)
      .where(and(eq(contactVerifications.contactId, contactId), eq(contactVerifications.status, "pending")))
      .orderBy(desc(contactVerifications.createdAt)).limit(1);
    return row;
  },

  /** Atomically count an attempt; undefined when expired, exhausted or not pending. */
  async registerAttempt(db: DbOrTx, id: string): Promise<VerificationRow | undefined> {
    const [row] = await db.update(contactVerifications).set({ attempts: sql`${contactVerifications.attempts} + 1` })
      .where(and(eq(contactVerifications.id, id), eq(contactVerifications.status, "pending"), lt(contactVerifications.attempts, OTP_MAX_ATTEMPTS), gt(contactVerifications.expiresAt, sql`now()`)))
      .returning();
    return row;
  },

  async isExpired(db: DbOrTx, id: string): Promise<boolean> {
    const [row] = await db.select({ expired: sql<boolean>`${contactVerifications.expiresAt} <= now()` }).from(contactVerifications).where(eq(contactVerifications.id, id));
    return row?.expired ?? true;
  },

  async secondsSinceCreated(db: DbOrTx, id: string): Promise<number> {
    const [row] = await db.select({ s: sql<number>`extract(epoch from now() - ${contactVerifications.createdAt})::int` }).from(contactVerifications).where(eq(contactVerifications.id, id));
    return row?.s ?? Number.MAX_SAFE_INTEGER;
  },

  async markVerified(tx: Tx, verificationId: string, contactId: string): Promise<ContactRow> {
    await tx.update(contactVerifications).set({ status: "verified", resolvedAt: sql`now()` }).where(eq(contactVerifications.id, verificationId));
    const [row] = await tx.update(contacts).set({ status: "verified", verifiedAt: sql`now()` }).where(eq(contacts.id, contactId)).returning();
    return row!;
  },
};
```

- [ ] **Step 6: Implement `contact-service.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { AddContactResponse, ContactType, ContactView } from "@repo/contracts";
import { createHash } from "node:crypto";
import { DeliveryError } from "../../../adapters/email-sender.js";
import { enforceRateLimit, type RateLimitResult } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { toIso, toIsoOrNull } from "../../../shared/time.js";
import { maskContact, normalizeContact } from "../domain/contact-value.js";
import { OTP_RESEND_COOLDOWN_SEC, generateOtp, hashOtp, otpMatches } from "../domain/otp.js";
import { contactRepo, type ContactRow, type VerificationRow } from "../infra/contact-repository.js";

interface Ctx { userId: string; sessionId: string; meta: RequestMeta }

const GLOBAL_PER_MIN: Record<"email" | "sms", number> = { email: 1000, sms: 200 };

function view(c: ContactRow): ContactView {
  return { id: c.id, type: c.type, value: c.value, status: c.status === "verified" ? "verified" : "unverified", verifiedAt: toIsoOrNull(c.verifiedAt) };
}

function channelOf(type: ContactType): "email" | "sms" {
  return type === "email" ? "email" : "sms";
}

async function consumeSendLimits(deps: AppDeps, userId: string, destination: string, channel: "email" | "sms", ip: string): Promise<RateLimitResult[]> {
  const dest = createHash("sha256").update(destination).digest("hex").slice(0, 32);
  const taken: RateLimitResult[] = [];
  try {
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:user:${userId}`, 5, 3600));
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:dest:${dest}:h`, 3, 3600));
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:dest:${dest}:d`, 10, 86_400));
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:ip:${ip}`, 10, 3600));
    const g = await deps.rateLimiter.consume(`otp:global:${channel}`, GLOBAL_PER_MIN[channel], 60);
    taken.push(g);
    if (!g.allowed) {
      deps.logger.error({ channel }, "OTP global circuit breaker tripped");
      throw new DomainError("OTP_DELIVERY_FAILED", "Verification codes are temporarily unavailable. Try again later.");
    }
    return taken;
  } catch (err) {
    await Promise.all(taken.filter((t) => t.allowed).map((t) => deps.rateLimiter.refund(t.bucketKey)));
    throw err;
  }
}

async function send(deps: AppDeps, contact: ContactRow, ctx: Ctx): Promise<VerificationRow> {
  const channel = channelOf(contact.type);
  const limits = await consumeSendLimits(deps, ctx.userId, contact.value, channel, ctx.meta.ip);
  const id = randomUUID();
  const code = channel === "email" ? generateOtp() : null;
  const verification = await deps.db.transaction(async (tx) => {
    await contactRepo.supersedePending(tx, contact.id);
    return contactRepo.createVerification(tx, { id, contactId: contact.id, destination: contact.value, channel, codeHash: code ? hashOtp(deps.env.OTP_HMAC_SECRET, id, code) : null });
  });
  try {
    if (channel === "email") {
      await deps.emailSender.sendOtp({ to: contact.value, code: code! });
    } else {
      const { providerRef } = await deps.smsOtp.start({ to: contact.value });
      await contactRepo.setProviderRef(deps.db, verification.id, providerRef);
    }
  } catch (err) {
    await contactRepo.markFailed(deps.db, verification.id);
    await Promise.all(limits.map((l) => deps.rateLimiter.refund(l.bucketKey)));
    if (err instanceof DeliveryError) throw new DomainError("OTP_DELIVERY_FAILED", "We couldn't send the code. Try again shortly.");
    throw err;
  }
  return verification;
}

function response(contact: ContactRow, v: VerificationRow): AddContactResponse {
  return {
    contact: view(contact),
    verification: { expiresAt: toIso(v.expiresAt), resendAvailableAt: toIso(new Date(v.createdAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000)) },
  };
}

export const contactService = {
  async add(deps: AppDeps, i: Ctx & { type: ContactType; rawValue: string }): Promise<AddContactResponse> {
    const value = normalizeContact(i.type, i.rawValue, deps.env.SMS_ALLOWED_COUNTRIES);
    const { contact } = await deps.db.transaction(async (tx) => {
      const out = await contactRepo.replace(tx, i.userId, i.type, value);
      const base = { actorType: "user" as const, actorUserId: i.userId, requestId: i.meta.requestId, sessionId: i.sessionId, entityType: "contact" };
      if (out.replaced) await writeAudit(tx, { ...base, action: "contact.replaced", entityId: out.replaced.id, metadata: { type: i.type, value: maskContact(i.type, out.replaced.value) } });
      await writeAudit(tx, { ...base, action: "contact.added", entityId: out.contact.id, metadata: { type: i.type, value: maskContact(i.type, value) } });
      return out;
    });
    const v = await send(deps, contact, i);
    return response(contact, v);
  },

  async resend(deps: AppDeps, i: Ctx & { contactId: string }): Promise<AddContactResponse> {
    const contact = await contactRepo.ownedCurrent(deps.db, i.userId, i.contactId);
    if (!contact || contact.status !== "unverified") throw new DomainError("NOT_FOUND", "Contact not found");
    const last = await contactRepo.latestPending(deps.db, contact.id);
    if (last) {
      const since = await contactRepo.secondsSinceCreated(deps.db, last.id);
      if (since < OTP_RESEND_COOLDOWN_SEC) {
        throw new DomainError("OTP_COOLDOWN", "Please wait before requesting another code", { retryAfterSec: OTP_RESEND_COOLDOWN_SEC - since });
      }
    }
    const v = await send(deps, contact, i);
    return response(contact, v);
  },

  async verify(deps: AppDeps, i: Ctx & { contactId: string; code: string }): Promise<ContactView> {
    const contact = await contactRepo.ownedCurrent(deps.db, i.userId, i.contactId);
    if (!contact) throw new DomainError("NOT_FOUND", "Contact not found");
    if (contact.status === "verified") return view(contact);
    const pending = await contactRepo.latestPending(deps.db, contact.id);
    if (!pending || pending.destination !== contact.value) throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
    const attempt = await contactRepo.registerAttempt(deps.db, pending.id);
    if (!attempt) {
      if (await contactRepo.isExpired(deps.db, pending.id)) throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
      await contactRepo.markFailed(deps.db, pending.id);
      throw new DomainError("OTP_ATTEMPTS_EXCEEDED", "Too many attempts. Request a new code.");
    }
    const ok = attempt.channel === "email"
      ? otpMatches(deps.env.OTP_HMAC_SECRET, attempt.id, i.code, attempt.codeHash ?? "")
      : (await deps.smsOtp.check({ to: attempt.destination, code: i.code })) === "approved";
    if (!ok) {
      if (attempt.attempts >= 5) await contactRepo.markFailed(deps.db, attempt.id);
      throw new DomainError("OTP_INVALID", "That code is incorrect");
    }
    const verified = await deps.db.transaction(async (tx) => {
      const row = await contactRepo.markVerified(tx, attempt.id, contact.id);
      await writeAudit(tx, { actorType: "user", actorUserId: i.userId, action: "contact.verified", entityType: "contact", entityId: contact.id, requestId: i.meta.requestId, sessionId: i.sessionId, metadata: { type: contact.type, value: maskContact(contact.type, contact.value) } });
      return row;
    });
    return view(verified);
  },
};
```
(Merge the two `node:crypto` imports into one line.) When the 5th wrong attempt fails, the verification becomes `failed`; the next verify call finds no pending verification and returns `OTP_EXPIRED`. The test for "5 wrong attempts" expects `OTP_ATTEMPTS_EXCEEDED`, so change the "no pending" branch: if the latest verification for the contact is `failed` with `attempts >= 5`, throw `OTP_ATTEMPTS_EXCEEDED`. Add to `contactRepo`:

```ts
  async latest(db: DbOrTx, contactId: string): Promise<VerificationRow | undefined> {
    const [row] = await db.select().from(contactVerifications).where(eq(contactVerifications.contactId, contactId)).orderBy(desc(contactVerifications.createdAt)).limit(1);
    return row;
  },
```
and in `verify` replace the `!pending` line with:

```ts
    if (!pending) {
      const latest = await contactRepo.latest(deps.db, contact.id);
      if (latest?.status === "failed" && latest.attempts >= 5) throw new DomainError("OTP_ATTEMPTS_EXCEEDED", "Too many attempts. Request a new code.");
      throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
    }
    if (pending.destination !== contact.value) throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
```

- [ ] **Step 7: Implement `contact-routes.ts` and mount**

```ts
import { addContactRequestSchema, verifyContactRequestSchema } from "@repo/contracts";
import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../../../deps.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { requireSession } from "../../identity/http/require-session.js";
import { contactService } from "../application/contact-service.js";

const idParam = z.object({ id: z.uuid() });

export function contactsRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireSession(deps));
  const ctx = (req: Express.Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

  r.post("/", async (req, res) => {
    const body = parseOrThrow(addContactRequestSchema, req.body);
    res.status(201).json(await contactService.add(deps, { ...ctx(req), type: body.type, rawValue: body.value }));
  });
  r.post("/:id/verify", async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params);
    const { code } = parseOrThrow(verifyContactRequestSchema, req.body);
    res.json(await contactService.verify(deps, { ...ctx(req), contactId: id, code }));
  });
  r.post("/:id/resend", async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params);
    res.json(await contactService.resend(deps, { ...ctx(req), contactId: id }));
  });
  return r;
}
```
Mount in `app.ts` **before** `app.use("/v1/me", meRouter(deps))`: `app.use("/v1/me/contacts", contactsRouter(deps));`

- [ ] **Step 8: Implement real adapters**

Append to `src/adapters/email-sender.ts`:
```ts
import { Resend } from "resend";

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) { this.client = new Resend(apiKey); }

  async sendOtp(input: { to: string; code: string }): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: "Your Bytesac verification code",
      text: `Your Bytesac verification code is ${input.code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
    });
    if (error) throw new DeliveryError("Resend rejected the email", { cause: error });
  }
}
```
Append to `src/adapters/sms-otp.ts`:
```ts
import twilio from "twilio";
import { DeliveryError } from "./email-sender.js";

export class TwilioVerifySmsOtp implements SmsOtpProvider {
  private readonly client: ReturnType<typeof twilio>;
  constructor(accountSid: string, authToken: string, private readonly serviceSid: string) { this.client = twilio(accountSid, authToken); }

  async start(input: { to: string }): Promise<{ providerRef: string }> {
    try {
      const v = await this.client.verify.v2.services(this.serviceSid).verifications.create({ to: input.to, channel: "sms" });
      return { providerRef: v.sid };
    } catch (err) {
      throw new DeliveryError("Twilio Verify start failed", { cause: err });
    }
  }

  async check(input: { to: string; code: string }): Promise<"approved" | "rejected"> {
    try {
      const r = await this.client.verify.v2.services(this.serviceSid).verificationChecks.create({ to: input.to, code: input.code });
      return r.status === "approved" ? "approved" : "rejected";
    } catch {
      return "rejected";
    }
  }
}
```
Confirm the Resend v6 and Twilio v6 call shapes against their READMEs in `node_modules` before committing.

- [ ] **Step 9: Run — expect PASS** — `pnpm --filter api test -- contacts`, then `pnpm --filter api check-types` (server.ts now compiles).

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add contact verification with email and SMS OTP and abuse limits"
```

---

### Task 18: Notification preferences

**Files:**
- Create: `apps/api/src/modules/contacts/http/preferences-routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/contacts/preferences.test.ts`

**Interfaces:**
- Produces: `preferencesRouter(deps)` mounted at `/v1/me/notification-preferences` (`GET`, `PATCH`).

- [ ] **Step 1: Failing test**

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/app.js";
import { signIn, webHeaders } from "../helpers/auth.js";
import { resetDb } from "../helpers/db.js";
import { newEvmWallet } from "../helpers/wallets.js";

beforeEach(resetDb);

describe("notification preferences", () => {
  it("defaults, partial update, validation, CSRF", async () => {
    const { app } = buildTestApp();
    const s = await signIn(app, newEvmWallet(), "base");
    const get = await request(app).get("/v1/me/notification-preferences").set("Cookie", s.cookie!);
    expect(get.body).toEqual({ rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false });
    const patch = await request(app).patch("/v1/me/notification-preferences").set(webHeaders(s.cookie)).send({ marketing: true });
    expect(patch.status).toBe(200);
    expect(patch.body.marketing).toBe(true);
    expect(patch.body.rebalance).toBe(true);
    expect((await request(app).patch("/v1/me/notification-preferences").set(webHeaders(s.cookie)).send({})).status).toBe(400);
    expect((await request(app).patch("/v1/me/notification-preferences").set(webHeaders(s.cookie)).send({ security: false })).status).toBe(400);
    expect((await request(app).patch("/v1/me/notification-preferences").set("Cookie", s.cookie!).send({ offers: true })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `preferences-routes.ts`**

```ts
import { updateNotificationPreferencesSchema, type NotificationPreferences } from "@repo/contracts";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import type { AppDeps } from "../../../deps.js";
import { notificationPreferences } from "../../../db/schema/index.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { requireSession } from "../../identity/http/require-session.js";

const pick = (r: typeof notificationPreferences.$inferSelect): NotificationPreferences => ({
  rebalance: r.rebalance, portfolioUpdates: r.portfolioUpdates, managerUpdates: r.managerUpdates,
  offers: r.offers, productUpdates: r.productUpdates, marketing: r.marketing,
});

export function preferencesRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireSession(deps));

  r.get("/", async (req, res) => {
    const [row] = await deps.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, req.auth!.userId));
    if (!row) throw new DomainError("NOT_FOUND", "Preferences not found");
    res.json(pick(row));
  });

  r.patch("/", async (req, res) => {
    const patch = parseOrThrow(updateNotificationPreferencesSchema, req.body);
    const row = await deps.db.transaction(async (tx) => {
      const [updated] = await tx.update(notificationPreferences).set({ ...patch, updatedAt: sql`now()` })
        .where(eq(notificationPreferences.userId, req.auth!.userId)).returning();
      if (!updated) throw new DomainError("NOT_FOUND", "Preferences not found");
      await writeAudit(tx, { actorType: "user", actorUserId: req.auth!.userId, action: "notification_preferences.updated", entityType: "user", entityId: req.auth!.userId, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { changed: patch } });
      return updated;
    });
    res.json(pick(row));
  });

  return r;
}
```
Mount before `/v1/me`: `app.use("/v1/me/notification-preferences", preferencesRouter(deps));`

- [ ] **Step 4: Run — expect PASS**; **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add notification preferences endpoints"
```

---

### Task 19: Retention job and worker

**Files:**
- Create: `apps/api/src/jobs/retention.ts`, `apps/api/src/worker.ts`
- Test: `apps/api/test/jobs/retention.test.ts`

**Interfaces:**
- Produces: `runRetention(db: Db, requestId: string): Promise<{ challenges: number; sessions: number; verifications: number }>`; worker process scheduling it daily at 03:00 UTC.

- [ ] **Step 1: Failing test** — seeds rows as admin, runs as the retention role.

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema/index.js";
import { runRetention } from "../../src/jobs/retention.js";
import { buildTestApp } from "../helpers/app.js";
import { signIn } from "../helpers/auth.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";
import { newEvmWallet } from "../helpers/wallets.js";

beforeEach(resetDb);

describe("retention", () => {
  it("purges only eligible rows and keeps evidence and audit", async () => {
    const { app } = buildTestApp();
    const s = await signIn(app, newEvmWallet(), "base");   // challenge referenced by wallet_addresses → kept
    await adminSql`INSERT INTO app.auth_challenges (id, nonce, purpose, chain_family, chain, address, message, domain, uri, chain_id, status, issued_at, expires_at)
      VALUES (gen_random_uuid(), 'old1', 'sign_in', 'evm', 'base', '0x1', 'm', 'd', 'u', '8453', 'rejected', now() - interval '9 days', now() - interval '8 days'),
             (gen_random_uuid(), 'new1', 'sign_in', 'evm', 'base', '0x1', 'm', 'd', 'u', '8453', 'pending', now(), now() + interval '5 minutes')`;
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '8 days' WHERE nonce NOT IN ('old1','new1')`;
    await adminSql`INSERT INTO app.sessions (id, user_id, token_hash, client, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
      VALUES (gen_random_uuid(), ${s.userId}, 'h-old', 'web', now() - interval '100 days', now() - interval '95 days', now() - interval '91 days', 'logout')`;
    const retention = postgres(process.env.TEST_DATABASE_URL!.replace("bytesac_api:bytesac_api_dev", "bytesac_retention:bytesac_retention_dev"), { max: 1 });
    try {
      const out = await runRetention(drizzle(retention, { schema }), "retention-test");
      expect(out).toEqual({ challenges: 1, sessions: 1, verifications: 0 });
    } finally { await retention.end(); }
    const left = await adminSql<{ nonce: string }[]>`SELECT nonce FROM app.auth_challenges`;
    expect(left.map((r) => r.nonce)).toContain("new1");
    expect(left).toHaveLength(2);
    const audit = await testDb.db.select().from(schema.auditEvents);
    expect(audit.find((a) => a.action === "retention.purged")?.metadata).toEqual({ challenges: 1, sessions: 1, verifications: 0 });
    expect(audit.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/jobs/retention.ts`**

```ts
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema/index.js";
import { writeAudit } from "../shared/audit.js";

type AnyDb = PostgresJsDatabase<typeof schema>;

function count(r: unknown): number {
  return (r as { count?: number }).count ?? (r as unknown[]).length ?? 0;
}

export async function runRetention(db: AnyDb, requestId: string): Promise<{ challenges: number; sessions: number; verifications: number }> {
  const challenges = count(await db.execute(sql`
    DELETE FROM app.auth_challenges c
     WHERE c.expires_at < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM app.wallet_addresses w WHERE w.verification_challenge_id = c.id)`));
  const sessions = count(await db.execute(sql`
    DELETE FROM app.sessions
     WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '90 days')
        OR (revoked_at IS NULL AND LEAST(idle_expires_at, absolute_expires_at) < now() - interval '90 days')`));
  const verifications = count(await db.execute(sql`
    DELETE FROM app.contact_verifications
     WHERE (resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days')
        OR (status = 'pending' AND expires_at < now() - interval '90 days')`));
  const out = { challenges, sessions, verifications };
  await writeAudit(db, { actorType: "system", action: "retention.purged", entityType: "system", entityId: "retention", requestId, metadata: out });
  return out;
}
```
postgres.js returns a `RowList` whose `.count` holds affected rows; verify with the test.

- [ ] **Step 4: Implement `src/worker.ts`** (check BullMQ 6 README in `node_modules/bullmq` for the `connection` option and `upsertJobScheduler` signature before writing)

```ts
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadDotEnvIfPresent, loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { runRetention } from "./jobs/retention.js";
import { createLogger } from "./shared/logger.js";

loadDotEnvIfPresent();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
if (!env.RETENTION_DATABASE_URL) throw new Error("RETENTION_DATABASE_URL is required for the worker");
const { db } = createDb(env.RETENTION_DATABASE_URL, { max: 2 });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue("retention", { connection });
await queue.upsertJobScheduler("retention-daily", { pattern: "0 3 * * *", tz: "UTC" }, { name: "purge" });

new Worker("retention", async () => {
  const out = await runRetention(db, `retention-${randomUUID()}`);
  logger.info(out, "retention purge complete");
}, { connection, concurrency: 1 });

logger.info("worker started");
```

- [ ] **Step 5: Run — expect PASS**; **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add retention purge job and worker"
```

---

### Task 20: Full API verification, lint, README

**Files:**
- Create: `apps/api/README.md`, `apps/api/eslint.config.js`
- Modify: `apps/api/package.json` (lint script)

- [ ] **Step 1: ESLint** — `apps/api/eslint.config.js`:
```js
import { config } from "@repo/eslint-config/base";
export default [...config, { ignores: ["dist/**", "src/db/migrations/**"] }];
```
Add `"lint": "eslint . --max-warnings 0"` and devDeps `@repo/eslint-config: workspace:*`, `eslint: 10.9.1`.

- [ ] **Step 2: `apps/api/README.md`** — sections: Overview; Local setup (`pnpm db:up`, copy `.env.example` → `.env`, generate secrets `openssl rand -hex 32`, `pnpm --filter api db:migrate`, `pnpm --filter api db:dev-roles`, `pnpm --filter api dev`); Supabase setup (run migrations with the project's `postgres` role as `MIGRATOR_DATABASE_URL`; then as an operator run `ALTER ROLE bytesac_api LOGIN PASSWORD '<secret>'` and same for `bytesac_retention`; use the pooler URL with those roles; confirm schema `app` is **not** listed in Dashboard → API → Exposed schemas); Tests (`pnpm --filter api test`, requires Docker); Worker (`pnpm --filter api worker`); Ops commands (examples for all three, operator identity required); Security notes (no CORS; CSRF header; cookie; never log secrets).

- [ ] **Step 3: Run the full gate**

Run: `pnpm --filter api lint && pnpm --filter api check-types && pnpm --filter api test && pnpm --filter api build`
Expected: all succeed. Fix any failure before continuing; report failures verbatim if they cannot be fixed.

- [ ] **Step 4: Manual smoke** — `pnpm --filter api dev`, then `curl -s localhost:4000/health` → `{"status":"ok","db":"ok","redis":"ok"}`; `curl -s -X POST localhost:4000/v1/auth/challenge -H 'content-type: application/json' -H 'X-Client: mobile' -d '{"purpose":"sign_in","chain":"solana","address":"4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"}'` → JSON with `challengeId` and a SIWS `message`.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "chore(api): add lint config and README"
```

---

### Task 21: Documentation updates in place (spec §11)

**Files:**
- Modify: `docs/decisions/DECISION-REGISTER.md`, `docs/architecture/ARCHITECTURE.md`, `docs/domains/USER-AUTHENTICATION.md`, `docs/engineering/CODING-STANDARDS.md`, `docs/README.md`, `docs/superpowers/specs/2026-09-29-foundation-user-auth-design.md` (§4.2 roles wording)
- Create: `docs/decisions/ADR-003-BACKEND-SESSIONS.md`, `docs/decisions/ADR-004-CHAIN-ACCOUNT-ASSOCIATION.md`, `docs/decisions/ADR-005-DATABASE-ACCESS-MODEL.md`

Rule: **replace** superseded text; do not append "update" notes. Grep first: `grep -rn "Supabase session\|Supabase is the application user/session\|SUPABASE SESSION" docs --include=*.md` and fix every hit outside `docs/source/`.

- [ ] **Step 1: `DECISION-REGISTER.md`** — rewrite these rows in place and add new rows after D-030:

| ID | Topic | Current direction | Status / notes |
|---|---|---|---|
| D-003 | Wallet authentication | Reown AppKit for wallet connection; backend verifies SIWE (EVM) / SIWS (Solana) signatures and issues backend-managed sessions. Supabase is PostgreSQL only, not the session issuer. | APPROVED by user 2026-09-29 (supersedes "Supabase session" in `docs/source/User-Authentication-Flow.txt`); ADR-003 |
| D-021 | Frontend | Next.js (App Router) + React, Tailwind v4, shadcn/ui; Motion and 3D only selectively. Expo for mobile. Turborepo + pnpm monorepo. | SELECTED |
| D-031 | Sessions | Opaque 32-byte token, HMAC-hashed at rest. Web: httpOnly cookie via same-origin Next proxy, 12 h idle / 7 d absolute. Mobile: bearer in secure storage, 7 d idle / 30 d absolute. No rotation on renewal; rotation on security events (add chain account). DB-time expiry checks. | APPROVED; ADR-003 |
| D-032 | Release-1 auth chains | Solana (SIWS) + EVM (SIWE) on Ethereum, Base, BNB Chain, Arbitrum. | APPROVED |
| D-033 | Chain-account association | Verification method decides scope: ECDSA-recovered EOA proof registers all supported EVM chains; ERC-1271/6492 register only the verified chain; cross-family additions only via explicit logged-in "Add chain account"; different same-family address refused. | APPROVED; ADR-004 |
| D-034 | OTP providers | Email via Resend with backend-generated HMAC-hashed OTP; SMS via Twilio Verify. Behind adapters. | APPROVED |
| D-035 | API contracts & topology | Zod schemas in `packages/contracts`; typed `packages/api-client`; web calls the API through a same-origin Next rewrite; API sends no CORS headers. | APPROVED |
| D-036 | Test runner | Vitest (+ Supertest; `jest-expo` for mobile smoke tests). | APPROVED |
| D-037 | Sign-in challenge lifecycle | `pending → processing (30 s lease) → consumed / rejected`; no transaction held during RPC; consumption atomic with account linking and session creation. | APPROVED |
| D-038 | Database access model | Backend-only DB access; schema `app` not exposed via Supabase Data API; roles `bytesac_api` (DML, no DELETE), `bytesac_retention`, migrations by schema owner; RLS enabled with role-scoped policies as defense-in-depth. | APPROVED; ADR-005 |
| D-039 | Wallet unlink & recovery (release 1) | No user-initiated unlink; ops-only audited disable/reactivate; recovery via future wallet migration. | APPROVED |
| D-040 | Data retention | Challenges 7 days after expiry (except those referenced as address evidence); sessions and contact verifications 90 days; audit events 7 years proposed. | APPROVED except audit period: OPEN pending compliance |

- [ ] **Step 2: ADRs** — create three files using `docs/decisions/ADR-TEMPLATE.md` structure, Status `APPROVED`, Date `2026-09-29`:
  - ADR-003 Backend sessions: context (source doc said Supabase session; user chose backend table), decision (D-031 details), alternatives (Supabase custom JWT; Supabase Web3 sign-in) with trade-offs, consequences (we own revocation/expiry; token hashing with pepper; cookie via proxy; mobile bearer), validation (tests in `apps/api/test/identity/*`).
  - ADR-004 Chain-account association: EOA vs ERC-1271 vs ERC-6492 scope; EIP-7702 note (recovery, not `getCode`); refusal rules; evidence columns; open question: future multi-wallet feature.
  - ADR-005 Database access model: roles, grants, RLS role-scoped policies (no BYPASSRLS needed), Supabase operator steps, test coverage.

- [ ] **Step 3: `ARCHITECTURE.md`** — rewrite §3 diagram footer line `Durable state: PostgreSQL (Supabase)` to `Durable state: PostgreSQL (Supabase-hosted; backend-only access, schema app)` and add `Sessions: backend-managed (sessions table)`; rewrite §4 "Identity and access" bullets to state backend session issuance, method-scoped chain association and no-unlink policy; replace §7 first bullet list item with `users`, `investment_wallets`, `wallet_addresses`, `auth_challenges`, `sessions`, `contacts`, `contact_verifications`, `notification_preferences`; add `audit_events` note (no FKs); in §8 table set `Web | Next.js (App Router) + React + TypeScript`, add rows `Sessions | Backend-managed sessions table (not Supabase Auth)`, `Validation | Zod (shared contracts package)`, `Email OTP | Resend`, `SMS OTP | Twilio Verify`, `Tests | Vitest`.

- [ ] **Step 4: `USER-AUTHENTICATION.md`** — rewrite the "Authentication" paragraph (Reown for connection; backend verifies SIWE/SIWS and issues backend sessions; Supabase = database only; "supersedes the source's Supabase-session wording, see D-003/ADR-003"); rewrite "Sessions" (lifetimes, rotation, logout/logout-all, suspension); add sections "Chain-account association" (D-033) and "Unlink and recovery (release 1)" (D-039).

- [ ] **Step 5: `CODING-STANDARDS.md`** — replace "Use a schema library consistently (select and document one, e.g. Zod, before implementation)." with "Use Zod for all boundary validation; shared request/response schemas live in `packages/contracts`." In Testing, add first bullet "Test runner: Vitest (mobile smoke tests: jest-expo)."

- [ ] **Step 6: `docs/README.md`** — add under "Reading order" item 8: "`superpowers/specs/` and `superpowers/plans/` — approved feature specs and implementation plans."

- [ ] **Step 7: Spec §4.2 wording** — replace "`bytesac_migrator` (DDL, used only by `db:migrate`)" with "the schema-owner role (Supabase `postgres`; local superuser) used only by `db:migrate`", and replace "granted `BYPASSRLS` or table-level policies scoped to this role — whichever Supabase permits, confirmed in planning" with "access via role-scoped RLS policies (no `BYPASSRLS`)". Update §12 risk bullet about BYPASSRLS to "Resolved: role-scoped policies (ADR-005)".

- [ ] **Step 8: Verify no contradictions** — `grep -rn "Supabase session\|session layer" docs --include=*.md | grep -v docs/source` → no stale claims remain.

- [ ] **Step 9: Commit**

```bash
git add docs
git commit -m "docs: record auth, session, DB access and retention decisions in place"
```

---

## Self-Review Notes (completed while writing)

- **Spec coverage:** §4 tables → Task 7; §4.2 → Task 7 (+ADR-005, Task 21); §4.3 → Task 19; §5.1 → Tasks 9–13; §5.2 → Tasks 13–14; §5.3 → Tasks 11–12, 15; §5.4 → Task 8; §5.5 → Task 17; §5.6 → Tasks 8, 13, 17; §5.7 → Task 16; §6–7 → Tasks 6–18; §9 → Tasks 6, 13, 17; §10 → tests throughout; §11 → Task 21; §8 (UI) → Plans B and C.
- **Deliberate refinements vs spec (recorded in docs by Task 21):** challenge request drops the redundant `chainFamily` field (derived from `chain`); mobile identifies itself on `/auth/challenge` with header `X-Client: mobile`; migrations run as the schema owner rather than a separate `bytesac_migrator` role; RLS uses role-scoped policies instead of `BYPASSRLS`.
- **Type consistency:** `IssuedSession`, `AuthContext`, `RequestMeta`, `ChallengeRow`, `NewAddressRow`, `VerifyOutcome` are defined once and reused with the same names.
