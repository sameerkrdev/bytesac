import { defineConfig } from "tsup";

/**
 * Production build for the API and BullMQ worker (`pnpm --filter api build` → `dist/`).
 * Dev still uses `tsx watch` on the TypeScript sources; this config is for `node dist/*.js`.
 *
 * Entry points are separate programs: logger/@repo code is bundled once per output file
 * (once in dist/server.js, once in dist/worker.js), not once per importing source file.
 * Many `import { logger } from "@repo/logger"` lines share that single bundled module.
 */
export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: "esm",
  target: "node24",
  clean: true,

  /**
   * Bundle workspace packages (`@repo/db`, `@repo/logger`, `@repo/validator`).
   *
   * Those packages export TypeScript (`exports: { ".": "./src/index.ts" }`), not compiled JS.
   * tsup’s default leaves node_modules imports external; leaving `@repo/*` external would make
   * `node dist/server.js` try to load `.ts` and fail.
   *
   * Resolution (tsup does not hardcode packages/):
   *   apps/api depends on "@repo/logger": "workspace:*"
   *   → pnpm links node_modules/@repo/logger to packages/logger
   *   → package.json "exports" → ./src/index.ts
   *   → noExternal matches /^@repo\// → that source is inlined into dist/
   *
   * npm deps of those packages (winston, drizzle-orm, express, …) stay external and must
   * exist in node_modules at runtime (Docker prod-deps / hoisted install).
   */
  noExternal: [/^@repo\//],

  /**
   * Prepended to every output file. Output is ESM (no global require), but some bundled
   * CommonJS deps (e.g. winston-related) still call require(). createRequire restores it.
   */
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
