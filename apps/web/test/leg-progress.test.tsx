import { ApiError } from "@repo/api-client";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buyLeg, feeLeg, ID, operation, renderApp, sellLeg } from "./invest-fixtures";

const api = { getOperation: vi.fn(), quoteLeg: vi.fn(), submitLeg: vi.fn(), cancelOperation: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: {
    getOperation: (id: string) => api.getOperation(id), quoteLeg: (o: string, l: string) => api.quoteLeg(o, l),
    submitLeg: (o: string, l: string, b: unknown) => api.submitLeg(o, l, b), cancelOperation: (id: string) => api.cancelOperation(id),
  },
}));
const signer = { signSolana: vi.fn(), sendEvm: vi.fn(), signBitcoin: vi.fn(), connectionKey: "a" };
let rerender = () => {};
vi.mock("@/lib/wallet/use-leg-signer", async () => {
  const { useState } = await import("react");
  return { useLegSigner: () => { const [, n] = useState(0); rerender = () => n((x) => x + 1); return signer; } };
});
const reown = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: reown.open }) }));
import { WalletRejectedError, WrongWalletError } from "@repo/app-core";
import { LegProgress } from "@/components/invest/leg-progress";

const solanaQuote = { legId: ID(10), estimatedOut: null, minOut: null, quoteExpiresAt: "2026-10-01T12:01:00.000Z", transaction: { kind: "solana" as const, serializedBase64: "AAEC" }, approval: null, gasDrop: null };
const show = () => renderApp(<LegProgress operationId={ID(20)} />);
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

