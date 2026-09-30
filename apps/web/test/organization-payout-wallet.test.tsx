import { WalletRejectedError } from "@repo/app-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutWallet } from "@/components/organization/payout-wallet";
import { orgDetail, wallet } from "./org-fixtures";

const signMessage = vi.fn();
const connect = vi.fn();
let account: { chain: string; address: string; walletName: string | null } | null = null;
vi.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ account, signMessage, connect }) }));

const CH = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e80";
const client = () => ({
  enterPayoutWallet: vi.fn().mockResolvedValue(orgDetail({ payoutWallets: [wallet()] })),
  createPayoutChallenge: vi.fn().mockResolvedValue({ challengeId: CH, message: "Verify payout wallet...", expiresAt: "2026-09-29T00:05:00.000Z" }),
  verifyPayoutWallet: vi.fn().mockResolvedValue(orgDetail({ payoutWallets: [wallet({ status: "VERIFIED" })] })),
});

beforeEach(() => { account = null; signMessage.mockReset(); connect.mockReset(); });

describe("PayoutWallet", () => {
  it("enters the address, then signs the challenge and verifies", async () => {
    const c = client();
    const onChange = vi.fn();
    signMessage.mockResolvedValue("sig58");
    const { rerender } = render(<PayoutWallet org={orgDetail()} onChange={onChange} client={c} />);
    await userEvent.type(screen.getByLabelText("Solana wallet address"), wallet().address);
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));
    expect(c.enterPayoutWallet).toHaveBeenCalledWith(orgDetail().id, { address: wallet().address });

    account = { chain: "solana", address: wallet().address, walletName: "Phantom" };
    rerender(<PayoutWallet org={orgDetail({ payoutWallets: [wallet()] })} onChange={onChange} client={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    await waitFor(() => expect(c.verifyPayoutWallet).toHaveBeenCalledWith(orgDetail().id, { challengeId: CH, signature: "sig58" }));
    expect(signMessage).toHaveBeenCalledWith("Verify payout wallet...");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ payoutWallets: [expect.objectContaining({ status: "VERIFIED" })] }));
  });

  it("asks to connect when the connected wallet is not the entered address", async () => {
    const c = client();
    account = { chain: "solana", address: "OtherAddress", walletName: null };
    render(<PayoutWallet org={orgDetail({ payoutWallets: [wallet()] })} onChange={vi.fn()} client={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect & sign" }));
    expect(connect).toHaveBeenCalled();
    expect(c.createPayoutChallenge).not.toHaveBeenCalled();
  });

  it("shows cancellation copy and verifies nothing when the wallet rejects", async () => {
    const c = client();
    account = { chain: "solana", address: wallet().address, walletName: null };
    signMessage.mockRejectedValue(new WalletRejectedError());
    render(<PayoutWallet org={orgDetail({ payoutWallets: [wallet({ status: "VERIFYING" })] })} onChange={vi.fn()} client={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Signature cancelled");
    expect(c.verifyPayoutWallet).not.toHaveBeenCalled();
  });

  it("shows the pending-replacement notice and history, and hides the entry form", () => {
    const wallets = [wallet({ status: "VERIFIED", activatedAt: "2026-09-29T00:00:00.000Z" }), wallet({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e64", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", status: "REPLACEMENT_PENDING" })];
    render(<PayoutWallet org={orgDetail({ status: "VERIFIED", payoutWallets: wallets })} onChange={vi.fn()} client={client()} />);
    expect(screen.getByRole("status")).toHaveTextContent("awaiting review");
    expect(screen.queryByLabelText("Solana wallet address")).toBeNull();
    expect(screen.getByRole("list", { name: "Payout wallet history" }).children).toHaveLength(2);
  });

  it("locks wallet changes while the organization is under review", () => {
    render(<PayoutWallet org={orgDetail({ status: "UNDER_REVIEW", payoutWallets: [wallet({ status: "VERIFIED" })] })} onChange={vi.fn()} client={client()} />);
    expect(screen.queryByRole("button", { name: "Change payout wallet" })).toBeNull();
    expect(screen.queryByLabelText("Solana wallet address")).toBeNull();
  });
});
