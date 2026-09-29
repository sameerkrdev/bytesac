import { render, screen } from "@testing-library/react";
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
