import type { MeResponse } from "@repo/validator";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { me as baseMe, renderApp } from "./invest-fixtures";

const ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const api = { createBitcoinChallenge: vi.fn(), verifyBitcoin: vi.fn() };
vi.mock("@/lib/api", () => ({ api: { createBitcoinChallenge: (b: unknown) => api.createBitcoinChallenge(b), verifyBitcoin: (b: unknown) => api.verifyBitcoin(b) } }));
const open = vi.fn();
const provider = { signPSBT: vi.fn(), signMessage: vi.fn() };
let account: { isConnected: boolean; address?: string } = { isConnected: false };
vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open }),
  useAppKitAccount: () => account,
  useAppKitProvider: () => ({ walletProvider: provider }),
}));
import { BitcoinLink } from "@/components/profile/bitcoin-link";

const challenge = { challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e99", message: "Bytesac: link your Bitcoin account", expiresAt: "2026-10-01T12:05:00.000Z", toSignPsbt: "cHNidP8BAA==" };
const connected = () => { account = { isConnected: true, address: ADDRESS }; };
const show = (m: MeResponse = baseMe()) => renderApp(<BitcoinLink me={m} />);

beforeEach(() => { vi.clearAllMocks(); account = { isConnected: false }; });

describe("BitcoinLink", () => {
  it("asks to connect a Bitcoin wallet first", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Connect a Bitcoin wallet" }));
    expect(open).toHaveBeenCalledWith({ view: "Connect", namespace: "bip122" });
  });

  it("links with BIP-322: the wallet only signs the server-built PSBT, which is posted back", async () => {
    connected();
    api.createBitcoinChallenge.mockResolvedValue(challenge);
    provider.signPSBT.mockResolvedValue({ psbt: "c2lnbmVkLXBzYnQ=" });
    api.verifyBitcoin.mockResolvedValue({});
    show();
    await userEvent.click(screen.getByRole("button", { name: "Link this Bitcoin wallet" }));
    expect(api.createBitcoinChallenge).toHaveBeenCalledWith({ address: ADDRESS });
    expect(provider.signPSBT).toHaveBeenCalledWith({ psbt: challenge.toSignPsbt, signInputs: [{ address: ADDRESS, index: 0, sighashTypes: [1] }], broadcast: false });
    await vi.waitFor(() => expect(api.verifyBitcoin).toHaveBeenCalledWith({ challengeId: challenge.challengeId, address: ADDRESS, signature: "c2lnbmVkLXBzYnQ=", method: "bip322" }));
    expect(provider.signMessage).not.toHaveBeenCalled();
  });

  it("falls back to a BIP-137 message signature (hex is converted to base64) when the wallet cannot sign the PSBT", async () => {
    connected();
    api.createBitcoinChallenge.mockResolvedValue(challenge);
    provider.signPSBT.mockRejectedValue(new Error("method not supported"));
    provider.signMessage.mockResolvedValue("1f" + "ab".repeat(64));
    api.verifyBitcoin.mockResolvedValue({});
    show();
    await userEvent.click(screen.getByRole("button", { name: "Link this Bitcoin wallet" }));
    await vi.waitFor(() => expect(api.verifyBitcoin).toHaveBeenCalled());
    expect(provider.signMessage).toHaveBeenCalledWith({ message: challenge.message, address: ADDRESS, protocol: "ecdsa" });
    const sent = api.verifyBitcoin.mock.calls[0]![0] as { signature: string; method: string };
    expect(sent.method).toBe("bip137");
    expect(Uint8Array.from(atob(sent.signature), (c) => c.charCodeAt(0))).toHaveLength(65);
  });

  it("a cancelled wallet request is reported and never falls back or verifies", async () => {
    connected();
    api.createBitcoinChallenge.mockResolvedValue(challenge);
    provider.signPSBT.mockRejectedValue(Object.assign(new Error("User rejected the request"), { code: 4001 }));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Link this Bitcoin wallet" }));
    expect(await screen.findByText("Signature cancelled")).toBeInTheDocument();
    expect(provider.signMessage).not.toHaveBeenCalled();
    expect(api.verifyBitcoin).not.toHaveBeenCalled();
  });

  it("a server refusal is shown", async () => {
    const { ApiError } = await import("@repo/api-client");
    connected();
    api.createBitcoinChallenge.mockResolvedValue(challenge);
    provider.signPSBT.mockResolvedValue({ psbt: "x" });
    api.verifyBitcoin.mockRejectedValue(new ApiError("ADDRESS_ALREADY_LINKED", 409, "linked"));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Link this Bitcoin wallet" }));
    expect(await screen.findByText("Address already linked")).toBeInTheDocument();
  });

  it("shows the linked address instead of the connect controls", () => {
    const m = baseMe();
    m.wallet.addresses.push({ chain: "bitcoin", chainFamily: "bitcoin", address: ADDRESS, status: "active", verificationMethod: "bip322", verifiedAt: "2026-10-01T00:00:00.000Z" });
    show(m);
    expect(screen.getByText(/Linked/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
