import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  // Wallet-lab browser profiles hold the installed wallet extensions' bundled code, and its results are local JSON: neither is ours to lint.
  { ignores: ["e2e/__wallet-profiles__/**", "e2e/__wallet-lab__/**"] },
];
