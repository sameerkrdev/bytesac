import { WalletRejectedError, WrongWalletError } from "@repo/app-core";
import { renderHook } from "@testing-library/react-native";
import bs58 from "bs58";
import { useSigner } from "@/lib/wallet/use-signer";

const SOL = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const EVM = "0xAbC0000000000000000000000000000000000001";
const mockState = {
  appkit: { address: SOL as string | undefined, namespace: "solana" as string | undefined, chainId: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
  provider: { request: jest.fn() },
  walletName: "Phantom",
  evm: { isConnected: true, address: EVM as string | undefined, chainId: 1 },
  send: jest.fn(),
  switchChain: jest.fn(),
  receipt: jest.fn(),
};
jest.mock("@reown/appkit-react-native", () => ({
  useAccount: () => mockState.appkit,
  useProvider: () => ({ provider: mockState.provider }),
  useWalletInfo: () => ({ walletInfo: { name: mockState.walletName } }),
}));
jest.mock("wagmi", () => ({
  useAccount: () => mockState.evm,
  useConfig: () => ({}),
  useSendTransaction: () => ({ sendTransactionAsync: mockState.send }),
  useSwitchChain: () => ({ switchChainAsync: mockState.switchChain }),
}));
jest.mock("wagmi/actions", () => ({ waitForTransactionReceipt: (...a: unknown[]) => mockState.receipt(...a) }));

const me = {
  wallet: { addresses: [
    { chain: "solana", address: SOL, status: "active" },
    { chain: "ethereum", address: EVM.toLowerCase(), status: "active" },
  ] },
} as never;
const bytes = (...n: number[]) => Uint8Array.from(n);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const getSigner = async () => (await renderHook(() => useSigner(me))).result.current;
const evmTx = { to: "0x00000000000000000000000000000000000000aa", data: "0x1234", value: "0", chainId: 8453 };

describe("useSigner (AppKit React Native adapter)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.appkit = { address: SOL, namespace: "solana", chainId: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" };
    mockState.walletName = "Phantom";
    mockState.evm = { isConnected: true, address: EVM, chainId: 1 };
    mockState.provider.request.mockReset();
    mockState.send.mockReset();
    mockState.receipt.mockReset();
  });

  it("has no Bitcoin signer, so Bitcoin legs are continued on the web", async () => {
    expect((await getSigner()).signPsbt).toBeUndefined();
  });

  it("Solana, deeplink wallet (Phantom): base58 in, base58 out, returned as base64", async () => {
    mockState.provider.request.mockResolvedValue({ transaction: bs58.encode(bytes(9, 8, 7)) });
    const out = await (await getSigner()).signSolana(b64(bytes(1, 2, 3)));
    expect(mockState.provider.request).toHaveBeenCalledWith(
      { method: "solana_signTransaction", params: { transaction: bs58.encode(bytes(1, 2, 3)), pubkey: SOL } }, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(out).toBe(b64(bytes(9, 8, 7)));
  });

  it("Solana, WalletConnect wallet: base64 in and out", async () => {
    mockState.walletName = "Trust Wallet";
    mockState.provider.request.mockResolvedValue({ transaction: b64(bytes(9, 8, 7)) });
    const out = await (await getSigner()).signSolana(b64(bytes(1, 2, 3)));
    expect(mockState.provider.request).toHaveBeenCalledWith(expect.objectContaining({ params: { transaction: b64(bytes(1, 2, 3)), pubkey: SOL } }), expect.any(String));
    expect(out).toBe(b64(bytes(9, 8, 7)));
  });

  it("Solana: refuses when the active wallet is not the linked Solana address; nothing is requested", async () => {
    mockState.appkit = { ...mockState.appkit, namespace: "eip155" };
    await expect((await getSigner()).signSolana("AAAA")).rejects.toBeInstanceOf(WrongWalletError);
    mockState.appkit = { ...mockState.appkit, namespace: "solana", address: "SomeoneElse1111111111111111111111111111111111" };
    await expect((await getSigner()).signSolana("AAAA")).rejects.toBeInstanceOf(WrongWalletError);
    expect(mockState.provider.request).not.toHaveBeenCalled();
  });

  it("Solana: a wallet that returns no signed transaction is an error, and a rejection maps to WalletRejectedError", async () => {
    mockState.provider.request.mockResolvedValue({ signature: "x" });
    await expect((await getSigner()).signSolana("AAAA")).rejects.toThrow("did not return a signed transaction");
    mockState.provider.request.mockRejectedValue(new Error("User rejected the request"));
    await expect((await getSigner()).signSolana("AAAA")).rejects.toBeInstanceOf(WalletRejectedError);
  });

  it("EVM: switches chain, sends the exact-amount approval, waits for it, then sends the transaction", async () => {
    const order: string[] = [];
    mockState.switchChain.mockImplementation(async () => { order.push("switch"); });
    mockState.send.mockImplementation(async (tx: { to: string }) => { order.push(tx.to === evmTx.to ? "main" : "approve"); return tx.to === evmTx.to ? "0xmain" : "0xapprove"; });
    mockState.receipt.mockImplementation(async () => { order.push("receipt"); return { status: "success" }; });
    const hash = await (await getSigner()).sendEvm({ ...evmTx, approval: { token: "0x00000000000000000000000000000000000000bb", spender: "0x00000000000000000000000000000000000000cc", amount: "1000" } });
    expect(hash).toBe("0xmain");
    expect(order).toEqual(["switch", "approve", "receipt", "main"]);
    expect(mockState.send.mock.calls[0]![0].data).toMatch(/^0x095ea7b3/);
  });

  it("EVM: a reverted approval stops before the main transaction", async () => {
    mockState.send.mockResolvedValue("0xapprove");
    mockState.receipt.mockResolvedValue({ status: "reverted" });
    await expect((await getSigner()).sendEvm({ ...evmTx, approval: { token: "0x00000000000000000000000000000000000000bb", spender: "0x00000000000000000000000000000000000000cc", amount: "1" } })).rejects.toThrow("not confirmed");
    expect(mockState.send).toHaveBeenCalledTimes(1);
  });

  it("EVM: refuses a wallet that is not the linked EVM address", async () => {
    mockState.evm = { isConnected: true, address: "0x0000000000000000000000000000000000000dEa", chainId: 1 };
    await expect((await getSigner()).sendEvm({ ...evmTx, approval: null })).rejects.toBeInstanceOf(WrongWalletError);
    expect(mockState.send).not.toHaveBeenCalled();
  });
});
