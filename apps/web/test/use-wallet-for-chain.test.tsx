import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const switchConnection = vi.fn();
const state = vi.hoisted(() => ({ active: "0xaaa", multiWallet: true as boolean | undefined, connections: [] as { connectorId: string; accounts: { address: string }[] }[] }));
const connectionsHook = vi.fn();
vi.mock("@reown/appkit/react", () => ({
  useAppKitConnections: () => { connectionsHook(); return { connections: state.connections, recentConnections: [] }; },
  useAppKitState: () => ({ initialized: true, multiWallet: state.multiWallet }),
  useAppKitConnection: () => ({ switchConnection, isPending: false, deleteConnection: vi.fn() }),
  useAppKitAccount: () => ({ address: state.active, isConnected: true }),
}));
import { useWalletForChain, WalletConnectionsProvider } from "@/lib/wallet/use-wallet-for-chain";

const wrapper = ({ children }: { children: ReactNode }) => <WalletConnectionsProvider>{children}</WalletConnectionsProvider>;
const render = () => renderHook(() => useWalletForChain(me), { wrapper });

const me = { wallet: { addresses: [
  { chain: "base", chainFamily: "evm", address: "0xaaa", status: "active", walletName: "MetaMask" },
  { chain: "arbitrum", chainFamily: "evm", address: "0xccc", status: "active", walletName: "Trust Wallet" },
] } } as never;

beforeEach(() => { vi.clearAllMocks(); state.multiWallet = true; });

describe("useWalletForChain", () => {
  it("is ready when the active connection holds the linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xAAA" }] }];
    const { result } = render();
    expect(await result.current.ensure("base")).toBe("ready");
    expect(switchConnection).not.toHaveBeenCalled();
  });
  it("switches to the connection holding the linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }, { connectorId: "trust", accounts: [{ address: "0xccc" }] }];
    const { result } = render();
    await waitFor(() => expect(result.current.connectionKey).toContain("0xccc"));
    expect(await result.current.ensure("arbitrum")).toBe("ready");
    expect(switchConnection).toHaveBeenCalledWith({ connection: state.connections[1], address: "0xccc" });
  });
  it("reports missing when the linked wallet is not connected, or the chain has no linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }];
    const { result } = render();
    expect(await result.current.ensure("arbitrum")).toBe("missing");
    expect(await result.current.ensure("polygon")).toBe("missing");
    expect(switchConnection).not.toHaveBeenCalled();
  });
  it("never calls the Reown multi-wallet hooks (which raise the Multi-Wallet Not Enabled alert) before the remote config enables them", async () => {
    state.multiWallet = undefined; // AppKit has not fetched the project config yet
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }, { connectorId: "trust", accounts: [{ address: "0xccc" }] }];
    const { result } = render();
    expect(connectionsHook).not.toHaveBeenCalled();
    expect(await result.current.ensure("base")).toBe("ready"); // the active wallet still works
    expect(await result.current.ensure("arbitrum")).toBe("missing");
    expect(switchConnection).not.toHaveBeenCalled();
  });
});
