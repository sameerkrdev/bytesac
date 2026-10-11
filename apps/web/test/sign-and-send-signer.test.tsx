import { WalletRejectedError, WrongWalletError } from "@repo/app-core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { me } from "./invest-fixtures";

const state = vi.hoisted(() => ({ walletName: "MetaMask" as string | undefined, wallets: [] as unknown[], ready: "ready" as "ready" | "other" }));
vi.mock("@reown/appkit/react", () => ({ useWalletInfo: () => ({ walletInfo: state.walletName ? { name: state.walletName } : undefined }) }));
vi.mock("wagmi", () => ({ useConfig: () => ({}), useSwitchChain: () => ({ switchChainAsync: vi.fn() }), useSendTransaction: () => ({ sendTransactionAsync: vi.fn() }) }));
vi.mock("wagmi/actions", () => ({ getAccount: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("@/lib/appkit", () => ({ appKit: { getProvider: () => ({}), getAddress: () => ADDRESS } }));
vi.mock("@/lib/wallet/use-wallet-for-chain", () => ({ same: (a: string, b: string) => a === b, useWalletForChain: () => ({ ensure: async () => state.ready, connectionKey: "k" }) }));
vi.mock("@/lib/wallet/standard-wallets", () => ({ standardWallets: async () => state.wallets }));
import { SIGN_AND_SEND_WALLETS, useLegSigner } from "@/lib/wallet/use-leg-signer";

const ADDRESS = "So11111111111111111111111111111111111111112";
const user = () => ({ ...me(), wallet: { ...me().wallet, addresses: [{ chain: "solana", status: "active", address: ADDRESS, walletName: "MetaMask" }] } }) as unknown as ReturnType<typeof me>;
const wallet = (name: string, features: Record<string, unknown>, accounts = [{ address: ADDRESS }]) => ({ name, features, accounts });
const sendFeature = (signAndSendTransaction: unknown) => ({ "solana:signAndSendTransaction": { signAndSendTransaction } });
const hook = () => renderHook(() => useLegSigner(user())).result.current;

beforeEach(() => { state.walletName = "MetaMask"; state.wallets = []; state.ready = "ready"; });

describe("tier choice", () => {
  it("MetaMask with the Wallet Standard feature signs and sends", async () => {
    expect(SIGN_AND_SEND_WALLETS).toEqual(["MetaMask"]);
    state.wallets = [wallet("MetaMask", sendFeature(vi.fn()))];
    expect(await hook().chooseTier()).toBe("sign_and_send");
  });
  it("MetaMask without the feature, another wallet with it, and no wallet name all keep sign_all", async () => {
    state.wallets = [wallet("MetaMask", {})];
    expect(await hook().chooseTier()).toBe("sign_all");
    state.walletName = "Phantom";
    state.wallets = [wallet("Phantom", sendFeature(vi.fn()))];
    expect(await hook().chooseTier()).toBe("sign_all");
    state.walletName = undefined;
    expect(await hook().chooseTier()).toBe("sign_all");
  });
});

describe("signAndSendSolanaAll", () => {
  it("sends the decoded transactions with the linked account and returns the raw signatures in order", async () => {
    const signAndSendTransaction = vi.fn(async (...inputs: unknown[]) => inputs.map((_, i) => ({ signature: new Uint8Array(64).fill(i + 1) })));
    const account = { address: ADDRESS };
    state.wallets = [wallet("MetaMask", sendFeature(signAndSendTransaction), [{ address: "other" }, account])];
    const out = await hook().signAndSendSolanaAll([btoa("ab"), btoa("cd")]);
    expect(signAndSendTransaction).toHaveBeenCalledWith({ account, chain: "solana:mainnet", transaction: Uint8Array.from([97, 98]) }, { account, chain: "solana:mainnet", transaction: Uint8Array.from([99, 100]) });
    expect(out).toEqual([new Uint8Array(64).fill(1), new Uint8Array(64).fill(2)]);
  });
  it("is a wrong-wallet error when the wallet lacks the linked account or the feature", async () => {
    state.wallets = [wallet("MetaMask", sendFeature(vi.fn()), [{ address: "other" }])];
    await expect(hook().signAndSendSolanaAll([btoa("ab")])).rejects.toBeInstanceOf(WrongWalletError);
    state.wallets = [wallet("MetaMask", {})];
    await expect(hook().signAndSendSolanaAll([btoa("ab")])).rejects.toBeInstanceOf(WrongWalletError);
  });
  it("turns a user rejection into WalletRejectedError and keeps any other error as it is", async () => {
    state.wallets = [wallet("MetaMask", sendFeature(vi.fn().mockRejectedValueOnce({ code: 4001 }).mockRejectedValueOnce(new Error("boom"))))];
    await expect(hook().signAndSendSolanaAll([btoa("ab")])).rejects.toBeInstanceOf(WalletRejectedError);
    await expect(hook().signAndSendSolanaAll([btoa("ab")])).rejects.toThrow("boom");
  });
});
