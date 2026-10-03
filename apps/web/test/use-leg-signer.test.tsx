import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ send: vi.fn(), receipt: vi.fn(), switchChain: vi.fn() }));
vi.mock("@reown/appkit/react", () => ({ useAppKitAccount: () => ({ isConnected: false }), useAppKitProvider: () => ({ walletProvider: undefined }) }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true, address: "0xAbC0000000000000000000000000000000000001", chainId: 8453 }),
  useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: wallet.switchChain }),
  useSendTransaction: () => ({ sendTransactionAsync: wallet.send }),
}));
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt: wallet.receipt }));
import { useLegSigner } from "@/lib/wallet/use-leg-signer";

const me = { wallet: { addresses: [{ chain: "ethereum", status: "active", address: "0xabc0000000000000000000000000000000000001" }] } } as never;
const tx = { chainId: 8453, to: "0x00000000000000000000000000000000000000aa", data: "0x1234", value: "0" };
const approval = { token: "0x00000000000000000000000000000000000000bb", spender: "0x00000000000000000000000000000000000000cc", amount: "1000000" };

beforeEach(() => vi.clearAllMocks());

describe("useLegSigner.sendEvm", () => {
  it("sends the approval, waits for it, then sends the main transaction", async () => {
    wallet.send.mockResolvedValueOnce("0xapprove").mockResolvedValueOnce("0xmain");
    wallet.receipt.mockResolvedValue({ status: "success" });
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm(tx, approval)).resolves.toBe("0xmain");
    expect(wallet.send).toHaveBeenCalledTimes(2);
  });

  // viem's waitForTransactionReceipt resolves (does not throw) for a mined, reverted transaction (receipt.status "reverted").
  it("sends nothing more when the approval was mined but reverted", async () => {
    wallet.send.mockResolvedValueOnce("0xapprove");
    wallet.receipt.mockResolvedValue({ status: "reverted" });
    const { result } = renderHook(() => useLegSigner(me));
    await expect(result.current.sendEvm(tx, approval)).rejects.toThrow(/approval was not confirmed/);
    expect(wallet.send).toHaveBeenCalledTimes(1);
  });
});
