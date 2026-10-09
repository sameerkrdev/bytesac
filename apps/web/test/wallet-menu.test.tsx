import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ open: vi.fn(), disconnect: vi.fn(), eip: [] as unknown[] }));
vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: h.open }),
  useDisconnect: () => ({ disconnect: h.disconnect }),
  useAppKitConnections: (ns: string) => ({ connections: ns === "eip155" ? h.eip : [], recentConnections: [] }),
}));
import { WalletMenu } from "@/components/layout/wallet-menu";

const row = (chain: string, address: string, walletName: string) => ({ chain, address, walletName, status: "active" });
const me = { wallet: { addresses: [row("base", "0xaaa0000000000000000000000000000000000001", "MetaMask"), row("arbitrum", "0xaaa0000000000000000000000000000000000001", "MetaMask"), row("solana", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", "Phantom")] } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.eip = [{ name: "MetaMask", icon: "", connectorId: "mm", accounts: [{ address: "0xAAA0000000000000000000000000000000000001" }] }];
});

describe("WalletMenu", () => {
  it("lists a connection with the chains it serves, and disconnects it", async () => {
    render(<WalletMenu me={me} />);
    await userEvent.click(screen.getByRole("button", { name: "Wallets" }));
    expect(await screen.findByText("MetaMask")).toBeInTheDocument();
    expect(screen.getByText(/Base, Arbitrum/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Disconnect MetaMask" }));
    expect(h.disconnect).toHaveBeenCalledWith({ id: "mm", namespace: "eip155" });
  });
  it("offers Reconnect for a linked wallet that is not connected", async () => {
    render(<WalletMenu me={me} />);
    await userEvent.click(screen.getByRole("button", { name: "Wallets" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reconnect Phantom" }));
    expect(h.open).toHaveBeenCalledWith({ view: "Connect" });
  });
});
