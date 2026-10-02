import { ASSET_CHAINS, USDC_DECIMALS, type AssetChain, type Leg, type LegState, type OperationState } from "@repo/validator";

type Label = { label: string; tone: "success" | "warning" | "danger" | "neutral" };

export const LEG_STATUS_LABEL: Record<LegState, Label> = {
  PLANNED: { label: "Waiting", tone: "neutral" },
  SUBMITTING: { label: "Sending", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "neutral" },
  PENDING_CHAIN: { label: "Pending on chain", tone: "warning" },
  SETTLED: { label: "Settled", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  UNKNOWN: { label: "Checking outcome", tone: "warning" },
};

export const OPERATION_STATUS_LABEL: Record<OperationState, Label> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  PARTIAL: { label: "Partly completed", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** A raw base-unit integer (decimal string or bigint) as a decimal string, trailing zeros trimmed, at most `maxFraction` places (truncated, never rounded up). */
export function formatUnits(raw: string | bigint, decimals: number, maxFraction = 6): string {
  const n = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${n / base}${frac ? `.${frac}` : ""}`;
}

const EXPLORER: Record<AssetChain, string> = {
  solana: "https://solscan.io/tx/", ethereum: "https://etherscan.io/tx/", base: "https://basescan.org/tx/", bnb: "https://bscscan.com/tx/",
  arbitrum: "https://arbiscan.io/tx/", polygon: "https://polygonscan.com/tx/", bitcoin: "https://mempool.space/tx/",
};
export const explorerTxUrl = (chain: AssetChain, tx: string): string => `${EXPLORER[chain]}${encodeURIComponent(tx)}`;

/** The plan-time summary the API stores on a leg (`decimals` and `symbol` describe the asset side: the output of a buy, the input of a sell). */
export function legRoute(leg: Pick<Leg, "routeSummary">): { tool?: string; estimatedOut?: string; symbol?: string; decimals?: number } {
  const r = leg.routeSummary;
  if (typeof r !== "object" || r === null) return {};
  const o = r as Record<string, unknown>;
  return {
    tool: typeof o.tool === "string" ? o.tool : undefined, estimatedOut: typeof o.estimatedOut === "string" ? o.estimatedOut : undefined,
    symbol: typeof o.symbol === "string" ? o.symbol : undefined, decimals: typeof o.decimals === "number" ? o.decimals : undefined,
  };
}

/** What a leg does, in words: "Fees", "Buy SOL", "Sell ETH". */
export function legTitle(leg: Pick<Leg, "kind" | "routeSummary" | "toChain">, buying: boolean): string {
  if (leg.kind === "network_fee") return "Fees";
  const symbol = legRoute(leg).symbol ?? ASSET_CHAINS[leg.toChain].label;
  return `${buying ? "Buy" : "Sell"} ${symbol}`;
}

/** Amount in and estimated/minimum out of a leg, formatted; the USDC side is always 6 decimals, the asset side uses the summary's decimals. */
export function legAmounts(leg: Pick<Leg, "kind" | "amountIn" | "minOut" | "routeSummary" | "toChain">, buying: boolean): { in: string; estimatedOut: string | null; minOut: string | null } {
  const r = legRoute(leg);
  const inDecimals = buying ? USDC_DECIMALS : (r.decimals ?? 0);
  const outDecimals = buying ? (r.decimals ?? 0) : USDC_DECIMALS;
  const inSymbol = buying ? "USDC" : r.symbol ?? "";
  const outSymbol = buying ? r.symbol ?? "" : "USDC";
  return {
    in: `${formatUnits(leg.amountIn, inDecimals)} ${inSymbol}`.trim(),
    estimatedOut: r.estimatedOut ? `${formatUnits(r.estimatedOut, outDecimals)} ${outSymbol}`.trim() : null,
    minOut: leg.minOut ? `${formatUnits(leg.minOut, outDecimals)} ${outSymbol}`.trim() : null,
  };
}
