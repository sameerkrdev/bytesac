import type { Fee, OperationFeeView, WaivedReason } from "@repo/validator";
import { formatUnits } from "./execution";
import { formatBps } from "./format";

export const PLATFORM_OPERATION_LABEL: Record<string, string> = {
  invest: "Investing", rebalance_apply: "Rebalance (manager update)", rebalance_drift: "Rebalance (drift)", repair: "Repair", sell_to_usdc: "Selling to USDC", sell_former: "Selling former assets",
};

/** "1% up to $50", "1% (at least $2, up to $50)", or a fixed amount. */
export const rateText = (bps: number, minUsdc?: string | null, maxUsdc?: string | null) =>
  `${formatBps(bps)}${minUsdc ? ` (at least $${minUsdc}${maxUsdc ? `, up to $${maxUsdc}` : ""})` : maxUsdc ? ` up to $${maxUsdc}` : ""}`;

export const feeText = (f: Fee) => (f.type === "percent" ? rateText(f.bps, null, f.maxUsdc) : `${f.amountUsdc} USDC`);

export const WAIVED_LABEL: Record<WaivedReason, string> = {
  payout_wallet_unavailable: "the manager has no verified payout wallet",
  dust: "below $0.01",
  no_price: "price unavailable",
};

export const feeLineLabel = (f: OperationFeeView) =>
  f.kind === "network" ? "Network fee (paid to Bytesac for gas)" : f.kind === "platform" ? "Platform fee" : `Manager fee (to ${f.recipientLabel})`;

/** An operation's fee lines (a waived one says why) and their total. */
export function feeLines(fees: OperationFeeView[]): { lines: { label: string; amount: string; waived: boolean }[]; total: string } {
  const total = fees.reduce((s, f) => s + BigInt(f.amountMicro), 0n);
  return {
    lines: fees.map((f) => ({ label: feeLineLabel(f), waived: !!f.waivedReason, amount: f.waivedReason ? `Waived — ${WAIVED_LABEL[f.waivedReason]}` : `${formatUnits(f.amountMicro, 6)} USDC` })),
    total: `${formatUnits(total, 6)} USDC`,
  };
}
