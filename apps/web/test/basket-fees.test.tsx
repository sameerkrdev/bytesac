import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeesEditor, type FeesState } from "@/components/baskets/fees-editor";
import { basketVersion } from "./org-fixtures";

const state = (over: Partial<FeesState> = {}): FeesState => ({ ...basketVersion(), ...over });
const fixed = (amount: string, minimum: string): FeesState => state({ minimumInvestmentUsdc: minimum, fees: { ...basketVersion().fees, entry: { type: "fixed", amountUsdc: amount } } });

describe("Fees editor", () => {
  it("shows the percent cap and switches a fee to fixed", async () => {
    const onChange = vi.fn();
    render(<FeesEditor value={state()} onChange={onChange} readOnly={false} />);
    expect(screen.getAllByText("Up to 1%")).toHaveLength(3);
    await userEvent.selectOptions(screen.getAllByLabelText("How is it charged?")[0]!, "fixed");
    expect(onChange).toHaveBeenCalledWith({ fees: expect.objectContaining({ entry: { type: "fixed", amountUsdc: "0" } }) });
  });

  it("shows 1% of the minimum as the fixed cap", () => {
    render(<FeesEditor value={fixed("12.345678", "1234.567891")} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByText(/Up to 12.345678 USDC/)).toBeInTheDocument();
    expect(screen.queryByText("This is more than 1% of the minimum investment.")).toBeNull();
  });

  it("flags a fixed fee one micro-USDC above 1% of the minimum", () => {
    render(<FeesEditor value={fixed("12.345679", "1234.567891")} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByText("This is more than 1% of the minimum investment.")).toBeInTheDocument();
  });

  it("flags a subscription above the cap and rejects text that is not an amount", () => {
    const fees = { ...basketVersion().fees, subscription: { amountUsdc: "2", period: "monthly" as const } };
    const { rerender } = render(<FeesEditor value={state({ fees })} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByText("This is more than 1% of the minimum investment.")).toBeInTheDocument();
    rerender(<FeesEditor value={state({ fees: { ...fees, subscription: { amountUsdc: "abc", period: "monthly" } } })} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByText("Use a number with up to 6 decimals.")).toBeInTheDocument();
  });

  it("turns a subscription on and off", async () => {
    const onChange = vi.fn();
    render(<FeesEditor value={state()} onChange={onChange} readOnly={false} />);
    await userEvent.click(screen.getByLabelText("Charge a subscription"));
    expect(onChange).toHaveBeenCalledWith({ fees: expect.objectContaining({ subscription: { amountUsdc: "0", period: "monthly" } }) });
  });

  it("sets the optional maximum of a percent fee and shows it as 1% up to $50", async () => {
    const onChange = vi.fn();
    const fees = { ...basketVersion().fees, entry: { type: "percent" as const, bps: 100, maxUsdc: "50" } };
    render(<FeesEditor value={state({ fees })} onChange={onChange} readOnly={false} />);
    expect(screen.getByText("Shown as 1% up to $50")).toBeInTheDocument();
    await userEvent.clear(screen.getAllByLabelText("Maximum (USDC, optional)")[0]!);
    expect(onChange).toHaveBeenCalledWith({ fees: expect.objectContaining({ entry: { type: "percent", bps: 100 } }) });
  });

  it("flags a maximum of zero or text", () => {
    const fees = { ...basketVersion().fees, entry: { type: "percent" as const, bps: 100, maxUsdc: "0" } };
    const { rerender } = render(<FeesEditor value={state({ fees })} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByText("Enter an amount above zero with up to 6 decimals.")).toBeInTheDocument();
    rerender(<FeesEditor value={state({ fees: { ...fees, entry: { type: "percent", bps: 100, maxUsdc: "abc" } } })} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByText("Enter an amount above zero with up to 6 decimals.")).toBeInTheDocument();
  });

  it("says management and subscription are disclosed, not collected", () => {
    render(<FeesEditor value={state()} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getAllByText("Disclosed — not collected in this release.")).toHaveLength(2);
  });
});
