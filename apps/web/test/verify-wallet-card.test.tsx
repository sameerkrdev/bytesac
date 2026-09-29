import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VerifyWalletCard } from "@/components/auth/verify-wallet-card";

const account = { chain: "base" as const, address: "0x1234567890abcdef1234567890abcdef12345678", walletName: "MetaMask" };
const noop = () => undefined;
const handlers = { onSign: noop, onRetry: noop, onRestart: noop, onDisconnect: noop, onSwitchNetwork: noop };

describe("VerifyWalletCard", () => {
  it("shows connected step, explainer, wallet, chain and short address", () => {
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...handlers} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Sign to verify")).toBeInTheDocument();
    expect(screen.getByText("You're signing a message to prove you control this address. It does not authorize any transaction or spending.")).toBeInTheDocument();
    expect(screen.getByText("MetaMask")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("0x1234…5678")).toBeInTheDocument();
  });
  it("disables Sign while signing/verifying", () => {
    const onSign = vi.fn();
    const { rerender } = render(<VerifyWalletCard account={account} network="supported" state={{ step: "signing" }} {...handlers} onSign={onSign} />);
    expect(screen.getByRole("button", { name: /waiting for wallet/i })).toBeDisabled();
    rerender(<VerifyWalletCard account={account} network="supported" state={{ step: "verifying" }} {...handlers} onSign={onSign} />);
    expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled();
  });
  it("wallet rejection offers Try again", async () => {
    const onRetry = vi.fn();
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "WALLET_REJECTED" }} {...handlers} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Signature cancelled");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("expired challenge offers Start again", async () => {
    const onRestart = vi.fn();
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "CHALLENGE_EXPIRED" }} {...handlers} onRestart={onRestart} />);
    await userEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(onRestart).toHaveBeenCalled();
  });
  it("unsupported network disables signing and offers switch", () => {
    render(<VerifyWalletCard account={null} network="unsupported" state={{ step: "idle" }} {...handlers} />);
    expect(screen.getByText(/switch to a supported network/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Switch network" })).toBeEnabled();
  });
  it("rate limit shows wait copy", () => {
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "RATE_LIMITED", retryAfterSec: 30 }} {...handlers} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByRole("alert")).toHaveTextContent("30 s");
  });
});

describe("VerifyWalletCard add-chain", () => {
  it("disables Sign with a hint when the connected account is already linked, and offers Choose network", async () => {
    const onChooseNetwork = vi.fn();
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...handlers} onChooseNetwork={onChooseNetwork}
      linkedAddresses={[{ chain: "base", address: account.address }]} />);
    expect(screen.getByRole("button", { name: "Sign message" })).toBeDisabled();
    expect(screen.getByText("This account is already linked. Choose another network or account in your wallet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Choose network" }));
    expect(onChooseNetwork).toHaveBeenCalled();
  });
  it("keeps Sign enabled on a different chain of the same address", () => {
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "idle" }} {...handlers}
      linkedAddresses={[{ chain: "ethereum", address: account.address }]} />);
    expect(screen.getByRole("button", { name: "Sign message" })).toBeEnabled();
  });
  it("fix-input error offers Choose network and Disconnect, not Sign message", () => {
    render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "CHAIN_FAMILY_ALREADY_LINKED" }} {...handlers} onChooseNetwork={noop} />);
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose network" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });
  it("reauthenticate error offers Sign in again with a hard navigation", async () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, replace });
    try {
      render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "SESSION_EXPIRED" }} {...handlers} />);
      expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
      expect(replace).toHaveBeenCalledWith("/sign-in?reason=expired");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("VerifyWalletCard rate-limit countdown", () => {
  it("disables Try again until countdown ends", async () => {
    vi.useFakeTimers();
    try {
      render(<VerifyWalletCard account={account} network="supported" state={{ step: "error", code: "RATE_LIMITED", retryAfterSec: 2 }} {...handlers} />);
      expect(screen.getByRole("button", { name: /try again in 2 s/i })).toBeDisabled();
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
