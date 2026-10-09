import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { VerifyWalletCard } from "@/components/auth/verify-wallet-card";

const account = { chain: "solana" as const, address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", walletName: "Phantom" };
const evm = { chain: "ethereum" as const, address: "0xAbCdEf0123456789aBcDeF0123456789abcdef01", walletName: "MetaMask" };
const h = {
  onSign: jest.fn(), onRetry: jest.fn(), onRestart: jest.fn(), onDisconnect: jest.fn(),
  onSwitchNetwork: jest.fn(), onChooseNetwork: jest.fn(), onReauthenticate: jest.fn(), onCancel: jest.fn(), onConnect: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

describe("VerifyWalletCard (mobile)", () => {
  it("shows both steps, explainer, wallet, chain and short address", async () => {
    await render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...h} />);
    expect(screen.getByText("Connected")).toBeOnTheScreen();
    expect(screen.getByText("Sign to verify")).toBeOnTheScreen();
    expect(screen.getByText("You're signing a message to prove you control this address. It does not authorize any transaction or spending.")).toBeOnTheScreen();
    expect(screen.getByText("Phantom")).toBeOnTheScreen();
    expect(screen.getByText("Solana")).toBeOnTheScreen();
    expect(screen.getByText("4Nd1mB…DB4T")).toBeOnTheScreen();
  });

  it("busy states disable the sign button", async () => {
    await render(<VerifyWalletCard account={account} network="supported" state={{ step: "signing" }} {...h} />);
    expect(screen.getByRole("button", { name: "Waiting for wallet…" })).toBeDisabled();
  });

  it("rejection gives Try again; expiry gives Start again", async () => {
    const { rerender } = await render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "WALLET_REJECTED" }} {...h} />);
    expect(screen.getByText("Signature cancelled")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(h.onRetry).toHaveBeenCalled();
    await rerender(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "CHALLENGE_EXPIRED" }} {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: "Start again" }));
    expect(h.onRestart).toHaveBeenCalled();
  });

  it("unsupported network offers switch and no sign button", async () => {
    await render(<VerifyWalletCard account={null} network="unsupported" state={{ step: "idle" }} {...h} />);
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Switch network" }));
    expect(h.onSwitchNetwork).toHaveBeenCalled();
  });

  it("offers Choose network whenever an account is connected", async () => {
    await render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: "Choose network" }));
    expect(h.onChooseNetwork).toHaveBeenCalled();
  });

  it("disables Sign with a hint when the connected account is already linked", async () => {
    await render(
      <VerifyWalletCard account={evm} network="supported" state={{ step: "idle" }}
        linkedAddresses={[{ chain: "ethereum", address: evm.address.toLowerCase() }]} {...h} />,
    );
    expect(screen.getByText("This account is already linked. Choose another network or account in your wallet.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sign message" })).toBeDisabled();
  });

  it("blocks Sign when the account already has a different address in the connected family", async () => {
    await render(
      <VerifyWalletCard account={evm} network="supported" state={{ step: "idle" }}
        linkedAddresses={[{ chain: "ethereum", address: "0x1111111111111111111111111111111111111111" }]} {...h} />,
    );
    expect(screen.getByText("Your Bytesac account already has a different EVM address. Choose the missing network in your wallet, or use a different wallet.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sign message" })).toBeDisabled();
  });

  it("allows Sign for a family the account does not have yet", async () => {
    await render(
      <VerifyWalletCard account={account} network="supported" state={{ step: "idle" }}
        linkedAddresses={[{ chain: "ethereum", address: evm.address }]} {...h} />,
    );
    expect(screen.getByRole("button", { name: "Sign message" })).toBeEnabled();
  });

  it("offers Use a different wallet only when the caller provides it", async () => {
    const onUseDifferentWallet = jest.fn();
    const { rerender } = await render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...h} />);
    expect(screen.queryByRole("button", { name: "Use a different wallet" })).toBeNull();
    await rerender(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} onUseDifferentWallet={onUseDifferentWallet} {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: "Use a different wallet" }));
    expect(onUseDifferentWallet).toHaveBeenCalled();
  });

  it("does not treat the same address on another chain as linked", async () => {
    await render(
      <VerifyWalletCard account={evm} network="supported" state={{ step: "idle" }}
        linkedAddresses={[{ chain: "base", address: evm.address }]} {...h} />,
    );
    expect(screen.getByRole("button", { name: "Sign message" })).toBeEnabled();
  });

  it("fix-input errors show Disconnect and Choose network instead of Sign", async () => {
    await render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "ADDRESS_ALREADY_LINKED" }} {...h} />);
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Choose network" })).toBeOnTheScreen();
  });

  it("reauthenticate errors offer Sign in again", async () => {
    await render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "SESSION_EXPIRED" }} {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in again" }));
    expect(h.onReauthenticate).toHaveBeenCalled();
  });

  it("wait errors keep Try again disabled until the countdown ends", async () => {
    jest.useFakeTimers();
    try {
      await render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "RATE_LIMITED", retryAfterSec: 2 }} {...h} />);
      expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
      expect(screen.getByText("Try again in 2 s.")).toBeOnTheScreen();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows Cancel while signing or verifying, not when idle", async () => {
    const { rerender } = await render(<VerifyWalletCard account={account} network="supported" state={{ step: "signing" }} {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onCancel).toHaveBeenCalled();
    await rerender(<VerifyWalletCard account={account} network="supported" state={{ step: "verifying" }} {...h} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeOnTheScreen();
    await rerender(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...h} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("offers Connect wallet when nothing is connected", async () => {
    await render(<VerifyWalletCard account={null} network="none" state={{ step: "idle" }} {...h} />);
    await fireEvent.press(screen.getByRole("button", { name: "Connect wallet" }));
    expect(h.onConnect).toHaveBeenCalled();
  });
});
