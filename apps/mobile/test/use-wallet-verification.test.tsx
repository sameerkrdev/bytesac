import { ApiError } from "@repo/api-client";
import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { api } from "@/lib/api";
import { SIGN_FOREGROUND_TIMEOUT_MS, useWalletVerification } from "@/lib/auth/use-wallet-verification";

const mockSignMessage = jest.fn();
jest.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ signMessage: mockSignMessage }) }));
const mockAcceptToken = jest.fn(async () => undefined);
jest.mock("@/lib/auth-context", () => ({ useAuth: () => ({ acceptToken: mockAcceptToken }) }));
jest.mock("@/lib/api", () => ({ api: { createChallenge: jest.fn(), verify: jest.fn(), reassignChain: jest.fn() } }));

const account = { chain: "ethereum" as const, address: "0xabc", walletName: "MetaMask" };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.createChallenge as jest.Mock).mockResolvedValue({ challengeId: "c1", message: "m" });
  (api.verify as jest.Mock).mockResolvedValue({ token: "tok", isNewUser: false });
});
afterEach(() => jest.useRealTimers());

describe("useWalletVerification", () => {
  it("ignores a stale sign result after reset", async () => {
    const d = deferred<string>();
    mockSignMessage.mockReturnValueOnce(d.promise);
    const { result } = await renderHook(() => useWalletVerification("sign_in"));
    await act(async () => { void result.current.run(account); });
    expect(result.current.state.step).toBe("signing");
    await act(async () => { result.current.reset(); });
    expect(result.current.state.step).toBe("idle");
    await act(async () => { d.resolve("sig"); await d.promise; });
    expect(result.current.state.step).toBe("idle");
    expect(api.verify).not.toHaveBeenCalled();
    expect(mockAcceptToken).not.toHaveBeenCalled();
  });

  it("ignores a stale rejection after reset", async () => {
    let rej!: (e: Error) => void;
    mockSignMessage.mockReturnValueOnce(new Promise((_, r) => { rej = r; }));
    const { result } = await renderHook(() => useWalletVerification("sign_in"));
    await act(async () => { void result.current.run(account); });
    await act(async () => { result.current.reset(); });
    await act(async () => { rej(new Error("late")); await Promise.resolve(); });
    expect(result.current.state.step).toBe("idle");
  });

  it("Sign works again after reset of a hung request", async () => {
    mockSignMessage.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = await renderHook(() => useWalletVerification("sign_in"));
    await act(async () => { void result.current.run(account); });
    expect(result.current.state.step).toBe("signing");
    await act(async () => { result.current.reset(); });
    expect(result.current.state.step).toBe("idle");
    mockSignMessage.mockResolvedValueOnce("sig");
    await act(async () => { await result.current.run(account); });
    expect(result.current.state.step).toBe("done");
    expect(mockAcceptToken).toHaveBeenCalledWith("tok");
  });

  it("fails with WALLET_REJECTED 120 s after returning to the foreground while signing", async () => {
    jest.useFakeTimers();
    let handler: ((s: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove: jest.fn() };
    }) as never);
    mockSignMessage.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = await renderHook(() => useWalletVerification("sign_in"));
    await act(async () => { void result.current.run(account); });
    await act(async () => { handler?.("background"); handler?.("active"); });
    await act(async () => { jest.advanceTimersByTime(SIGN_FOREGROUND_TIMEOUT_MS - 1); });
    expect(result.current.state.step).toBe("signing");
    await act(async () => { jest.advanceTimersByTime(2); });
    expect(result.current.state).toMatchObject({ step: "error", code: "WALLET_REJECTED" });
    mockSignMessage.mockResolvedValueOnce("sig");
    await act(async () => { await result.current.run(account); });
    expect(result.current.state.step).toBe("done");
  });

  it("sends the picked chains with the challenge", async () => {
    mockSignMessage.mockResolvedValueOnce("sig");
    const { result } = await renderHook(() => useWalletVerification("add_chain_account"));
    await act(async () => { await result.current.run(account, ["base", "ethereum"]); });
    expect(api.createChallenge).toHaveBeenCalledWith({ purpose: "add_chain_account", chain: "ethereum", address: "0xabc", chains: ["base", "ethereum"] });
  });

  describe("reassign_chain (two signatures over one challenge)", () => {
    const next = { chain: "ethereum" as const, address: "0xnew", walletName: "Rabby" };
    const old = { chain: "ethereum" as const, address: "0xOLD", walletName: "MetaMask" };
    const previous = { address: "0xold", walletName: "MetaMask" };

    it("holds the new wallet's signature, asks for the old wallet, then posts both", async () => {
      (api.reassignChain as jest.Mock).mockResolvedValue({ token: "tok2", isNewUser: false });
      mockSignMessage.mockResolvedValueOnce("sigNew").mockResolvedValueOnce("sigOld");
      const { result } = await renderHook(() => useWalletVerification("reassign_chain"));
      await act(async () => { await result.current.run(next, ["base"], previous); });
      expect(api.createChallenge).toHaveBeenCalledWith({ purpose: "reassign_chain", chain: "base", address: "0xnew", chains: ["base"] });
      expect(result.current.awaitingPrevious).toBe(true);
      expect(result.current.notice?.text).toBe("Now approve in MetaMask (0xold…xold) to confirm the move.");
      expect(api.reassignChain).not.toHaveBeenCalled();
      await act(async () => { await result.current.run(next, ["base"], previous); });
      expect(result.current.notice?.kind).toBe("error"); // still the new wallet: refused, nothing signed
      expect(mockSignMessage).toHaveBeenCalledTimes(1);
      await act(async () => { await result.current.run(old, ["base"], previous); });
      expect(mockSignMessage).toHaveBeenLastCalledWith("m");
      expect(api.reassignChain).toHaveBeenCalledWith({ challengeId: "c1", signature: "sigNew", previousSignature: "sigOld", client: "mobile", walletProvider: "Rabby", signableChains: undefined });
      expect(mockAcceptToken).toHaveBeenCalledWith("tok2");
      expect(result.current.state.step).toBe("done");
      expect(result.current.awaitingPrevious).toBe(false);
    });

    it("an expired challenge drops the held signature and fails for a clean restart", async () => {
      (api.reassignChain as jest.Mock).mockRejectedValue(new ApiError("CHALLENGE_EXPIRED", 410, "expired"));
      mockSignMessage.mockResolvedValue("sig");
      const { result } = await renderHook(() => useWalletVerification("reassign_chain"));
      await act(async () => { await result.current.run(next, ["base"], previous); });
      await act(async () => { await result.current.run(old, ["base"], previous); });
      expect(result.current.state).toMatchObject({ step: "error", code: "CHALLENGE_EXPIRED" });
      expect(result.current.awaitingPrevious).toBe(false);
    });

    it("CHAIN_NOT_EMPTY lists what is still held", async () => {
      (api.createChallenge as jest.Mock).mockRejectedValue(new ApiError("CHAIN_NOT_EMPTY", 409, "held", undefined, { assets: ["USDC", "WETH"] }));
      const { result } = await renderHook(() => useWalletVerification("reassign_chain"));
      await act(async () => { await result.current.run(next, ["base"], previous); });
      expect(result.current.notice?.text).toBe("You still hold: USDC, WETH.");
    });
  });
});
