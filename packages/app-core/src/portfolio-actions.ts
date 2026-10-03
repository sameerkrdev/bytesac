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
