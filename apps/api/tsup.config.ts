import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  target: "node24",
  clean: true,
  // Workspace packages export TypeScript source, so they are bundled into the output.
  noExternal: [/^@repo\//],
});
