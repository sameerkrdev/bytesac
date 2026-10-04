import { cryptoLogo } from "@/lib/crypto-logos";
import { cn } from "@/lib/utils";

/** Chain labels from the validator's CHAINS plus registry-only Polygon; `logo` is the vendored icon's ticker, when one exists. */
const CHAIN: Record<string, { label: string; mono: string; logo?: string }> = {
  solana: { label: "Solana", mono: "SOL", logo: "sol" },
  ethereum: { label: "Ethereum", mono: "ETH", logo: "eth" },
  base: { label: "Base", mono: "BASE" },
  bnb: { label: "BNB Chain", mono: "BNB", logo: "bnb" },
  arbitrum: { label: "Arbitrum", mono: "ARB" },
  bitcoin: { label: "Bitcoin", mono: "BTC", logo: "btc" },
  polygon: { label: "Polygon", mono: "POL", logo: "matic" },
};

export const chainLabel = (chain: string) => CHAIN[chain]?.label ?? chain;

/** A small pill naming a network: a monogram disc plus the chain name (or just the disc when `compact`). */
export function ChainBadge({ chain, compact = false, className }: { chain: string; compact?: boolean; className?: string }) {
  const c = CHAIN[chain] ?? { label: chain, mono: chain.slice(0, 3).toUpperCase() };
  return (
    <span title={c.label} className={cn("inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface py-0.5 pr-2 pl-0.5 text-xs text-ink-muted", compact && "pr-0.5", className)}>
      {c.logo
        // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG
        ? <img alt="" aria-hidden src={`/crypto/${c.logo}.svg`} width={20} height={20} className="size-5 rounded-full" />
        : <span aria-hidden className="grid h-5 min-w-5 place-items-center rounded-pill bg-surface-muted px-1 font-mono text-[0.5625rem] font-medium tracking-wide text-ink">{c.mono}</span>}
      {compact ? <span className="sr-only">{c.label}</span> : c.label}
    </span>
  );
}

/**
 * An asset's mark: the logo uploaded to the registry when there is one, else the vendored icon for well-known tickers,
 * else a soft monogram disc. Decorative: the symbol is always shown as text beside it.
 */
export function AssetMark({ symbol, logoUrl, index = 0, size = 32, className }: { symbol: string; logoUrl?: string | null; index?: number; size?: number; className?: string }) {
  const src = logoUrl ?? cryptoLogo(symbol);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- small logos from the registry or public/crypto
    return <img alt="" aria-hidden src={src} width={size} height={size} loading="lazy" className={cn("shrink-0 rounded-full bg-surface object-contain", className)} style={{ width: size, height: size }} />;
  }
  const tints = ["bg-data1 text-primary-ink", "bg-data2 text-white", "bg-data3 text-white", "bg-data4 text-ink", "bg-data5 text-white", "bg-data6 text-ink"];
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-mono font-medium", tints[index % tints.length], className)} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.3) }}>
      {symbol.slice(0, symbol.length > 4 ? 3 : 4)}
    </span>
  );
}
