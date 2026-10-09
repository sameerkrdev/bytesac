import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChainPicker } from "@/components/auth/chain-picker";

describe("ChainPicker", () => {
  it("shows pre-ticked chains, disables chains linked elsewhere and reports the selection", async () => {
    const onChange = vi.fn();
    render(<ChainPicker walletName="MetaMask" address="0xAbC0000000000000000000000000000000000001" onChange={onChange} choices={[
      { chain: "base", state: "available", walletName: null, preselected: true },
      { chain: "ethereum", state: "linked-elsewhere", walletName: "Phantom", preselected: false },
      { chain: "arbitrum", state: "available", walletName: null, preselected: false },
    ]} />);
    expect(screen.getByText(/Use MetaMask/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Base/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Ethereum.*linked to Phantom/ })).toBeDisabled();
    expect(screen.getByText("linked to Phantom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Arbitrum/ }));
    expect(onChange).toHaveBeenLastCalledWith(["base", "arbitrum"]);
  });
});
