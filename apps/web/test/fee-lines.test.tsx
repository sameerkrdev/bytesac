import type { OperationFeeView } from "@repo/validator";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeLines } from "@/components/invest/fee-lines";

const fee = (o: Partial<OperationFeeView>): OperationFeeView => ({ kind: "network", amountMicro: "70000", recipientLabel: "Bytesac (network)", waivedReason: null, ...o });

describe("FeeLines", () => {
  it("lists every fee with its amount, the total and the no-refund note", () => {
    render(<FeeLines fees={[fee({}), fee({ kind: "manager_entry", amountMicro: "1000000", recipientLabel: "Ada Capital" }), fee({ kind: "platform", amountMicro: "500000", recipientLabel: "Bytesac (platform)" })]} />);
    expect(screen.getByText("Network fee (paid to Bytesac for gas)")).toBeInTheDocument();
    expect(screen.getByText("Manager fee (to Ada Capital)")).toBeInTheDocument();
    expect(screen.getByText("Platform fee")).toBeInTheDocument();
    expect(screen.getByText("0.07 USDC")).toBeInTheDocument();
    expect(screen.getByText("1 USDC")).toBeInTheDocument();
    expect(screen.getByText("1.57 USDC")).toBeInTheDocument();
    expect(screen.getByText("Fees are not refunded if the operation does not complete.")).toBeInTheDocument();
  });

  it("shows why a fee was waived and leaves it out of the total", () => {
    render(<FeeLines fees={[
      fee({}),
      fee({ kind: "manager_rebalance", amountMicro: "0", recipientLabel: "Ada Capital", waivedReason: "payout_wallet_unavailable" }),
      fee({ kind: "platform", amountMicro: "0", waivedReason: "dust" }),
      fee({ kind: "platform", amountMicro: "0", waivedReason: "no_price" }),
    ]} />);
    expect(screen.getByText("Waived — the manager has no verified payout wallet")).toBeInTheDocument();
    expect(screen.getByText("Waived — below $0.01")).toBeInTheDocument();
    expect(screen.getByText("Waived — price unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("0.07 USDC")).toHaveLength(2); // the network line and the total
  });
});
