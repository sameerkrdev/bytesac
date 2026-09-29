import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { api } from "@/lib/api";
import { SIGN_FOREGROUND_TIMEOUT_MS, useWalletVerification } from "@/lib/auth/use-wallet-verification";

const mockSignMessage = jest.fn();
jest.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ signMessage: mockSignMessage }) }));
const mockAcceptToken = jest.fn(async () => undefined);
jest.mock("@/lib/auth-context", () => ({ useAuth: () => ({ acceptToken: mockAcceptToken }) }));
jest.mock("@/lib/api", () => ({ api: { createChallenge: jest.fn(), verify: jest.fn() } }));

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

  it("Sign works again after cancel of a hung request", async () => {
    mockSignMessage.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = await renderHook(() => useWalletVerification("sign_in"));
    await act(async () => { void result.current.run(account); });
    expect(result.current.state.step).toBe("signing");
    await act(async () => { result.current.cancel(); });
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
});
