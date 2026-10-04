/** A schema-valid investor portfolio for the mock API: one position per headline worth showing. Fictional. */
import type { OperationView, Portfolio } from "@repo/validator";
import { ASSETS, BASKETS } from "./catalog";

const T = (d: string) => `${d}T10:00:00.000Z`;
const uuid = (n: number) => `0192f1c2-7a4b-7c3d-8e9f-${n.toString(16).padStart(12, "0")}`;
const basketId = (slug: string) => uuid(0x200 + BASKETS.findIndex((b) => b.slug === slug));
const dep = (symbol: string, chain: string) => uuid(0x300 + Object.keys(ASSETS).indexOf(symbol) * 8 + ["solana", "ethereum", "base", "bnb", "arbitrum", "polygon", "bitcoin"].indexOf(chain));
const DEC: Record<string, number> = { BTC: 8, USDC: 6 };

type H = [symbol: keyof typeof ASSETS, chain: string, value: number, targetBps: number, rec?: "OK" | "SHORT" | "SURPLUS"];
function holdings(rows: H[]) {
  const total = rows.reduce((s, r) => s + r[2], 0);
  return rows.map(([k, chain, value, targetBps, rec = "OK"]) => {
    const a = ASSETS[k]!;
    const decimals = DEC[k] ?? (chain === "solana" ? 9 : 18);
    const qty = value / Number(a.price);
    return {
      deploymentId: dep(k, chain), instrumentId: a.id, symbol: a.symbol, chain: chain as "solana",
      quantity: BigInt(Math.round(qty * 10 ** Math.min(decimals, 12))).toString() + "0".repeat(Math.max(0, decimals - 12)), decimals,
      valueUsd: value.toFixed(2), actualBps: Math.round((value / total) * 10_000), targetBps, reconciliation: rec,
    };
  });
}

const diff = { added: [], removed: [], changed: [{ instrumentId: ASSETS.BTC!.id, fromBps: 3000, toBps: 3500 }, { instrumentId: ASSETS.ETH!.id, fromBps: 3500, toBps: 3000 }], bandChanged: [], constraints: false, rebalance: false, fees: false, minimums: false };

function leg(n: number, over: Partial<OperationView["legs"][number]>): OperationView["legs"][number] {
  return {
    id: uuid(0x500 + n), sequence: n, kind: "swap", status: "SETTLED", fromChain: "solana", toChain: "solana", fromDeploymentId: null, toDeploymentId: null,
    amountIn: "100000000", minOut: null, amountReceived: null, provider: "LI.FI", routeSummary: null, quoteExpiresAt: null, gasPayer: "platform_fee_payer",
    sourceTx: `5h${n}xQmock`, destinationTx: null, failureReason: null, priceImpact: 0.0012, routeFees: [], providerSubstatus: null, recoveryOf: null, recoveryToken: null, feeOnTransfer: false, ...over,
  };
}

function op(n: number, kind: OperationView["kind"], status: OperationView["status"], slug: string, amount: string, at: string, legs: OperationView["legs"]): OperationView {
  return {
    id: uuid(0x400 + n), kind, status, basketId: basketId(slug), positionId: uuid(0x100 + n % 3), amountUsdc: amount, sellPercent: null, slippageBps: 100, networkFeeUsdc: "0.42",
    expiresAt: T("2026-10-04"), createdAt: at, legs,
    fees: [{ kind: "network", amountMicro: "420000", recipientLabel: "Bytesac (gas)", waivedReason: null }, { kind: "manager_entry", amountMicro: String(Math.round(Number(amount) * 5000)), recipientLabel: "Meridian Research Partners", waivedReason: null }, { kind: "platform", amountMicro: "0", recipientLabel: "Bytesac", waivedReason: null }],
  };
}

