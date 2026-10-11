import { ApiError } from "@repo/api-client";
import type { GroupResponse, Investability, PublicBasketDetail } from "@repo/validator";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buyLeg, feeLeg, ID, operation, renderApp } from "./invest-fixtures";

const api = {
  investPlan: vi.fn(), cancelOperation: vi.fn(), getOperation: vi.fn(), quoteLeg: vi.fn(), requestGroup: vi.fn(), submitGroup: vi.fn(), continueOperation: vi.fn(), getPortfolio: vi.fn(), getInvestability: vi.fn(),
};
vi.mock("@/lib/api", () => ({
  api: {
    investPlan: (b: unknown) => api.investPlan(b), cancelOperation: (id: string) => api.cancelOperation(id), getOperation: (id: string) => api.getOperation(id),
    requestGroup: (id: string, b: unknown) => api.requestGroup(id, b), submitGroup: (id: string, g: string, b: unknown) => api.submitGroup(id, g, b),
    quoteLeg: (o: string, l: string) => api.quoteLeg(o, l), continueOperation: (id: string, b: unknown) => api.continueOperation(id, b), getPortfolio: () => api.getPortfolio(), getInvestability: (s: string) => api.getInvestability(s),
  },
}));
const wallet = vi.hoisted(() => ({ signSolana: vi.fn(), signSolanaAll: vi.fn(), walletName: "Phantom", connectionKey: "a" }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => wallet }));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: vi.fn() }), useAppKitState: () => ({ open: false }) }));
import { InvestButton } from "@/components/invest/invest-button";
import { InvestFlow } from "@/components/invest/invest-flow";
import { GroupProgress } from "@/components/invest/group-progress";

const basket = {
  version: { name: "Core Crypto", versionNumber: 2, minimumInvestmentUsdc: "250", minimumIncrementUsdc: "50" },
  allocation: [{ instrumentId: ID(31), symbol: "ETH", name: "Ether", targetWeightBps: 10_000, chains: ["ethereum"] }],
  organization: { displayName: "Meridian" },
} as unknown as PublicBasketDetail;

