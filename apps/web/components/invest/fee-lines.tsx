import { feeLines } from "@repo/app-core/fees";
import type { OperationFeeView } from "@repo/validator";

/** Every fee of an operation (the fee leg moves their total), a waived one with its reason. */
export function FeeLines({ fees }: { fees: OperationFeeView[] }) {
  const { lines, total } = feeLines(fees);
  return (
    <section aria-label="Fees" className="space-y-1">
      <ul className="space-y-1 text-sm text-ivory">
        {lines.map((l, n) => (
          <li key={n} className="flex justify-between gap-3">
            <span>{l.label}</span>
            <span className={l.waived ? "text-stone" : undefined}>{l.amount}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between gap-3 border-t border-border-dark pt-1 text-sm font-medium text-ivory"><span>Total fees</span><span>{total}</span></p>
      <p className="text-xs text-stone">Fees are not refunded if the operation does not complete.</p>
    </section>
  );
}
