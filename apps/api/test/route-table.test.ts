import express from "express";
import { expect, it } from "vitest";

// Records the mount path of every router `use()` before the app is built (Express 5 layers do not keep it).
const mounts = new Map<unknown, string>();
const proto = express.Router.prototype as unknown as { use: (...a: unknown[]) => unknown };
const originalUse = proto.use;
proto.use = function (this: unknown, ...args: unknown[]) {
  if (typeof args[0] === "string") for (const h of args.slice(1)) mounts.set(h, args[0]);
  return originalUse.apply(this, args);
};

interface Layer { handle: { stack?: Layer[]; name?: string }; route?: { path: unknown; methods: Record<string, boolean>; stack: unknown[] } }

const walk = (stack: Layer[], prefix: string, out: string[]): void => {
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${String(layer.route.path)} handlers=${layer.route.stack.length}`);
    } else if (layer.handle.stack) walk(layer.handle.stack, prefix + (mounts.get(layer.handle) ?? ""), out);
    else out.push(`USE ${prefix || "/"} ${layer.handle.name ?? "anonymous"}`);
  }
};

it("mounts exactly the same endpoints and middleware", async () => {
  const { app } = await import("../src/app");
  const out: string[] = [];
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack, "", out);
  expect(out.sort()).toMatchSnapshot();
});
