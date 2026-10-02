import { ApiError } from "@repo/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDisplayError } from "@/lib/errors";
import { buyLeg, feeLeg, ID, operation, renderApp } from "./invest-fixtures";

const api = { getOperation: vi.fn(), quoteLeg: vi.fn(), submitLeg: vi.fn(), cancelOperation: vi.fn() };
vi.mock("@/lib/api", () => ({ api: { getOperation: (id: string) => api.getOperation(id), quoteLeg: (o: string, l: string) => api.quoteLeg(o, l), submitLeg: (o: string, l: string, b: unknown) => api.submitLeg(o, l, b), cancelOperation: (id: string) => api.cancelOperation(id) } }));
const signer = { signSolana: vi.fn(), sendEvm: vi.fn(), signBitcoin: vi.fn() };
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => signer }));
import { LegProgress } from "@/components/invest/leg-progress";

const failed = buyLeg({ status: "FAILED", failureReason: "DESTINATION_SWAP_FAILED", recoveryToken: { chain: "ethereum", address: "0xabc", decimals: 6, symbol: "USDC", amount: "299000000" } });
const recovery = buyLeg({ id: ID(13), sequence: 3, status: "PLANNED", fromChain: "ethereum", toChain: "ethereum", kind: "swap", amountIn: "299000000", recoveryOf: failed.id, minOut: null, routeSummary: { fromToken: "0xabc", symbol: "USDC", decimals: 6 } });
const show = () => renderApp(<LegProgress operationId={ID(20)} />);
beforeEach(() => vi.clearAllMocks());

describe("refund and recovery states", () => {
  it("says a refund is in progress", async () => {
    api.getOperation.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), buyLeg({ status: "SUBMITTED", providerSubstatus: "NOT_PROCESSABLE_REFUND_NEEDED" })] }));
    show();
    expect(await screen.findByText(/Refund in progress/)).toBeInTheDocument();
  });
  it("says the funds were returned on a refunded failed leg", async () => {
    api.getOperation.mockResolvedValue(operation({ status: "FAILED", legs: [feeLeg({ status: "SETTLED" }), buyLeg({ status: "FAILED", providerSubstatus: "REFUNDED", failureReason: "Refunded" })] }));
    show();
    expect(await screen.findByText("Funds returned to your wallet.")).toBeInTheDocument();
  });
  it("shows what arrived, hides the raw reason, and signs the recovery leg through the signer", async () => {
    api.getOperation.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), failed, recovery] }));
    api.quoteLeg.mockResolvedValue({ legId: recovery.id, estimatedOut: "1", minOut: "1", quoteExpiresAt: "2026-10-01T12:01:00.000Z", transaction: { kind: "solana", serializedBase64: "AAEC" }, approval: null, gasDrop: null });
    signer.signSolana.mockResolvedValue("c2lnbmVk");
    api.submitLeg.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), failed, { ...recovery, status: "SUBMITTED" }] }));
    show();
    expect(await screen.findByText(/Arrived as 299 USDC on Ethereum/)).toBeInTheDocument();
    expect(screen.queryByText("DESTINATION_SWAP_FAILED")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop here" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Complete swap" }));
    await userEvent.click(await screen.findByRole("button", { name: "Approve step 3 in your wallet" }));
    await waitFor(() => expect(api.submitLeg).toHaveBeenCalledWith(ID(20), recovery.id, { signedTx: "c2lnbmVk" }));
  });
});

describe("SOL_REQUIRED copy", () => {
  it("tells the user to add SOL", () => {
    expect(toDisplayError(new ApiError("SOL_REQUIRED", 409, "x")).message).toBe("Add a small amount of SOL (~0.003) to your Solana wallet to continue.");
  });
});
