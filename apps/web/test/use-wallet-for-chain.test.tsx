import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const switchConnection = vi.fn();
const state = vi.hoisted(() => ({ active: "0xaaa", connections: [] as { connectorId: string; accounts: { address: string }[] }[] }));
vi.mock("@reown/appkit/react", () => ({
  useAppKitConnections: () => ({ connections: state.connections, recentConnections: [] }),
  useAppKitConnection: () => ({ switchConnection, isPending: false, deleteConnection: vi.fn() }),
  useAppKitAccount: () => ({ address: state.active, isConnected: true }),
}));
import { useWalletForChain } from "@/lib/wallet/use-wallet-for-chain";

const me = { wallet: { addresses: [
  { chain: "base", chainFamily: "evm", address: "0xaaa", status: "active", walletName: "MetaMask" },
  { chain: "arbitrum", chainFamily: "evm", address: "0xccc", status: "active", walletName: "Trust Wallet" },
] } } as never;

beforeEach(() => vi.clearAllMocks());

describe("useWalletForChain", () => {
  it("is ready when the active connection holds the linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xAAA" }] }];
    const { result } = renderHook(() => useWalletForChain(me));
    expect(await result.current.ensure("base")).toBe("ready");
    expect(switchConnection).not.toHaveBeenCalled();
  });
  it("switches to the connection holding the linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }, { connectorId: "trust", accounts: [{ address: "0xccc" }] }];
    const { result } = renderHook(() => useWalletForChain(me));
    expect(await result.current.ensure("arbitrum")).toBe("ready");
    expect(switchConnection).toHaveBeenCalledWith({ connection: state.connections[1], address: "0xccc" });
  });
  it("reports missing when the linked wallet is not connected, or the chain has no linked address", async () => {
    state.connections = [{ connectorId: "mm", accounts: [{ address: "0xaaa" }] }];
    const { result } = renderHook(() => useWalletForChain(me));
    expect(await result.current.ensure("arbitrum")).toBe("missing");
    expect(await result.current.ensure("polygon")).toBe("missing");
    expect(switchConnection).not.toHaveBeenCalled();
  });
});
