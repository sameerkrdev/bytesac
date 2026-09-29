import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palette, semantic } from "@repo/design-tokens";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("globals.css matches @repo/design-tokens", () => {
  it("contains every brand color", () => {
    for (const [name, hex] of Object.entries(palette)) expect(css, name).toContain(`--color-${name}: ${hex};`);
  });
  it("contains semantic colors", () => {
    expect(css).toContain(`--color-success: ${semantic.success};`);
    expect(css).toContain(`--color-border-dark: ${semantic.borderDark};`);
  });
  it("is dark-only", () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*light/);
    expect(css).toContain("color-scheme: dark");
  });
});
