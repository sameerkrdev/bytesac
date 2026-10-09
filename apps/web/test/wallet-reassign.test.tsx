import { ApiError } from "@repo/api-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NEW = "0xBBB0000000000000000000000000000000000002";
const OLD = "0xAAA0000000000000000000000000000000000001";
const h = vi.hoisted(() => ({
  account: null as null | { chain: "base"; address: string; walletName: string | null; signableChains?: string[] },
  signMessage: vi.fn(),
  api: { createChallenge: vi.fn(), verify: vi.fn(), reassignChain: vi.fn() },
}));
vi.mock("@/lib/api", () => ({ api: h.api }));
vi.mock("@/lib/wallet/use-wallet-connector", () => ({
  useWalletConnector: () => ({ account: h.account, network: h.account ? "supported" : "none", signMessage: h.signMessage, connect: vi.fn(), disconnect: vi.fn(), switchToSupported: vi.fn(), chooseNetwork: vi.fn() }),
}));
import { WalletVerification } from "@/components/auth/wallet-verification";

const reassign = { chain: "base" as const, previous: { address: OLD, walletName: "MetaMask" } };
const view = () => <WalletVerification purpose="reassign_chain" reassign={reassign} onVerified={vi.fn()} />;
const connect = (address: string, walletName: string) => { h.account = { chain: "base", address, walletName }; };

describe("reassign needs both wallets to sign the same challenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.api.createChallenge.mockResolvedValue({ challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", message: "MSG", expiresAt: "x" });
    h.signMessage.mockResolvedValueOnce("sigNew").mockResolvedValueOnce("sigOld");
    h.api.reassignChain.mockResolvedValue({ isNewUser: false });
  });

  it("signs with the new wallet, asks for the current one, then posts both signatures", async () => {
    connect(NEW, "Phantom");
    const { rerender } = render(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByText("Now approve in MetaMask (0xAAA0…0001) to confirm the move.")).toBeInTheDocument();
    expect(h.api.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ purpose: "reassign_chain", chain: "base", address: NEW, chains: ["base"] }));
    expect(h.api.reassignChain).not.toHaveBeenCalled();
    connect(OLD, "MetaMask");
    rerender(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await waitFor(() => expect(h.api.reassignChain).toHaveBeenCalledWith(expect.objectContaining({ challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", signature: "sigNew", previousSignature: "sigOld", client: "web", walletProvider: "Phantom" })));
  });

  it("refuses the wrong wallet for each signature", async () => {
    connect(OLD, "MetaMask");
    render(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByText("Connect the wallet you want to move this chain to.")).toBeInTheDocument();
    expect(h.signMessage).not.toHaveBeenCalled();
  });

  it("refuses the wrong wallet for the second signature", async () => {
    connect(NEW, "Phantom");
    const { rerender } = render(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await screen.findByText(/Now approve in/);
    connect("0xCCC0000000000000000000000000000000000003", "Other");
    rerender(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByText("Connect MetaMask (0xAAA0…0001) to approve the move.")).toBeInTheDocument();
    expect(h.signMessage).toHaveBeenCalledTimes(1);
    expect(h.api.reassignChain).not.toHaveBeenCalled();
  });

  it("restarts cleanly when the challenge expires and says to connect the new wallet", async () => {
    connect(NEW, "Phantom");
    const { rerender } = render(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await screen.findByText(/Now approve in/);
    h.api.reassignChain.mockRejectedValue(new ApiError("CHALLENGE_EXPIRED", 410, "x"));
    connect(OLD, "MetaMask");
    rerender(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start again" }));
    expect(await screen.findByText("Start again: connect the wallet you want to move Base to, then sign.")).toBeInTheDocument();
    expect(h.api.createChallenge).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByText("Connect the wallet you want to move this chain to.")).toBeInTheDocument();
  });

  it("shows what is still held when the chain is not empty", async () => {
    connect(NEW, "Phantom");
    const { rerender } = render(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await screen.findByText(/Now approve in/);
    h.api.reassignChain.mockRejectedValue(new ApiError("CHAIN_NOT_EMPTY", 409, "x", undefined, { assets: ["USDC"] }));
    connect(OLD, "MetaMask");
    rerender(view());
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByText(/Sell what you hold on this chain first/)).toBeInTheDocument();
    expect(screen.getByText("You still hold: USDC.")).toBeInTheDocument();
  });
});

describe("link with chain checkboxes", () => {
  it("sends only the ticked chains and needs at least one", async () => {
    vi.clearAllMocks();
    h.api.createChallenge.mockResolvedValue({ challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", message: "MSG", expiresAt: "x" });
    h.signMessage.mockResolvedValue("sig");
    h.api.verify.mockResolvedValue({ isNewUser: true });
    h.account = { chain: "base", address: NEW, walletName: "Phantom", signableChains: ["base", "arbitrum"] };
    render(<WalletVerification purpose="sign_in" onVerified={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /^Ethereum/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Base/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^Arbitrum/ }));
    expect(screen.getByRole("button", { name: "Sign message" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Base/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^Arbitrum/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await waitFor(() => expect(h.api.verify).toHaveBeenCalledWith(expect.objectContaining({ signableChains: ["base", "arbitrum"] })));
    expect(h.api.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ chains: ["base", "arbitrum"] }));
  });
});

