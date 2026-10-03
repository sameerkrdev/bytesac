import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import PortfolioScreen from "@/app/(app)/(tabs)/portfolio";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";
import { id, leg, operation, portfolio, position } from "./fixtures";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;
const show = (p: ReturnType<typeof portfolio>) => { mockApi.getPortfolio.mockResolvedValue(p); return renderWithClient(<PortfolioScreen />); };
const confirmAlert = () => jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style !== "cancel")?.onPress?.());

describe("Portfolio (mobile)", () => {
  beforeEach(() => { jest.clearAllMocks(); resetApi(mockApi); });

  it("shows positions with value, headline, holdings, target weights and cash", async () => {
    await show(portfolio({ positions: [position({ cashMicro: "2500000" })] }));
    expect(await screen.findByText("Alpha Basket")).toBeOnTheScreen();
    expect(screen.getByText("$300.00")).toBeOnTheScreen();
    expect(screen.getByText("Aligned")).toBeOnTheScreen();
    expect(screen.getByText("2 SOL · $300.00")).toBeOnTheScreen();
    expect(screen.getByText("60%")).toBeOnTheScreen();
    expect(screen.getByText("50%")).toBeOnTheScreen();
    expect(screen.getByText("2.5 USDC")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sell to USDC" })).toBeOnTheScreen();
  });

  it("empty state points to Discover; error state retries", async () => {
    await show(portfolio());
    await fireEvent.press(await screen.findByRole("button", { name: "Discover baskets" }));
    expect(router.push).toHaveBeenCalledWith("/(app)/(tabs)/discover");
  });

  it("error state offers a retry", async () => {
    mockApi.getPortfolio.mockRejectedValue(new Error("boom"));
    await renderWithClient(<PortfolioScreen />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeOnTheScreen();
  });

  it("DRIFTED offers Rebalance to target (review screen, nothing created) and Keep custom (API call)", async () => {
    mockApi.keepCustom.mockResolvedValue(undefined);
    await show(portfolio({ positions: [position({ headline: "DRIFTED" })] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Rebalance to target" }));
    expect(router.push).toHaveBeenCalledWith(`/rebalance/${id(31)}?target=applied`);
    expect(mockApi.rebalance).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Keep custom" }));
    await waitFor(() => expect(mockApi.keepCustom).toHaveBeenCalledWith(id(31)));
  });

  it("CUSTOMIZED offers Revert custom", async () => {
    mockApi.revertCustom.mockResolvedValue(undefined);
    await show(portfolio({ positions: [position({ headline: "CUSTOMIZED" })] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Revert custom" }));
    await waitFor(() => expect(mockApi.revertCustom).toHaveBeenCalledWith(id(31)));
  });

  it("REBALANCE_AVAILABLE offers Review update for the latest version", async () => {
    await show(portfolio({ positions: [position({ headline: "REBALANCE_AVAILABLE", states: { version: "OUT_OF_DATE" } as never, latestVersion: { id: id(51), number: 2, rationale: null, diff: {} as never } })] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Review update" }));
    expect(router.push).toHaveBeenCalledWith(`/rebalance/${id(31)}?target=latest`);
  });

  it("a skipped version says so and still offers the review", async () => {
    await show(portfolio({ positions: [position({ states: { version: "SKIPPED" } as never, latestVersion: { id: id(51), number: 3, rationale: null, diff: {} as never } })] }));
    expect(await screen.findByText("You skipped version 3")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Review update" })).toBeOnTheScreen();
  });

  it("REPAIR_REQUIRED opens the repair for the short asset; incomplete plans can be continued; pending ones viewed", async () => {
    const op = operation({ positionId: id(31), status: "IN_PROGRESS" });
    await show(portfolio({
      positions: [position({ headline: "REPAIR_REQUIRED" }), position({ id: id(32), headline: "EXECUTION_INCOMPLETE" }), position({ id: id(33), headline: "EXECUTION_PENDING" })],
      repairs: [{ asset: id(21), symbol: "SOL", totalShortfall: "1", positions: [{ positionId: id(31), basketSlug: "alpha", ledger: "10", shortfall: "1" }] }],
      openOperations: [{ ...op, positionId: id(33) }],
    }));
    await fireEvent.press(await screen.findByRole("button", { name: "Repair" }));
    expect(router.push).toHaveBeenCalledWith(`/repair/${id(21)}`);
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(router.push).toHaveBeenCalledWith(`/rebalance/${id(32)}?target=applied`);
    await fireEvent.press(screen.getByRole("button", { name: "View operation" }));
    expect(router.push).toHaveBeenCalledWith(`/operation/${id(1)}`);
  });

  it("shows short and surplus reconciliation notices in words", async () => {
    const p = position();
    p.holdings = [{ ...p.holdings[0]!, reconciliation: "SHORT" }, { ...p.holdings[0]!, deploymentId: id(22), symbol: "ETH", reconciliation: "SURPLUS" }];
    await show(portfolio({ positions: [p] }));
    expect(await screen.findByText(/Your wallet holds less SOL than Bytesac recorded/)).toBeOnTheScreen();
    expect(screen.getByText(/Extra ETH in your wallet is outside your baskets/)).toBeOnTheScreen();
    expect(screen.getByText("Wallet holds less than recorded")).toBeOnTheScreen();
  });

  it("Leave basket asks first, then calls leave (no transaction)", async () => {
    const alert = confirmAlert();
    mockApi.leavePosition.mockResolvedValue(undefined);
    await show(portfolio({ positions: [position()] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Leave basket (keep assets)" }));
    expect(alert).toHaveBeenCalled();
    await waitFor(() => expect(mockApi.leavePosition).toHaveBeenCalledWith(id(31)));
  });

  it("Close position appears for dust only and calls close after confirmation", async () => {
    const alert = confirmAlert();
    mockApi.closePosition.mockResolvedValue(undefined);
    const dust = position(); dust.holdings = [{ ...dust.holdings[0]!, valueUsd: "0.40" }];
    await show(portfolio({ positions: [dust] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Close position" }));
    expect(alert).toHaveBeenCalled();
    await waitFor(() => expect(mockApi.closePosition).toHaveBeenCalledWith(id(31)));
  });

  it("no Close position for a normal-value position", async () => {
    await show(portfolio({ positions: [position()] }));
    await screen.findByText("Alpha Basket");
    expect(screen.queryByRole("button", { name: "Close position" })).toBeNull();
  });

  it("an action error is shown in words", async () => {
    confirmAlert();
    const { ApiError } = jest.requireActual("@repo/api-client");
    mockApi.leavePosition.mockRejectedValue(new ApiError("OPERATION_IN_PROGRESS", 409, "x"));
    await show(portfolio({ positions: [position()] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Leave basket (keep assets)" }));
    expect(await screen.findByRole("alert")).toBeOnTheScreen();
  });

  it("Sell opens the sell screen; former positions sell what is left; operations list and history open the detail", async () => {
    const open = operation({ status: "IN_PROGRESS" });
    const old = operation({ id: id(7), status: "COMPLETED", legs: [leg({ status: "SETTLED" })] });
    await show(portfolio({ positions: [position()], formerPositions: [position({ id: id(34), status: "CLOSED", closedAt: "2026-09-10T00:00:00.000Z", basketName: "Old Basket" })], openOperations: [open], history: [old] }));
    await fireEvent.press((await screen.findAllByRole("button", { name: "Sell to USDC" }))[0]!);
    expect(router.push).toHaveBeenCalledWith(`/sell/${id(31)}`);
    expect(screen.getByRole("button", { name: "Sell former assets" })).toBeOnTheScreen();
    expect(screen.getByText("Old Basket")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Investment, In progress" }));
    expect(router.push).toHaveBeenCalledWith(`/operation/${id(1)}`);
    await fireEvent.press(screen.getByRole("link", { name: "Investment, Completed" }));
    expect(router.push).toHaveBeenCalledWith(`/operation/${id(7)}`);
  });
});