beforeEach(() => { vi.clearAllMocks(); signer.connectionKey = "a"; vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => vi.useRealTimers());

describe("LegProgress", () => {
  it("quotes, signs in the wallet, submits the signed transaction, then waits for the chain", async () => {
    api.getOperation.mockResolvedValue(operation());
    api.quoteLeg.mockResolvedValue(solanaQuote);
    signer.signSolana.mockResolvedValue("c2lnbmVk");
    api.submitLeg.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SUBMITTED", sourceTx: "5xTx" }), buyLeg()] }));
    show();
    await user().click(await screen.findByRole("button", { name: "Review step 1" }));
    expect(await screen.findByText("Fresh quote for step 1")).toBeInTheDocument();
    expect(signer.signSolana).not.toHaveBeenCalled(); // the wallet only opens after the user has seen the fresh figures
    await user().click(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    await waitFor(() => expect(api.submitLeg).toHaveBeenCalledWith(ID(20), ID(10), { signedTx: "c2lnbmVk" }));
    expect(signer.signSolana).toHaveBeenCalledWith("AAEC");
    expect(await screen.findByText(/Waiting for the network to confirm/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Source transaction/ })).toHaveAttribute("href", "https://solscan.io/tx/5xTx");
    expect(screen.queryByRole("button", { name: /Review step|Approve step/ })).toBeNull();
  });

  it("shows the fresh estimate and minimum before the wallet opens", async () => {
    const swap = buyLeg({ routeSummary: { symbol: "SOL", decimals: 9, estimatedOut: "1000000000" }, minOut: "990000000" });
    api.getOperation.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), swap] }));
    api.quoteLeg.mockResolvedValue({ ...solanaQuote, legId: swap.id, estimatedOut: "1020000000", minOut: "1009800000" });
    show();
    await user().click(await screen.findByRole("button", { name: "Review step 2" }));
    expect(await screen.findByText(/about 1.02 SOL \(at least 1.0098 SOL\)/)).toBeInTheDocument();
    expect(signer.signSolana).not.toHaveBeenCalled();
  });

  it("a price move refused by the server says so and nothing is signed", async () => {
    api.getOperation.mockResolvedValue(operation());
    api.quoteLeg.mockRejectedValue(new ApiError("PRICE_MOVED", 409, "moved"));
    show();
    await user().click(await screen.findByRole("button", { name: "Review step 1" }));
    expect(await screen.findByText("The price moved")).toBeInTheDocument();
    expect(signer.signSolana).not.toHaveBeenCalled();
  });

  it("an expired quote says so and offers a new quote, which signs again", async () => {
    api.getOperation.mockResolvedValue(operation());
    api.quoteLeg.mockResolvedValue(solanaQuote);
    signer.signSolana.mockResolvedValue("c2lnbmVk");
    api.submitLeg.mockRejectedValueOnce(new ApiError("QUOTE_EXPIRED", 409, "expired")).mockResolvedValueOnce(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SUBMITTED" }), buyLeg()] }));
    show();
    await user().click(await screen.findByRole("button", { name: "Review step 1" }));
    await user().click(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    expect(await screen.findByText("Quote expired")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Get a new quote" }));
    await waitFor(() => expect(api.quoteLeg).toHaveBeenCalledTimes(2));
    await user().click(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    await waitFor(() => expect(api.submitLeg).toHaveBeenCalledTimes(2));
  });

  it("an EVM leg waits for the gas top-up before the wallet is asked to sign", async () => {
    const evmQuote = { ...solanaQuote, legId: ID(12), transaction: { kind: "evm" as const, to: "0xabc", data: "0x01", value: "0", chainId: 1 }, approval: { token: "0xtoken", spender: "0xspender", amount: "30000000000000000" } };
    api.getOperation.mockResolvedValue(operation({ kind: "sell_to_usdc", legs: [sellLeg(), feeLeg({ id: ID(13), sequence: 2 })] }));
    api.quoteLeg.mockResolvedValueOnce({ ...evmQuote, transaction: null, approval: null, gasDrop: { status: "pending", txHash: null } }).mockResolvedValueOnce(evmQuote);
    signer.sendEvm.mockResolvedValue("0xhash");
    api.submitLeg.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [sellLeg({ status: "SUBMITTED" }), feeLeg({ id: ID(13), sequence: 2 })] }));
    show();
    await user().click(await screen.findByRole("button", { name: "Review step 1" }));
    expect(await screen.findByText(/Waiting for the gas top-up to confirm/)).toBeInTheDocument();
    expect(signer.sendEvm).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(3100));
    await user().click(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    await waitFor(() => expect(signer.sendEvm).toHaveBeenCalledWith(evmQuote.transaction, evmQuote.approval));
    await waitFor(() => expect(api.submitLeg).toHaveBeenCalledWith(ID(20), ID(12), { txHash: "0xhash" }));
  });

  it("a wallet refusal is shown and nothing is submitted", async () => {
    const { WalletRejectedError } = await import("@repo/app-core");
    api.getOperation.mockResolvedValue(operation());
    api.quoteLeg.mockResolvedValue(solanaQuote);
    signer.signSolana.mockRejectedValue(new WalletRejectedError());
    show();
    await user().click(await screen.findByRole("button", { name: "Review step 1" }));
    await user().click(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    expect(await screen.findByText("Signature cancelled")).toBeInTheDocument();
    expect(api.submitLeg).not.toHaveBeenCalled();
  });

  it("after some legs settled the user can stop here; the result lists what did not run", async () => {
    const settled = [feeLeg({ status: "SETTLED" }), buyLeg({ status: "SETTLED" })];
    const btc = buyLeg({ id: ID(14), sequence: 3, toChain: "bitcoin", routeSummary: { symbol: "BTC", decimals: 8, estimatedOut: "100000" }, minOut: "99000" });
    api.getOperation.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [...settled, btc] }));
    api.cancelOperation.mockResolvedValue(operation({ status: "PARTIAL", legs: [...settled, btc] }));
    show();
    await user().click(await screen.findByRole("button", { name: "Stop here" }));
    expect(api.cancelOperation).toHaveBeenCalledWith(ID(20));
    expect(await screen.findByText(/Some steps settled and some did not run/)).toBeInTheDocument();
    expect(screen.getByText(/Not run: Buy BTC/)).toBeInTheDocument();
    expect(screen.getByText("Partly completed")).toBeInTheDocument();
  });

  it("an unknown outcome cannot be signed again but the user may stop (the check continues), and Bitcoin legs show the confirmation time", async () => {
    const btc = buyLeg({ id: ID(14), sequence: 2, toChain: "bitcoin", status: "UNKNOWN", routeSummary: { symbol: "BTC", decimals: 8 } });
    api.getOperation.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), btc] }));
    show();
    expect(await screen.findByText(/Do not sign it again/)).toBeInTheDocument();
    expect(screen.getByText("Bitcoin needs 2 confirmations, about 20 minutes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Review step|Approve step/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop here" })).toBeInTheDocument();
  });

  async function toApprove() {
    api.getOperation.mockResolvedValue(operation());
    api.quoteLeg.mockResolvedValue(solanaQuote);
    const view = show();
    await user().click(await screen.findByRole("button", { name: "Review step 1" }));
    await user().click(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    return view;
  }

  it("offers Connect wallet on a missing wallet and retries the step once after the connections change", async () => {
    signer.signSolana.mockRejectedValueOnce(new WrongWalletError("Connect Phantom (4Nd1mB…DB4T) to sign this Solana step", true)).mockResolvedValue("c2lnbmVk");
    api.submitLeg.mockResolvedValue(operation({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SUBMITTED", sourceTx: "5xTx" }), buyLeg()] }));
    await toApprove();
    expect(await screen.findByText(/Connect Phantom/)).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(reown.open).toHaveBeenCalledWith({ view: "Connect" });
    expect(signer.signSolana).toHaveBeenCalledTimes(1);
    signer.connectionKey = "b";
    act(() => rerender());
    await waitFor(() => expect(signer.signSolana).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.submitLeg).toHaveBeenCalledTimes(1));
  });

  it("does not retry after the user rejects, and never more than once", async () => {
    signer.signSolana.mockRejectedValue(new WalletRejectedError());
    await toApprove();
    await waitFor(() => expect(signer.signSolana).toHaveBeenCalledTimes(1));
    signer.connectionKey = "b";
    act(() => rerender());
    await act(async () => { await Promise.resolve(); });
    expect(signer.signSolana).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
  });
});
