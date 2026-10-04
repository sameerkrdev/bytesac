import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { themes, type ThemeRole } from "@repo/design-tokens";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The declarations of the first rule whose selector starts with `selector`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  return css.slice(start, css.indexOf("}", start));
}

const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));

describe("globals.css matches @repo/design-tokens themes", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme defines every role with the token value`, () => {
      // Light values sit on `:root, [data-theme="light"]` (the second selector allows light islands inside dark pages).
      const decls = theme === "light" ? block('[data-theme="light"]') : block('[data-theme="dark"]');
      for (const [role, value] of Object.entries(themes[theme]) as [ThemeRole, string][]) {
        expect(decls, role).toContain(`--c-${kebab(role)}: ${value};`);
      }
    });
  }
  it("the OS dark preference uses the dark values when no theme is forced", () => {
    for (const [role, value] of Object.entries(themes.dark)) expect(media, role).toContain(`--c-${kebab(role)}: ${value};`);
  });
  it("supports both colour schemes", () => {
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
  });
});
