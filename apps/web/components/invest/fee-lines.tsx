import { formatUnits } from "@repo/app-core";
import type { OperationFeeView, WaivedReason } from "@repo/validator";

const WAIVED: Record<WaivedReason, string> = {
  payout_wallet_unavailable: "the manager has no verified payout wallet",
  dust: "below $0.01",
  no_price: "price unavailable",
};
const label = (f: OperationFeeView) =>
  f.kind === "network" ? "Network fee (paid to Bytesac for gas)" : f.kind === "platform" ? "Platform fee" : `Manager fee (to ${f.recipientLabel})`;

/** Every fee of an operation (the fee leg moves their total), a waived one with its reason. */
export function FeeLines({ fees }: { fees: OperationFeeView[] }) {
  const total = fees.reduce((s, f) => s + BigInt(f.amountMicro), 0n);
  return (
    <section aria-label="Fees" className="space-y-1">
      <ul className="space-y-1 text-sm text-ivory">
        {fees.map((f, n) => (
          <li key={n} className="flex justify-between gap-3">
            <span>{label(f)}</span>
            <span>{f.waivedReason ? <span className="text-stone">Waived — {WAIVED[f.waivedReason]}</span> : `${formatUnits(f.amountMicro, 6)} USDC`}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between gap-3 border-t border-border-dark pt-1 text-sm font-medium text-ivory"><span>Total fees</span><span>{formatUnits(total, 6)} USDC</span></p>
      <p className="text-xs text-stone">Fees are not refunded if the operation does not complete.</p>
    </section>
  );
}
