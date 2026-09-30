import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
jest.mock("@/components/auth/wallet-verification", () => ({ WalletVerification: () => null }));
import { WalletSection } from "@/components/profile/wallet-section";

const me = {
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active" as const, createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: "Phantom", addresses: [
    { chain: "solana" as const, chainFamily: "solana" as const, address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active" as const, verificationMethod: "ed25519" as const, verifiedAt: "2026-09-29T00:00:00.000Z" },
  ] },
  contacts: [],
  permissions: [],
  platformRoles: [],
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
});