/** A planned investment: the fee step, then one swap or cross-chain buy per asset, all funded from USDC on Solana. */
export function investPlan(seed: (typeof BASKETS)[number], amountUsdc: string, slippageBps: number): OperationView {
  const amount = Number(amountUsdc);
  const fee = 0.42 + amount * (seed.entryBps / 10_000);
  const spend = amount - fee;
  const legs = [leg(1, { kind: "network_fee", status: "PLANNED", amountIn: String(Math.round(fee * 1e6)), priceImpact: null, sourceTx: null, provider: null })];
  seed.weights.forEach(([k, bps], i) => {
    const a = ASSETS[k]!;
    const chain = a.chains[0]!;
    const usd = (spend * bps) / 10_000;
    const out = usd / Number(a.price);
    const decimals = DEC[k] ?? (chain === "solana" ? 9 : 18);
    const raw = (n: number) => BigInt(Math.round(n * 10 ** Math.min(decimals, 9))).toString() + "0".repeat(Math.max(0, decimals - 9));
    legs.push(leg(i + 2, {
      kind: chain === "solana" ? "swap" : "cross_chain", status: "PLANNED", fromChain: "solana", toChain: chain as "solana", toDeploymentId: dep(k, chain),
      amountIn: String(Math.round(usd * 1e6)), minOut: raw(out * (1 - slippageBps / 10_000)), sourceTx: null,
      routeSummary: { tool: "LI.FI", symbol: a.symbol, decimals, estimatedOut: raw(out) },
      gasPayer: chain === "solana" ? "platform_fee_payer" : chain === "bitcoin" ? null : "platform_gas_drop", priceImpact: 0.0008 + i * 0.0004,
      routeFees: [{ name: "LI.FI", amountUsd: usd * 0.0025, included: true }],
    }));
  });
  return {
    id: uuid(0x700 + Math.floor(amount)), kind: "invest", status: "PLANNED", basketId: basketIdOf(seed.slug), positionId: null, amountUsdc, sellPercent: null, slippageBps,
    networkFeeUsdc: "0.42", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt: new Date().toISOString(), legs,
    fees: [
      { kind: "network", amountMicro: "420000", recipientLabel: "Bytesac (gas)", waivedReason: null },
      { kind: "manager_entry", amountMicro: String(Math.round(amount * seed.entryBps * 100)), recipientLabel: "Meridian Research Partners", waivedReason: null },
      { kind: "platform", amountMicro: "0", recipientLabel: "Bytesac", waivedReason: null },
    ],
  };
}
const basketIdOf = basketId;

export function portfolioFor(persona: string): Portfolio {
  if (persona === "new") return { positions: [], repairs: [], openOperations: [], history: [], formerPositions: [] };
  const core = BASKETS[0]!, balanced = BASKETS[1]!, sol = BASKETS[3]!;
  return {
    positions: [
      {
        id: uuid(0x100), basketId: basketId(core.slug), basketSlug: core.slug, basketName: core.name, status: "OPEN", openedAt: T("2026-06-12"), closedAt: null,
        holdings: holdings([["BTC", "bitcoin", 742.1, 3500], ["ETH", "ethereum", 801.4, 3000], ["SOL", "solana", 498.7, 2000], ["LINK", "arbitrum", 201.2, 800], ["BNB", "bnb", 172.6, 700]]),
        states: { version: "OUT_OF_DATE", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" }, headline: "REBALANCE_AVAILABLE", cashMicro: "1240000",
        latestVersion: { id: uuid(0x600), number: 3, rationale: "Rebalanced toward the target method after the quarterly review: Bitcoin's capped market value rose relative to Ether.", diff },
        appliedVersionNumber: 2, driftThresholdBps: 500,
      },
      {
        id: uuid(0x101), basketId: basketId(balanced.slug), basketSlug: balanced.slug, basketName: balanced.name, status: "OPEN", openedAt: T("2026-08-02"), closedAt: null,
        holdings: holdings([["BTC", "bitcoin", 412.0, 3000], ["ETH", "base", 248.9, 2500], ["SOL", "solana", 182.3, 1000], ["TBILL", "ethereum", 252.4, 2500], ["GOLD", "ethereum", 98.2, 1000]]),
        states: { version: "CURRENT", backing: "VERIFIED", allocation: "WEIGHT_DRIFT", execution: "NONE" }, headline: "DRIFTED", cashMicro: "0",
        latestVersion: null, appliedVersionNumber: 2, driftThresholdBps: 400,
      },
      {
        id: uuid(0x102), basketId: basketId(sol.slug), basketSlug: sol.slug, basketName: sol.name, status: "OPEN", openedAt: T("2026-09-01"), closedAt: null,
        holdings: holdings([["SOL", "solana", 151.2, 5000], ["JUP", "solana", 58.4, 2000], ["PYTH", "solana", 46.1, 1500], ["USDC", "solana", 44.9, 1500]]),
        states: { version: "CURRENT", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" }, headline: "ALIGNED", cashMicro: "0",
        latestVersion: null, appliedVersionNumber: 2, driftThresholdBps: 600,
      },
    ],
    repairs: [],
    openOperations: [],
    history: [
      op(1, "invest", "COMPLETED", sol.slug, "300", T("2026-09-01"), [leg(1, { kind: "network_fee", amountIn: "420000", priceImpact: null }), leg(2, {}), leg(3, {}), leg(4, {})]),
      op(2, "invest", "COMPLETED", balanced.slug, "1200", T("2026-08-02"), [leg(5, { kind: "network_fee", amountIn: "420000", priceImpact: null }), leg(6, { kind: "cross_chain", toChain: "ethereum", destinationTx: "0xdest", gasPayer: "platform_gas_drop" }), leg(7, {})]),
      op(0, "rebalance", "PARTIAL", core.slug, null as unknown as string, T("2026-07-20"), [leg(8, { kind: "network_fee", amountIn: "420000", priceImpact: null }), leg(9, {}), leg(10, { status: "FAILED", failureReason: "Quote expired before signing." })]),
    ],
    formerPositions: [],
  };
}
