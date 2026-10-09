import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeResponse } from "@repo/validator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const verification = vi.fn((_: unknown) => null);
vi.mock("@/components/auth/wallet-verification", () => ({ WalletVerification: (p: unknown) => verification(p) }));
import { canAddChainAccount } from "@repo/app-core";
import { WalletSection } from "@/components/profile/wallet-section";

const evm = (chain: "ethereum" | "base" | "bnb" | "arbitrum" | "polygon", method: "eoa_ecdsa" | "erc1271" = "eoa_ecdsa") =>
  ({ chain, chainFamily: "evm" as const, address: "0x1234567890abcdef1234567890abcdef12345678", status: "active" as const, verificationMethod: method, verifiedAt: "2026-09-29T00:00:00.000Z" });
const me = (addresses: MeResponse["wallet"]["addresses"]): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: "MetaMask", addresses },
  contacts: [],
  permissions: [],
  platformRoles: [],
  organizations: [],
});

describe("WalletSection", () => {
  it("lists addresses with chain, status and method, no remove control", () => {
    render(<QueryClientProvider client={new QueryClient()}><WalletSection me={me([evm("ethereum"), evm("base")])} /></QueryClientProvider>);
    expect(screen.getAllByText("0x1234…5678")).toHaveLength(2);
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getAllByText("Active")).toHaveLength(2);
    expect(screen.getAllByText("Key signature")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /remove|unlink/i })).toBeNull();
    expect(screen.getByText("Lost access to a wallet? Contact support.")).toBeInTheDocument();
  });
  it("hides Add chain account when every EVM chain + Solana are linked", () => {
    const all = me([evm("ethereum"), evm("base"), evm("bnb"), evm("arbitrum"), evm("polygon"),
      { chain: "solana", chainFamily: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active", verificationMethod: "ed25519", verifiedAt: "2026-09-29T00:00:00.000Z" }]);
    expect(canAddChainAccount(all)).toBe(false);
    expect(canAddChainAccount(me([evm("base", "erc1271")]))).toBe(true);
  });
});

describe("WalletSection per-chain wallets (D-120)", () => {
  it("shows the wallet per chain, hides replaced rows and opens a fixed-chain move", async () => {
    const base = { ...evm("base"), walletName: "MetaMask" };
    const sol = { chain: "solana" as const, chainFamily: "solana" as const, address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active" as const, verificationMethod: "ed25519" as const, verifiedAt: "2026-09-29T00:00:00.000Z", walletName: "Phantom" };
    const old = { ...evm("ethereum"), status: "replaced" as const, walletName: "Old" };
    render(<QueryClientProvider client={new QueryClient()}><WalletSection me={me([base, sol, old])} /></QueryClientProvider>);
    expect(screen.getByText("Phantom")).toBeInTheDocument();
    expect(screen.queryByText("Old")).toBeNull();
    expect(screen.getAllByRole("button", { name: /to another wallet/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Move Base to another wallet" }));
    expect(screen.getByText(/Only possible when you hold nothing on Base\./)).toBeInTheDocument();
    expect(verification).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "reassign_chain", reassign: { chain: "base", previous: { address: base.address, walletName: "MetaMask" } } }));
  });
});

