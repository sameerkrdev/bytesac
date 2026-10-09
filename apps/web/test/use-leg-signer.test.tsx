import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ send: vi.fn(), receipt: vi.fn(), switchChain: vi.fn(), ensure: vi.fn(), account: vi.fn(), provider: vi.fn(), address: vi.fn() }));
vi.mock("@/lib/appkit", () => ({ appKit: { getProvider: (ns: string) => wallet.provider(ns), getAddress: (ns: string) => wallet.address(ns) } }));
vi.mock("@solana/web3.js", () => ({ VersionedTransaction: { deserialize: () => ({ serialize: () => new TextEncoder().encode("signed") }) } }));
vi.mock("wagmi", () => ({
  useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: wallet.switchChain }),
  useSendTransaction: () => ({ sendTransactionAsync: wallet.send }),
}));
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt: wallet.receipt, getAccount: () => wallet.account() }));
vi.mock("@/lib/wallet/use-wallet-for-chain", () => ({ same: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(), useWalletForChain: () => ({ ensure: wallet.ensure, connectionKey: "" }) }));
import { useLegSigner } from "@/lib/wallet/use-leg-signer";

const me = { wallet: { addresses: [
  { chain: "ethereum", status: "active", address: "0xeee0000000000000000000000000000000000001", walletName: "Ledger" },
  { chain: "base", status: "active", address: "0xabc0000000000000000000000000000000000001", walletName: "MetaMask" },
  { chain: "polygon", status: "active", address: "0xddd0000000000000000000000000000000000001", walletName: "Trust Wallet" },
] } } as never;
const tx = { chainId: 8453, to: "0x00000000000000000000000000000000000000aa", data: "0x1234", value: "0" };
const approval = { token: "0x00000000000000000000000000000000000000bb", spender: "0x00000000000000000000000000000000000000cc", amount: "1000000" };

beforeEach(() => {
  vi.clearAllMocks();
  wallet.ensure.mockResolvedValue("ready");
  wallet.account.mockReturnValue({ isConnected: true, address: "0xAbC0000000000000000000000000000000000001", chainId: 8453 });
});

describe("useLegSigner non-EVM signing after ensure() switches wallet", () => {
  const SOL = "SoLaddr1111111111111111111111111111111111111", BTC = "bc1qaddr";
  const meNon = { wallet: { addresses: [{ chain: "solana", status: "active", address: SOL, walletName: "Phantom" }, { chain: "bitcoin", status: "active", address: BTC, walletName: "Xverse" }] } } as never;
  // Before ensure() the active provider/address are a different wallet's; ensure() switches to the linked one. Only the switched provider may sign.
  function switching(ns: string, address: string, stale: unknown, switched: unknown) {
    let done = false;
    wallet.ensure.mockImplementation(async () => { done = true; return "ready"; });
    wallet.provider.mockImplementation((n: string) => (n === ns ? (done ? switched : stale) : undefined));
    wallet.address.mockImplementation((n: string) => (n === ns ? (done ? address : "OtherAddr") : undefined));
  }
  it("Solana: signs with the switched provider on the first attempt", async () => {
    const stale = { signTransaction: vi.fn() }, switched = { signTransaction: vi.fn(async (t: unknown) => t) };
    switching("solana", SOL, stale, switched);
    const { result } = renderHook(() => useLegSigner(meNon));
    await expect(result.current.signSolana("AAEC")).resolves.toBe(btoa("signed"));
    expect(switched.signTransaction).toHaveBeenCalledTimes(1);
    expect(stale.signTransaction).not.toHaveBeenCalled();
    expect(wallet.provider).toHaveBeenCalledWith("solana");
    expect(wallet.address).toHaveBeenCalledWith("solana");
  });
  it("Solana: refuses when the switched wallet is not the linked one", async () => {
    const p = { signTransaction: vi.fn() };
    switching("solana", "OtherAddr", p, p);
    const { result } = renderHook(() => useLegSigner(meNon));
    await expect(result.current.signSolana("AAEC")).rejects.toThrow(/Connect the Solana wallet/);
    expect(p.signTransaction).not.toHaveBeenCalled();
  });
  it("Bitcoin: signs with the switched provider on the first attempt", async () => {
    const stale = { signPSBT: vi.fn() }, switched = { signPSBT: vi.fn(async () => ({ psbt: "signedpsbt" })) };
    switching("bip122", BTC, stale, switched);
    const { result } = renderHook(() => useLegSigner(meNon));
    await expect(result.current.signBitcoin("cHNidA==", 1)).resolves.toBe("signedpsbt");
    expect(switched.signPSBT).toHaveBeenCalledTimes(1);
    expect(stale.signPSBT).not.toHaveBeenCalled();
    expect(wallet.provider).toHaveBeenCalledWith("bip122");
    expect(wallet.address).toHaveBeenCalledWith("bip122");
  });
});

describe("useLegSigner.sendEvm", () => {
  it("selects and checks the wallet linked to the leg's chain (Base here, not Ethereum)", async () => {
    wallet.send.mockResolvedValueOnce("0xmain");
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm(tx, null)).resolves.toBe("0xmain");
    expect(wallet.ensure).toHaveBeenCalledWith("base");
  });

  it("asks to connect the linked wallet when it is missing", async () => {
    wallet.ensure.mockResolvedValue("missing");
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm({ ...tx, chainId: 137 }, null)).rejects.toThrow("Connect Trust Wallet (0xddd0…0001) to sign this Polygon step");
    expect(wallet.send).not.toHaveBeenCalled();
  });

  it("refuses when the active account is not the chain's linked address", async () => {
    wallet.account.mockReturnValue({ isConnected: true, address: "0xeee0000000000000000000000000000000000001", chainId: 8453 });
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm(tx, null)).rejects.toThrow(/Connect the EVM wallet/);
    expect(wallet.send).not.toHaveBeenCalled();
  });

  it("sends the approval, waits for it, then sends the main transaction", async () => {
    wallet.send.mockResolvedValueOnce("0xapprove").mockResolvedValueOnce("0xmain");
    wallet.receipt.mockResolvedValue({ status: "success" });
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm(tx, approval)).resolves.toBe("0xmain");
    expect(wallet.send).toHaveBeenCalledTimes(2);
  });

  // @wagmi/core 2.22.1 waitForTransactionReceipt already throws on a revert; this mock resolves "reverted" to cover the explicit status guard (defense in depth).
  it("sends nothing more when the approval was mined but reverted", async () => {
    wallet.send.mockResolvedValueOnce("0xapprove");
    wallet.receipt.mockResolvedValue({ status: "reverted" });
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm(tx, approval)).rejects.toThrow(/approval was not confirmed/);
    expect(wallet.send).toHaveBeenCalledTimes(1);
  });
});
