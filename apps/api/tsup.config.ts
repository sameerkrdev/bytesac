import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  target: "node24",
  clean: true,
  // Workspace packages export TypeScript source, so they are bundled into the output.
  noExternal: [/^@repo\//],
  // Bundled CommonJS dependencies (winston) call require() at runtime.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
