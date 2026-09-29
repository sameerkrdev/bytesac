import { readFileSync } from "node:fs";
import { join } from "node:path";
import { palette, semantic } from "@repo/design-tokens";

const css = readFileSync(join(__dirname, "../src/global.css"), "utf8");

describe("global.css matches @repo/design-tokens", () => {
  it("brand palette", () => {
    for (const [name, hex] of Object.entries(palette)) expect(css).toContain(`--color-${name}: ${hex};`);
  });
  it("semantic", () => {
    expect(css).toContain(`--color-border-dark: ${semantic.borderDark};`);
    expect(css).toContain(`--color-danger: ${semantic.danger};`);
  });
});
