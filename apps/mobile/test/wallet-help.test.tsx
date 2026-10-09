import { fireEvent, render, screen } from "@testing-library/react-native";
import { WalletHelpLink } from "@/components/help/wallet-help-sheet";

describe("WalletHelpLink", () => {
  it("opens the guide with the linked question expanded and toggles others", async () => {
    await render(<WalletHelpLink topic="wrong-wallet" />);
    await fireEvent.press(screen.getByRole("button", { name: "How wallets work" }));
    expect(screen.getByText(/pick the wallet named in the message/)).toBeOnTheScreen();
    expect(screen.queryByText(/same address as before/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /imported my recovery phrase/ }));
    expect(screen.getByText(/same address as before/)).toBeOnTheScreen();
  });
});