/** A plan as the API makes it for the website: user-paid Solana gas, one expected wallet approval, 0.0042 SOL of fees plus the 0.001 SOL buffer. */
const plan = (o: Parameters<typeof operation>[0] = {}) => operation({ approvalsEstimate: 1, solRequiredLamports: "5200000", legs: [feeLeg({ gasPayer: "user_solana" }), buyLeg({ gasPayer: "user_solana" })], ...o });
const group = (o: Partial<GroupResponse> = {}): GroupResponse => ({
  groupId: ID(50), status: "quoted", expiresAt: new Date(Date.now() + 60_000).toISOString(), sendBy: new Date(Date.now() + 40_000).toISOString(), priceMoved: false, approvalsEstimate: 1, solRequiredLamports: "5200000",
  transactions: [{ legId: ID(10), kind: "fee", serializedBase64: "fee-tx" }, { legId: ID(11), kind: "asset", serializedBase64: "buy-tx" }],
  legs: [{ legId: ID(11), estimatedOut: "30000000000000000", minOut: "29000000000000000", plannedMinOut: "29700000000000000", routeFees: [], priceImpact: null, error: null }], ...o,
});
const sent = () => plan({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SUBMITTED", sourceTx: "5xFee" }), buyLeg({ status: "SUBMITTED", sourceTx: "5xBuy" })] });

const flow = () => renderApp(<InvestFlow slug="core-crypto" basketId="b" basket={basket} />);
const confirmPlan = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Get preview" }));
  await screen.findByText("About 1 wallet approval");
  await userEvent.click(screen.getByRole("checkbox", { name: /I.ll approve these transactions/ }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getPortfolio.mockResolvedValue({ positions: [], formerPositions: [], openOperations: [], history: [], repairs: [] });
  api.investPlan.mockResolvedValue(plan());
  api.getOperation.mockResolvedValue(plan());
  api.requestGroup.mockResolvedValue(group());
  api.submitGroup.mockResolvedValue(sent());
  wallet.signSolanaAll.mockImplementation(async (txs: string[]) => txs.map((t) => `signed-${t}`));
});

describe("batched invest review", () => {
  it("shows the approvals estimate and the SOL the user pays, and asks for the plan with tier sign_all", async () => {
    flow();
    await userEvent.click(screen.getByRole("button", { name: "Get preview" }));
    expect(await screen.findByText("About 1 wallet approval")).toBeInTheDocument();
    expect(screen.getByText(/Network fees: about 0\.0042 SOL, paid by you in SOL/)).toBeInTheDocument();
    expect(screen.getByText(/keep about 0\.001 SOL extra/)).toBeInTheDocument();
    expect(screen.getByText(/Fees are charged per batch; batches you never send aren.t charged\./)).toBeInTheDocument();
    expect(api.investPlan).toHaveBeenCalledWith(expect.objectContaining({ tier: "sign_all" }));
    expect(api.requestGroup).not.toHaveBeenCalled(); // nothing is quoted on the review step
  });

  it("more than 10 asset legs need the minimums checkbox before Confirm", async () => {
    const many = Array.from({ length: 11 }, (_, i) => buyLeg({ id: ID(60 + i), sequence: i + 2 }));
    api.investPlan.mockResolvedValue(plan({ legs: [feeLeg(), ...many] }));
    flow();
    await userEvent.click(screen.getByRole("button", { name: "Get preview" }));
    await screen.findByText("About 1 wallet approval");
    await userEvent.click(screen.getByRole("checkbox", { name: /I.ll approve these transactions/ }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "I've checked the minimum amounts" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });
});

describe("batched invest signing", () => {
  it("Confirm requests a group, signs the whole batch once, then submits it", async () => {
    flow();
    await confirmPlan();
    await waitFor(() => expect(api.submitGroup).toHaveBeenCalled());
    expect(api.requestGroup).toHaveBeenCalledWith(plan().id, { chain: "solana", tier: "sign_all", walletName: "Phantom", idempotencyKey: expect.any(String) });
    expect(wallet.signSolanaAll).toHaveBeenCalledTimes(1);
    expect(wallet.signSolanaAll).toHaveBeenCalledWith(["fee-tx", "buy-tx"]);
    expect(wallet.signSolana).not.toHaveBeenCalled();
    expect(api.submitGroup).toHaveBeenCalledWith(plan().id, ID(50), { signed: [{ legId: ID(10), signedTx: "signed-fee-tx" }, { legId: ID(11), signedTx: "signed-buy-tx" }] });
    expect(api.requestGroup.mock.invocationCallOrder[0]).toBeLessThan(wallet.signSolanaAll.mock.invocationCallOrder[0]!);
    expect(wallet.signSolanaAll.mock.invocationCallOrder[0]).toBeLessThan(api.submitGroup.mock.invocationCallOrder[0]!);
    expect(await screen.findByText(/Sending 1 of 1 · confirmed 0/)).toBeInTheDocument();
  });

  it("a moved price waits for Accept new prices before the wallet opens", async () => {
    api.requestGroup.mockResolvedValue(group({ priceMoved: true }));
    flow();
    await confirmPlan();
    const accept = await screen.findByRole("button", { name: "Accept new prices" });
    expect(screen.getByText(/Send within \d+ s/)).toBeInTheDocument();
    expect(screen.getByText(/at least 0\.029 ETH/)).toBeInTheDocument();
    expect(wallet.signSolanaAll).not.toHaveBeenCalled();
    await userEvent.click(accept);
    await waitFor(() => expect(wallet.signSolanaAll).toHaveBeenCalledTimes(1));
    expect(api.submitGroup).toHaveBeenCalled();
  });

  it("declining the new prices signs and submits nothing", async () => {
    api.requestGroup.mockResolvedValue(group({ priceMoved: true }));
    flow();
    await confirmPlan();
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Accept new prices" })).toBeNull());
    expect(wallet.signSolanaAll).not.toHaveBeenCalled();
    expect(api.submitGroup).not.toHaveBeenCalled();
  });

  it("a SOL shortfall says how much SOL to add", async () => {
    api.requestGroup.mockRejectedValue(new ApiError("SOL_REQUIRED", 409, "Not enough SOL.", undefined, { lamportsRequired: "5000000", lamportsHeld: "800000" }));
    flow();
    await confirmPlan();
    expect(await screen.findByText("Add about 0.0042 SOL to your Solana wallet, then continue.")).toBeInTheDocument();
    expect(wallet.signSolanaAll).not.toHaveBeenCalled();
  });

  it("expired quotes offer new quotes, which runs the next group", async () => {
    api.submitGroup.mockRejectedValueOnce(new ApiError("GROUP_EXPIRED", 409, "expired")).mockResolvedValue(sent());
    flow();
    await confirmPlan();
    await userEvent.click(await screen.findByRole("button", { name: "Get new quotes" }));
    await waitFor(() => expect(api.requestGroup).toHaveBeenCalledTimes(2));
    expect(api.submitGroup).toHaveBeenCalledTimes(2);
  });
});

describe("chunks", () => {
  it("requests the second group only after the first group's fee settled, and shows no failure or needs-action panel in between (review I1)", async () => {
    const buy2 = (o: Parameters<typeof buyLeg>[0] = {}) => buyLeg({ id: ID(12), sequence: 3, ...o });
    let phase: "start" | "sent" | "settled" | "done" = "start";
    const view = () => ({
      start: plan({ legs: [feeLeg({ gasPayer: "user_solana" }), buyLeg({ gasPayer: "user_solana" }), buy2({ gasPayer: "user_solana" })] }),
      sent: plan({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SUBMITTED", sourceTx: "5xFee" }), buyLeg({ status: "SUBMITTED", sourceTx: "5xBuy" }), buy2()] }),
      // the first chunk settled meanwhile: the server marks the investment as waiting for the user while a leg is still PLANNED
      settled: plan({ status: "IN_PROGRESS", needsAction: true, needsActionSince: "2026-10-11T10:00:00.000Z", legs: [feeLeg({ status: "SETTLED" }), buyLeg({ status: "SETTLED" }), buy2()] }),
      done: plan({ status: "COMPLETED", legs: [feeLeg({ status: "SETTLED" }), buyLeg({ status: "SETTLED" }), buy2({ status: "SETTLED" })] }),
    })[phase];
    api.getOperation.mockImplementation(async () => view());
    const phaseAtSecondRequest: string[] = [];
    api.requestGroup
      .mockResolvedValueOnce(group({ transactions: [{ legId: ID(10), kind: "fee", serializedBase64: "fee-tx" }, { legId: ID(11), kind: "asset", serializedBase64: "buy-tx" }] }))
      .mockImplementationOnce(async () => {
        phaseAtSecondRequest.push(phase);
        return group({ groupId: ID(51), transactions: [{ legId: ID(12), kind: "asset", serializedBase64: "buy2-tx" }], legs: [] });
      });
    api.submitGroup
      .mockImplementationOnce(async () => { phase = "sent"; setTimeout(() => { phase = "settled"; }, 1_500); return view(); })
      .mockImplementationOnce(async () => { phase = "done"; return view(); });
    renderApp(<GroupProgress operationId={plan().id} autoStart />);
    await waitFor(() => expect(api.submitGroup).toHaveBeenCalledTimes(1));
    expect(api.requestGroup).toHaveBeenCalledTimes(1); // the fee is still in flight: nothing is requested, nothing fails
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(api.submitGroup).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    expect(phaseAtSecondRequest).toEqual(["settled"]);
    expect(api.requestGroup).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Some steps didn't go through")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  }, 20_000);

  it("stops driving when a leg of the chunk it sent was released, so the user decides (Continue or Stop)", async () => {
    api.getOperation.mockResolvedValue(plan());
    api.requestGroup.mockResolvedValue(group({ transactions: [{ legId: ID(11), kind: "asset", serializedBase64: "buy-tx" }], legs: [] }));
    api.submitGroup.mockResolvedValue(plan({ status: "IN_PROGRESS", needsAction: true, needsActionSince: "2026-10-11T10:00:00.000Z", legs: [feeLeg({ status: "SETTLED" }), buyLeg({ status: "PLANNED", lastError: "QUOTE_STALE" })] }));
    renderApp(<GroupProgress operationId={plan().id} autoStart />);
    expect(await screen.findByText("Some steps didn't go through")).toBeInTheDocument();
    expect(api.requestGroup).toHaveBeenCalledTimes(1);
  });
});

describe("recovery on a grouped investment", () => {
  it("offers Complete swap for the recovery leg, which quotes that leg only (review I7)", async () => {
    const failed = buyLeg({ status: "FAILED", failureReason: "DESTINATION_SWAP_FAILED", recoveryToken: { chain: "ethereum", address: "0xdd", decimals: 6, symbol: "USDC", amount: "299000000" } });
    const recovery = buyLeg({ id: ID(13), sequence: 4, kind: "swap", status: "PLANNED", recoveryOf: failed.id, fromChain: "ethereum", gasPayer: "platform_gas_drop" });
    api.getOperation.mockResolvedValue(plan({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), failed, buyLeg({ id: ID(12), sequence: 3, status: "PLANNED" }), recovery] }));
    api.quoteLeg.mockRejectedValue(new ApiError("VALIDATION_FAILED", 400, "stop here"));
    renderApp(<GroupProgress operationId={plan().id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Complete swap" }));
    expect(api.quoteLeg).toHaveBeenCalledWith(plan().id, ID(13));
    expect(screen.queryByRole("button", { name: /Review step/ })).toBeNull();
  });
});

describe("needs action", () => {
  const stopped = () => plan({
    status: "IN_PROGRESS", needsAction: true, needsActionSince: "2026-10-11T10:00:00.000Z",
    legs: [feeLeg({ status: "SETTLED" }), buyLeg({ status: "PLANNED", lastError: "QUOTE_STALE" })],
  });
  const show = () => renderApp(<GroupProgress operationId={plan().id} />);

  it("lists what did not go through with Continue, Raise slippage, Skip, Stop and the 24 hour text", async () => {
    api.getOperation.mockResolvedValue(stopped());
    show();
    expect(await screen.findByText("Quote expired before sending — nothing spent")).toBeInTheDocument();
    for (const name of ["Continue", "Raise slippage", "Skip ETH", "Stop"]) expect(screen.getByRole("button", { name })).toBeEnabled();
    const until = new Date(new Date("2026-10-11T10:00:00.000Z").getTime() + 24 * 3_600_000).toLocaleString();
    expect(screen.getByText(`Continue is free until ${until}; stopping keeps fees already paid.`)).toBeInTheDocument();
  });

  it("Continue asks the server, then runs the next group; Skip and Raise slippage send their choice", async () => {
    api.getOperation.mockResolvedValue(stopped());
    api.continueOperation.mockResolvedValue(plan({ status: "IN_PROGRESS", legs: [feeLeg({ status: "SETTLED" }), buyLeg({ id: ID(70), retryOf: ID(11) })] }));
    api.requestGroup.mockResolvedValue(group({ transactions: [{ legId: ID(70), kind: "asset", serializedBase64: "retry-tx" }], legs: [] }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(api.continueOperation).toHaveBeenCalledWith(plan().id, { idempotencyKey: expect.any(String) }));
    await waitFor(() => expect(wallet.signSolanaAll).toHaveBeenCalledWith(["retry-tx"]));
  });

  it("Skip and Raise slippage send their own choice; Stop cancels", async () => {
    api.getOperation.mockResolvedValue(stopped());
    api.continueOperation.mockRejectedValue(new ApiError("OPERATION_IN_PROGRESS", 409, "busy"));
    api.cancelOperation.mockResolvedValue(plan({ status: "PARTIAL" }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Skip ETH" }));
    expect(api.continueOperation).toHaveBeenLastCalledWith(plan().id, { idempotencyKey: expect.any(String), skipLegIds: [ID(11)] });
    await userEvent.click(screen.getByRole("button", { name: "Raise slippage" }));
    expect(api.continueOperation).toHaveBeenLastCalledWith(plan().id, { idempotencyKey: expect.any(String), slippageBps: 200 });
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(api.cancelOperation).toHaveBeenCalledWith(plan().id);
  });

  it("short USDC offers Invest what's available, which continues scaled to the wallet", async () => {
    api.getOperation.mockResolvedValue(stopped());
    api.continueOperation.mockRejectedValueOnce(new ApiError("INSUFFICIENT_BALANCE", 409, "Your Solana wallet doesn't hold enough USDC.", undefined, { usdcRequiredMicro: "99930000", usdcHeldMicro: "50000000" }))
      .mockResolvedValue(plan({ status: "COMPLETED" }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/This step needs 99\.93 USDC; your wallet holds 50\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Invest what's available" }));
    expect(api.continueOperation).toHaveBeenLastCalledWith(plan().id, { idempotencyKey: expect.any(String), scaleToAvailable: true });
  });
});

describe("open operation banner", () => {
  const inv: Investability = { basketId: ID(3), investable: true, reasons: [], requiredFamilies: ["solana"], minimumUsdc: "250", eligibility: { eligible: true, reasons: [] } } as Investability;

  it("the invest button is disabled and says to finish or stop the open investment", async () => {
    api.getInvestability.mockResolvedValue(inv);
    api.getPortfolio.mockResolvedValue({ positions: [], formerPositions: [], history: [], repairs: [], openOperations: [plan({ status: "IN_PROGRESS", needsAction: true })] });
    renderApp(<InvestButton slug="core-crypto" name="Core Crypto" minimumUsdc="250" incrementUsdc="50" />);
    expect(await screen.findByText("Finish or stop your open investment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invest" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", `/portfolio#operation-${plan().id}`);
    api.cancelOperation.mockResolvedValue(plan({ status: "PARTIAL" }));
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(api.cancelOperation).toHaveBeenCalledWith(plan().id);
  });

  it("without an open operation the button invests as before", async () => {
    api.getInvestability.mockResolvedValue(inv);
    renderApp(<InvestButton slug="core-crypto" name="Core Crypto" minimumUsdc="250" incrementUsdc="50" />);
    expect(await screen.findByRole("button", { name: "Invest" })).toBeEnabled();
    expect(screen.queryByText("Finish or stop your open investment")).toBeNull();
  });
});
