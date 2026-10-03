import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buyLeg, feeLeg, operation, position, renderApp } from "./invest-fixtures";

const getPortfolio = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getPortfolio: () => getPortfolio() } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import PortfolioPage from "@/app/(app)/portfolio/page";

const show = (p: object) => {
  getPortfolio.mockResolvedValue({ positions: [], formerPositions: [], openOperations: [], history: [], ...p });
  renderApp(<PortfolioPage />);
};

beforeEach(() => vi.clearAllMocks());

describe("Portfolio", () => {
  it("gives each operation an id the mobile handoff can link to and scrolls to it on load", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const open = operation();
    const done = { ...operation({ status: "COMPLETED" }), id: "0192f1c2-7a4b-7c3d-8e9f-000000000099" };
    window.history.replaceState(null, "", `/portfolio#operation-${done.id}`);
    show({ openOperations: [open], history: [done] });
    await screen.findByText("Open operations");
    expect(document.getElementById(`operation-${open.id}`)).toBeInTheDocument();
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(document.getElementById(`operation-${done.id}`));
    window.history.replaceState(null, "", "/");
  });


  it("shows an open position with its value, actual against target weights and exit actions", async () => {
    show({ positions: [position()] });
    const link = await screen.findByRole("link", { name: "Core Crypto" });
    expect(link).toHaveAttribute("href", "/baskets/core-crypto");
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(screen.getByText("0.03 ETH")).toBeInTheDocument();
    expect(screen.getAllByText("Actual")).toHaveLength(2);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getAllByText("50%")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Leave basket (keep assets)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell to USDC" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close position" })).toBeNull();
  });

  it("offers Close position only for a position worth under $1", async () => {
    const p = position();
    p.holdings = p.holdings.map((h) => ({ ...h, valueUsd: "0.40" }));
    show({ positions: [p] });
    expect(await screen.findByRole("button", { name: "Close position" })).toBeInTheDocument();
  });

  it("a SHORT holding gets a notice that nothing is bought or sold automatically", async () => {
    const p = position();
    p.holdings[0] = { ...p.holdings[0]!, reconciliation: "SHORT" };
    show({ positions: [p] });
    expect(await screen.findByText(/Your wallet holds less ETH than Bytesac recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is bought or sold automatically/)).toBeInTheDocument();
    expect(screen.getByText("Wallet holds less than recorded")).toBeInTheDocument();
  });

  it("a SURPLUS holding is described as outside the baskets", async () => {
    const p = position();
    p.holdings[1] = { ...p.holdings[1]!, reconciliation: "SURPLUS" };
    show({ positions: [p] });
    expect(await screen.findByText(/Extra SOL in your wallet is outside your baskets/)).toBeInTheDocument();
  });

  it("former positions offer to sell the former assets and have no Leave", async () => {
    show({ formerPositions: [position({ status: "CLOSED", closedAt: "2026-10-02T00:00:00.000Z" })] });
    const section = await screen.findByRole("region", { name: "Former positions" });
    expect(within(section).getByRole("button", { name: "Sell former assets" })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /Leave basket/ })).toBeNull();
    expect(within(section).getByText(/outside the basket/)).toBeInTheDocument();
  });

  it("lists open operations to continue and a history with leg details", async () => {
    show({
      openOperations: [operation({ status: "IN_PROGRESS" })],
      history: [operation({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e21", status: "COMPLETED", legs: [feeLeg({ status: "SETTLED", sourceTx: "5xTx" }), buyLeg({ status: "SETTLED", destinationTx: "0xdest" })] })],
    });
    const open = await screen.findByRole("region", { name: "Open operations" });
    expect(within(open).getByRole("button", { name: "Continue" })).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByText("Completed")).toBeInTheDocument();
    expect(within(history).getByRole("link", { name: /Destination transaction/ })).toHaveAttribute("href", "https://etherscan.io/tx/0xdest");
    expect(within(history).queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("with nothing yet it says so", async () => {
    show({});
    expect(await screen.findByText(/no open positions/)).toBeInTheDocument();
  });
});
