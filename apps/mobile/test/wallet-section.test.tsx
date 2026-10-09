import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
const mockVerification = jest.fn();
jest.mock("@/components/auth/wallet-verification", () => ({ WalletVerification: (p: unknown) => { mockVerification(p); return null; } }));
import { WalletSection } from "@/components/profile/wallet-section";

const me = {
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active" as const, createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: "Phantom", addresses: [
    { chain: "solana" as const, chainFamily: "solana" as const, address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active" as const, verificationMethod: "ed25519" as const, verifiedAt: "2026-09-29T00:00:00.000Z" },
  ] },
  contacts: [],
  permissions: [],
  platformRoles: [],
  organizations: [],
};

describe("WalletSection (mobile)", () => {
  it("lists addresses with text status and offers Add chain account; no unlink", async () => {
    await render(<QueryClientProvider client={new QueryClient()}><WalletSection me={me} /></QueryClientProvider>);
    expect(screen.getByText("Solana")).toBeOnTheScreen();
    expect(screen.getByText("Active")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Add chain account" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /remove|unlink/i })).toBeNull();
    expect(screen.getByText("Lost access to a wallet? Contact support.")).toBeOnTheScreen();
  });

  it("explains the multi-wallet model and names the missing family in the Add chain account sheet", async () => {
    await render(<QueryClientProvider client={new QueryClient()}><WalletSection me={me} /></QueryClientProvider>);
    expect(screen.getByText("One address per network. Each can come from the same wallet or a different one.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add chain account" }));
    expect(screen.getByText(/^Add your EVM address/)).toBeOnTheScreen();
  });

  it("lists one row per chain with its wallet, and Move to another wallet opens a single-chain reassign", async () => {
    const two = { ...me, wallet: { ...me.wallet, addresses: [
      { ...me.wallet.addresses[0]!, walletName: "Phantom" },
      { chain: "base" as const, chainFamily: "evm" as const, address: "0xAbC0000000000000000000000000000000000001", status: "active" as const, walletName: "MetaMask", verificationMethod: "eoa_ecdsa" as const, verifiedAt: "2026-09-29T00:00:00.000Z" },
      { chain: "ethereum" as const, chainFamily: "evm" as const, address: "0xOld0000000000000000000000000000000000009", status: "replaced" as const, verificationMethod: "eoa_ecdsa" as const, verifiedAt: "2026-09-29T00:00:00.000Z" },
    ] } };
    await render(<QueryClientProvider client={new QueryClient()}><WalletSection me={two} /></QueryClientProvider>);
    expect(screen.getByText(/Phantom · 4Nd1mB…DB4T/)).toBeOnTheScreen();
    expect(screen.getByText(/MetaMask · 0xAbC0…0001/)).toBeOnTheScreen();
    expect(screen.queryByText("Ethereum")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Move .* to another wallet$/ })).toHaveLength(2);
    await fireEvent.press(screen.getByRole("button", { name: "Move Base to another wallet" }));
    expect(screen.getByText("Move Base to another wallet", { exact: true })).toBeOnTheScreen();
    expect(mockVerification).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "reassign_chain", reassign: { chain: "base", previous: { address: "0xAbC0000000000000000000000000000000000001", walletName: "MetaMask" } } }));
  });
});
