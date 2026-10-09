import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChainPicker } from "@/components/auth/chain-picker";

describe("ChainPicker (mobile)", () => {
  it("toggles available chains and keeps chains linked elsewhere locked", async () => {
    const onChange = jest.fn();
    await render(<ChainPicker walletName="MetaMask" address="0xAbC0000000000000000000000000000000000001" onChange={onChange} choices={[
      { chain: "base", state: "available", walletName: null, preselected: true },
      { chain: "ethereum", state: "linked-elsewhere", walletName: "Phantom", preselected: false },
    ]} />);
    expect(screen.getByText("linked to Phantom")).toBeOnTheScreen();
    expect(onChange).toHaveBeenLastCalledWith(["base"]);
    await fireEvent(screen.getByLabelText("Base"), "valueChange", false);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByLabelText("Ethereum")).toBeDisabled();
  });
});
