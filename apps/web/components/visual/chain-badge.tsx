import { cn } from "@/lib/utils";

/** Chain labels from the validator's CHAINS plus registry-only Polygon. Typographic marks only — never third-party logos. */
const CHAIN: Record<string, { label: string; mono: string }> = {
  solana: { label: "Solana", mono: "SOL" },
  ethereum: { label: "Ethereum", mono: "ETH" },
  base: { label: "Base", mono: "BASE" },
  bnb: { label: "BNB Chain", mono: "BNB" },
  arbitrum: { label: "Arbitrum", mono: "ARB" },
  bitcoin: { label: "Bitcoin", mono: "BTC" },
  polygon: { label: "Polygon", mono: "POL" },
};

export const chainLabel = (chain: string) => CHAIN[chain]?.label ?? chain;

/** A small pill naming a network: a monogram disc plus the chain name (or just the disc when `compact`). */
export function ChainBadge({ chain, compact = false, className }: { chain: string; compact?: boolean; className?: string }) {
  const c = CHAIN[chain] ?? { label: chain, mono: chain.slice(0, 3).toUpperCase() };
  return (
    <span title={c.label} className={cn("inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface py-0.5 pr-2 pl-0.5 text-xs text-ink-muted", compact && "pr-0.5", className)}>
      <span aria-hidden className="grid h-5 min-w-5 place-items-center rounded-pill bg-surface-muted px-1 font-mono text-[0.5625rem] font-medium tracking-wide text-ink">{c.mono}</span>
      {compact ? <span className="sr-only">{c.label}</span> : c.label}
    </span>
  );
}

/** An asset monogram: a soft disc with the ticker's first letters (no token logos). */
export function AssetMark({ symbol, index = 0, size = 32, className }: { symbol: string; index?: number; size?: number; className?: string }) {
  const tints = ["bg-data1 text-primary-ink", "bg-data2 text-white", "bg-data3 text-white", "bg-data4 text-ink", "bg-data5 text-white", "bg-data6 text-ink"];
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-mono font-medium", tints[index % tints.length], className)} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.3) }}>
      {symbol.slice(0, symbol.length > 4 ? 3 : 4)}
    </span>
  );
}
