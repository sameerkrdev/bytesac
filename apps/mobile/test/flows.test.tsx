import { ApiError } from "@repo/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Linking } from "react-native";
import OperationScreen from "@/app/(app)/operation/[id]";
import RebalanceScreen from "@/app/(app)/rebalance/[positionId]";
import RepairScreen from "@/app/(app)/repair/[asset]";
import SellScreen from "@/app/(app)/sell/[positionId]";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";
import { id, leg, operation, portfolio, position } from "./fixtures";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: jest.fn() }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockSigner = { signSolana: jest.fn(), sendEvm: jest.fn() };
jest.mock("@/lib/wallet/use-signer", () => ({ useSigner: () => mockSigner }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;
const params = (p: Record<string, string>) => (useLocalSearchParams as jest.Mock).mockReturnValue(p);
const asset = id(21);
const repairs = (positions: { positionId: string; basketSlug: string; ledger: string; shortfall: string }[], a: string = asset) => [{ asset: a, symbol: "SOL", totalShortfall: positions.reduce((s, x) => s + Number(x.shortfall), 0).toString(), positions }];

beforeEach(() => { jest.clearAllMocks(); resetApi(mockApi); mockApi.me.mockResolvedValue({}); mockSigner.signSolana.mockReset(); });

describe("Rebalance review (mobile)", () => {
  const withUpdate = () => portfolio({ positions: [position({ headline: "REBALANCE_AVAILABLE", states: { version: "OUT_OF_DATE" } as never, latestVersion: {
    id: id(51), number: 2, rationale: "Added more SOL",
    diff: { added: [], removed: [], changed: [{ instrumentId: id(41), fromBps: 5000, toBps: 6000 }], bandChanged: [], constraints: false, rebalance: false, fees: true, minimums: false },
  } })] });

  it("shows what changed and the weights, creates nothing until Create plan, then previews the plan", async () => {
    params({ positionId: id(31), target: "latest" });
    mockApi.getPortfolio.mockResolvedValue(withUpdate());
    mockApi.rebalance.mockResolvedValue(operation({ kind: "rebalance" }));
    await renderWithClient(<RebalanceScreen />);
    expect(await screen.findByText("Version 1 to version 2")).toBeOnTheScreen();
    expect(screen.getByText(/Added more SOL/)).toBeOnTheScreen();
    expect(screen.getByText("• SOL: 50% to 60%")).toBeOnTheScreen();
    expect(screen.getByText("• Fees changed")).toBeOnTheScreen();
    expect(mockApi.rebalance).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Create plan" }));
    expect(await screen.findByRole("button", { name: "Continue to signing" })).toBeOnTheScreen();
    expect(mockApi.rebalance).toHaveBeenCalledWith({ positionId: id(31), target: "latest", slippageBps: 100, idempotencyKey: expect.any(String) });
    expect(screen.getByText("Total fees")).toBeOnTheScreen();
  });

  it("Skip this version records the skip and goes back to the portfolio", async () => {
    params({ positionId: id(31), target: "latest" });
    mockApi.getPortfolio.mockResolvedValue(withUpdate());
    mockApi.skipVersion.mockResolvedValue(undefined);
    await renderWithClient(<RebalanceScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Skip this version" }));
    await waitFor(() => expect(mockApi.skipVersion).toHaveBeenCalledWith(id(31), { versionId: id(51) }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/portfolio"));
  });

  it("an already aligned basket is recorded, no plan", async () => {
    params({ positionId: id(31), target: "applied" });
    mockApi.getPortfolio.mockResolvedValue(withUpdate());
    mockApi.rebalance.mockResolvedValue({ aligned: true });
    await renderWithClient(<RebalanceScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Create plan" }));
    expect(await screen.findByText("Already aligned with this version — recorded.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Skip this version" })).toBeNull();
  });

  it("REPAIR_REQUIRED sends the user to the repair screen", async () => {
    params({ positionId: id(31), target: "applied" });
    mockApi.getPortfolio.mockResolvedValue({ ...withUpdate(), repairs: repairs([{ positionId: id(31), basketSlug: "alpha", ledger: "10", shortfall: "1" }]) });
    mockApi.rebalance.mockRejectedValue(new ApiError("REPAIR_REQUIRED", 409, "repair"));
    await renderWithClient(<RebalanceScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Create plan" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Go to repair" }));
    expect(router.push).toHaveBeenCalledWith(`/repair/${asset}`);
  });
});

describe("Repair and sync (mobile)", () => {
  const two = [{ positionId: id(31), basketSlug: "alpha", ledger: "3000000000", shortfall: "1000000000" }, { positionId: id(32), basketSlug: "beta", ledger: "2000000000", shortfall: "500000000" }];
  const withRepair = () => portfolio({ positions: [position(), position({ id: id(32) })], repairs: repairs(two) });

  it("Buy back previews the cost from the server before any signing", async () => {
    params({ asset });
    mockApi.getPortfolio.mockResolvedValue(withRepair());
    mockApi.repair.mockResolvedValue(operation({ kind: "repair" }));
    await renderWithClient(<RepairScreen />);
    expect(await screen.findByText("Repair SOL")).toBeOnTheScreen();
    expect(screen.getByText(/Buy back 1.5 SOL/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Get cost preview" }));
    expect(await screen.findByText("Platform fee")).toBeOnTheScreen();
    expect(mockApi.repair).toHaveBeenCalledWith({ deploymentId: asset, slippageBps: 100, idempotencyKey: expect.any(String) });
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
  });

  it("Sync is prefilled with the server's shares, blocks Save until the exact total, then sends the split", async () => {
    params({ asset });
    mockApi.getPortfolio.mockResolvedValue(withRepair());
    mockApi.sync.mockResolvedValue({});
    await renderWithClient(<RepairScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sync" }));
    const alpha = screen.getByLabelText("alpha: reduce by (SOL)");
    const beta = screen.getByLabelText("beta: reduce by (SOL)");
    expect(alpha.props.value).toBe("1");
    expect(beta.props.value).toBe("0.5");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await fireEvent.changeText(alpha, "0.9");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await fireEvent.changeText(alpha, "1.1");
    await fireEvent.changeText(beta, "0.4");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.sync).toHaveBeenCalledWith({
      asset: { deploymentId: asset }, split: [{ positionId: id(31), quantity: "1100000000" }, { positionId: id(32), quantity: "400000000" }], idempotencyKey: expect.any(String),
    }));
    expect(await screen.findByText("Saved. Your baskets now match your wallet.")).toBeOnTheScreen();
  });

  it("an entry above the recorded ledger quantity cannot be saved", async () => {
    params({ asset });
    mockApi.getPortfolio.mockResolvedValue(withRepair());
    await renderWithClient(<RepairScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sync" }));
    await fireEvent.changeText(screen.getByLabelText("alpha: reduce by (SOL)"), "4");
    await fireEvent.changeText(screen.getByLabelText("beta: reduce by (SOL)"), "-2.5");
    expect(screen.getByText("Enter a number within the decimals of this asset.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("SHORTFALL_CHANGED tells the user the holdings changed", async () => {
    params({ asset });
    mockApi.getPortfolio.mockResolvedValue(withRepair());
    mockApi.sync.mockRejectedValue(new ApiError("SHORTFALL_CHANGED", 409, "changed"));
    await renderWithClient(<RepairScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sync" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Your holdings changed — review the new figures")).toBeOnTheScreen();
  });

  it("basket cash can only be synced (no buy back)", async () => {
    params({ asset: "cash" });
    mockApi.getPortfolio.mockResolvedValue(portfolio({ positions: [position()], repairs: [{ asset: "cash", symbol: "USDC", totalShortfall: "1000000", positions: [{ positionId: id(31), basketSlug: "alpha", ledger: "5000000", shortfall: "1000000" }] }] }));
    await renderWithClient(<RepairScreen />);
    expect(await screen.findByLabelText("alpha: reduce by (USDC)")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Buy back" })).toBeNull();
  });

  it("nothing to repair says so", async () => {
    params({ asset });
    mockApi.getPortfolio.mockResolvedValue(portfolio());
    await renderWithClient(<RepairScreen />);
    expect(await screen.findByText("Nothing needs repair here.")).toBeOnTheScreen();
  });
});

describe("Sell (mobile)", () => {
  beforeEach(() => { params({ positionId: id(31) }); mockApi.getPortfolio.mockResolvedValue(portfolio({ positions: [position()] })); });

  it("validates the percent and previews with the excluded-assets notice", async () => {
    mockApi.sellPlan.mockResolvedValue(operation({ kind: "sell_to_usdc", excluded: [{ instrumentId: id(41), symbol: "BUIDL", notice: "BUIDL stays in your wallet: not available for your investor status." }] }));
    await renderWithClient(<SellScreen />);
    expect(await screen.findByText("Sell to USDC")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Percent to sell"), "150");
    expect(screen.getByText("Enter a whole number from 1 to 100.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Get preview" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "50%" }));
    await fireEvent.press(screen.getByRole("button", { name: "Get preview" }));
    expect(await screen.findByText("Left out of this sale")).toBeOnTheScreen();
    expect(screen.getByText("BUIDL stays in your wallet: not available for your investor status.")).toBeOnTheScreen();
    expect(mockApi.sellPlan).toHaveBeenCalledWith({ positionId: id(31), percent: 50, slippageBps: 100, idempotencyKey: expect.any(String) });
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
  });
});

describe("Operation detail (mobile)", () => {
  const open = (legs = [leg()]) => operation({ status: "IN_PROGRESS", legs });
  const openUrl = () => jest.spyOn(Linking, "openURL").mockResolvedValue(true);

  it("lists the legs with explorer links and Stop here cancels the operation", async () => {
    params({ id: id(1) });
    const url = openUrl();
    const o = open([leg({ status: "SETTLED", sourceTx: "sig123", sequence: 1 }), leg({ id: id(12), sequence: 2 })]);
    mockApi.getOperation.mockResolvedValue(o);
    mockApi.cancelOperation.mockResolvedValue({ ...o, status: "PARTIAL" });
    await renderWithClient(<OperationScreen />);
    await fireEvent.press(await screen.findByRole("link", { name: "Source transaction" }));
    expect(url).toHaveBeenCalledWith("https://solscan.io/tx/sig123");
    await fireEvent.press(screen.getByRole("button", { name: "Stop here" }));
    await waitFor(() => expect(mockApi.cancelOperation).toHaveBeenCalledWith(id(1)));
  });

  it("an unsigned operation offers Cancel, not Stop here", async () => {
    params({ id: id(1) });
    mockApi.getOperation.mockResolvedValue(open());
    await renderWithClient(<OperationScreen />);
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Stop here" })).toBeNull();
  });

  it("an in-flight leg waits for the network and offers neither Cancel nor Stop here", async () => {
    params({ id: id(1) });
    mockApi.getOperation.mockResolvedValue(open([leg({ status: "PENDING_CHAIN" })]));
    await renderWithClient(<OperationScreen />);
    expect(await screen.findByText(/Waiting for the network to confirm/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop here" })).toBeNull();
  });

  it("a recovery leg is offered as Complete swap and shows what arrived", async () => {
    params({ id: id(1) });
    const failed = leg({ status: "FAILED", sequence: 1, recoveryToken: { chain: "ethereum", address: null, decimals: 6, symbol: "USDC", amount: "40000000" } });
    const recovery = leg({ id: id(12), sequence: 2, recoveryOf: failed.id, routeSummary: { fromSymbol: "USDC", fromDecimals: 6, symbol: "ETH", decimals: 18, estimatedOut: "20000000000000000" }, amountIn: "40000000", minOut: "19000000000000000" });
    mockApi.getOperation.mockResolvedValue(open([failed, recovery]));
    await renderWithClient(<OperationScreen />);
    expect(await screen.findByText(/Arrived as 40 USDC on Ethereum/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Complete swap" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Stop here" })).toBeOnTheScreen();
  });

  it("a partial result says what happened and that fees are not refunded", async () => {
    params({ id: id(1) });
    mockApi.getOperation.mockResolvedValue(operation({ status: "PARTIAL", legs: [leg({ kind: "network_fee", status: "SETTLED", toDeploymentId: null }), leg({ id: id(12), sequence: 2, status: "FAILED", failureReason: "No route" })] }));
    await renderWithClient(<OperationScreen />);
    expect(await screen.findByText(/Some steps settled and some did not run/)).toBeOnTheScreen();
    expect(screen.getByText(/The fees were already paid and are not refunded/)).toBeOnTheScreen();
    expect(screen.getByText("No route")).toBeOnTheScreen();
  });
});
