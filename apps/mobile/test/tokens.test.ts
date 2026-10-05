import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themes } from "@repo/design-tokens";
import { themeVars } from "@/lib/theme";

const css = readFileSync(join(__dirname, "../src/global.css"), "utf8");
const kebab = (r: string) => r.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("global.css matches @repo/design-tokens themes", () => {
  it("declares every role with its light value (in @theme and :root)", () => {
    for (const [role, value] of Object.entries(themes.light)) {
      const decl = `--color-${kebab(role)}: ${value};`;
      expect(css.split(decl).length - 1).toBe(2);
    }
  });
  it("the runtime variables cover every role in both themes", () => {
    for (const scheme of ["light", "dark"] as const) {
      const vars = themeVars(scheme);
      for (const [role, value] of Object.entries(themes[scheme])) expect(vars[`--color-${kebab(role)}`]).toBe(value);
    }
  });
});
