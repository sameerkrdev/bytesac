import { formatBps } from "@repo/app-core/format";
import type { Fee } from "@repo/validator";

export const PLATFORM_OPERATION_LABEL: Record<string, string> = {
  invest: "Investing", rebalance_apply: "Rebalance (manager update)", rebalance_drift: "Rebalance (drift)", repair: "Repair", sell_to_usdc: "Selling to USDC", sell_former: "Selling former assets",
};

/** "1% up to $50", "1% (at least $2, up to $50)", or a fixed amount. */
export const rateText = (bps: number, minUsdc?: string | null, maxUsdc?: string | null) =>
  `${formatBps(bps)}${minUsdc ? ` (at least $${minUsdc}${maxUsdc ? `, up to $${maxUsdc}` : ""})` : maxUsdc ? ` up to $${maxUsdc}` : ""}`;

export const feeText = (f: Fee) => (f.type === "percent" ? rateText(f.bps, null, f.maxUsdc) : `${f.amountUsdc} USDC`);
