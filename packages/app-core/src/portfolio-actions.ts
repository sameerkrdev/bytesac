import type { Headline, Portfolio } from "@repo/validator";

type Position = Portfolio["positions"][number];

export const HEADLINE_LABEL: Record<Headline, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  EXECUTION_PENDING: { label: "Operation in progress", tone: "warning" },
  REPAIR_REQUIRED: { label: "Needs repair", tone: "danger" },
  EXECUTION_INCOMPLETE: { label: "Plan incomplete", tone: "warning" },
  REBALANCE_AVAILABLE: { label: "New version available", tone: "info" },
  DRIFTED: { label: "Drifted from target", tone: "warning" },
  CUSTOMIZED: { label: "Custom allocation", tone: "neutral" },
  ALIGNED: { label: "Aligned", tone: "success" },
};

/** What a position offers next. `review`, `rebalance` and `continue` open the rebalance review for `target`; `repair` and `viewOperation` navigate; `keepCustom` and `revertCustom` are API calls. Nothing here moves assets. */
export type PositionAction =
  | { kind: "review"; label: string; target: "latest" }
  | { kind: "rebalance"; label: string; target: "applied" | "latest" }
  | { kind: "keepCustom"; label: string }
  | { kind: "revertCustom"; label: string }
  | { kind: "repair"; label: string }
  | { kind: "continue"; label: string; target: "applied" | "latest" }
  | { kind: "viewOperation"; label: string };

/** True when the user skipped the latest version and the headline no longer offers it. */
export const isSkipped = (p: Position) => p.states.version === "SKIPPED" && p.headline !== "REBALANCE_AVAILABLE";

export function positionActions(p: Position): PositionAction[] {
  const out: PositionAction[] = [];
  const target = p.states.version === "CURRENT" ? "applied" : "latest";
  if ((p.headline === "REBALANCE_AVAILABLE" || isSkipped(p)) && p.latestVersion) out.push({ kind: "review", label: "Review update", target: "latest" });
  if (p.headline === "DRIFTED") out.push({ kind: "rebalance", label: "Rebalance to target", target }, { kind: "keepCustom", label: "Keep custom" });
  if (p.headline === "CUSTOMIZED") out.push({ kind: "revertCustom", label: "Revert custom" });
  if (p.headline === "REPAIR_REQUIRED") out.push({ kind: "repair", label: "Repair" });
  if (p.headline === "EXECUTION_INCOMPLETE") out.push({ kind: "continue", label: "Continue", target });
  if (p.headline === "EXECUTION_PENDING") out.push({ kind: "viewOperation", label: "View operation" });
  return out;
}

/** USD value of a position from its priced holdings plus basket cash; null when any holding has no price. */
export function positionValue(p: Position): number | null {
  if (p.holdings.some((h) => h.valueUsd === null)) return null;
  return p.holdings.reduce((s, h) => s + Number(h.valueUsd), 0) + Number(p.cashMicro) / 1e6;
}

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Plain-language cause for each headline, shown before any action (explain, don't alarm). */
export const HEADLINE_HELP: Record<Headline, string> = {
  EXECUTION_PENDING: "An operation for this basket is still running. Finish or follow it before starting anything else.",
  REPAIR_REQUIRED: "Your wallet holds less of an asset than Bytesac recorded for your baskets — usually because it was moved or sold outside Bytesac.",
  EXECUTION_INCOMPLETE: "Your last plan stopped part-way. Some steps settled; the rest are waiting for you.",
  REBALANCE_AVAILABLE: "The manager published a new version. Nothing has changed in your wallet — review it, then participate or skip.",
  DRIFTED: "Prices moved your weights outside the basket’s bands. You can rebalance to the target or keep your allocation.",
  CUSTOMIZED: "You chose to keep a custom allocation. Bytesac won’t suggest rebalancing until you revert.",
  ALIGNED: "Your holdings match the strategy’s target within its bands.",
};

/**
 * Totals across open positions: value (null when any holding is unpriced), allocation by asset as basis points
 * (top `top` assets, the rest as "Other"), the networks involved and how many positions need attention.
 */
export function portfolioAllocation(portfolio: Portfolio, top = 5) {
  const open = portfolio.positions;
  const values = open.map(positionValue);
  const total = values.every((v) => v !== null) ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  const bySymbol = new Map<string, number>();
  const chains = new Set<string>();
  for (const p of open) for (const h of p.holdings) {
    chains.add(h.chain);
    if (h.valueUsd !== null) bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + Number(h.valueUsd));
  }
  const sum = [...bySymbol.values()].reduce((s, v) => s + v, 0) || 1;
  const slices = [...bySymbol].sort((a, b) => b[1] - a[1]).map(([symbol, v]) => ({ key: symbol, label: symbol, bps: Math.round((v / sum) * 10_000) }));
  const rest = slices.slice(top).reduce((s, x) => s + x.bps, 0);
  const legend = rest > 0 ? [...slices.slice(0, top), { key: "other", label: "Other", bps: rest }] : slices.slice(0, top);
  return { total, slices, legend, chains: [...chains], attention: open.filter((p) => p.headline !== "ALIGNED").length };
}
