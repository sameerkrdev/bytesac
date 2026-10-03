import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const files = walk(SRC).filter((f) => f.endsWith(".ts"));
const known = new Set(files.map((f) => f.slice(0, -3)));

/** Value imports only: `import type` is erased and cannot form a runtime cycle. */
const importsOf = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^(import|export)\s(?!type\s)[^;]*?\sfrom\s"([^"]+)";/gms)) {
    const spec = m[2]!;
    const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
    if (!base) continue;
    const target = [base, path.join(base, "index")].find((c) => known.has(c));
    if (target) out.push(target + ".ts");
  }
  return out;
};
const graph = new Map(files.map((f) => [f, importsOf(f)]));
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

it("src has no import cycles", () => {
  const cycles: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (n: string, stack: string[]): void => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) { cycles.push([...stack.slice(stack.indexOf(n)), n].map(rel).join(" -> ")); return; }
    state.set(n, 1);
    for (const m of graph.get(n) ?? []) visit(m, [...stack, n]);
    state.set(n, 2);
  };
  for (const f of files) visit(f, []);
  expect(cycles).toEqual([]);
});

it("a module reaches another module only through its *.service file (routers may compose routers)", () => {
  const moduleOf = (f: string) => /^modules\/([^/]+)\//.exec(rel(f))?.[1];
  const violations: string[] = [];
  for (const [file, targets] of graph) {
    const from = moduleOf(file);
    if (!from) continue;
    for (const t of targets) {
      const to = moduleOf(t);
      if (!to || to === from) continue;
      const service = t.endsWith(".service.ts");
      const composition = file.endsWith(".route.ts") && t.endsWith(".route.ts");
      if (!service && !composition) violations.push(`${rel(file)} -> ${rel(t)}`);
    }
  }
  expect(violations).toEqual([]);
});
