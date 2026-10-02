import { ApiError } from "@repo/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buyLeg, feeLeg, ID, operation, position, renderApp, sellLeg } from "./invest-fixtures";

const getPortfolio = vi.fn();
const rebalance = vi.fn();
const skipVersion = vi.fn();
const push = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getPortfolio: () => getPortfolio(), rebalance: (b: unknown) => rebalance(b), skipVersion: (...a: unknown[]) => skipVersion(...a), cancelOperation: vi.fn() } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { RebalanceReview } from "@/components/portfolio/rebalance-review";

const diff = { added: [], removed: [], changed: [{ instrumentId: ID(31), fromBps: 5000, toBps: 6000 }], bandChanged: [], constraints: false, rebalance: false, fees: false, minimums: false };
const latest = { id: ID(50), number: 3, rationale: "Lean into ETH", diff };
const show = (target: "latest" | "applied" = "latest") => {
  getPortfolio.mockResolvedValue({ positions: [position({ latestVersion: latest, appliedVersionNumber: 2 })], repairs: [{ asset: ID(30), symbol: "ETH", totalShortfall: "1", positions: [{ positionId: ID(40), basketSlug: "core-crypto", ledger: "5", shortfall: "1" }] }], formerPositions: [], openOperations: [], history: [] });
  renderApp(<RebalanceReview positionId={ID(40)} target={target} />);
};
const plan = (fromCash: boolean) => operation({ kind: "rebalance", positionId: ID(40), legs: [feeLeg({ routeSummary: { fromCash } }), sellLeg({ sequence: 2 }), buyLeg({ sequence: 3 })] });

beforeEach(() => vi.clearAllMocks());

describe("RebalanceReview", () => {
  it("shows version numbers, the manager's reason, the diff and current against target weights", async () => {
    show();
    expect(await screen.findByText("Version 2 to version 3")).toBeInTheDocument();
    expect(screen.getByText(/Lean into ETH/)).toBeInTheDocument();
    expect(screen.getByText("ETH: 50% to 60%")).toBeInTheDocument();
    expect(screen.getByText(/now 60% · target 50%/)).toBeInTheDocument();
  });

  it("creates a plan with sells, the fee source and buys, and sends an idempotency key", async () => {
    rebalance.mockResolvedValue(plan(true));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Create plan" }));
    expect(await screen.findByText(/paid from this basket's sale proceeds/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sells" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Buys" })).toBeInTheDocument();
    expect(screen.getByText("Buy amounts are resized to what your sales actually return.")).toBeInTheDocument();
    expect(screen.getByText("Fees are not refunded if the operation does not complete.")).toBeInTheDocument();
    expect(rebalance).toHaveBeenCalledWith(expect.objectContaining({ positionId: ID(40), target: "latest", idempotencyKey: expect.any(String) }));
  });

  it("names free USDC as the fee source when the fee is not taken from cash", async () => {
    rebalance.mockResolvedValue(plan(false));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Create plan" }));
    expect(await screen.findByText(/paid from your free USDC/)).toBeInTheDocument();
  });

  it("an aligned response is recorded without a plan", async () => {
    rebalance.mockResolvedValue({ aligned: true });
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Create plan" }));
    expect(await screen.findByText("Already aligned with this version — recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to signing" })).toBeNull();
  });

  it("Skip records the newest version and says nothing changes in the wallet", async () => {
    skipVersion.mockResolvedValue(undefined);
    show();
    expect(await screen.findByText("Skipping changes nothing in your wallet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip this version" }));
    expect(skipVersion).toHaveBeenCalledWith(ID(40), { versionId: ID(50) });
  });

  it("the applied target has no Skip", async () => {
    show("applied");
    await screen.findByRole("button", { name: "Create plan" });
    expect(screen.queryByRole("button", { name: "Skip this version" })).toBeNull();
  });

  it("REPAIR_REQUIRED shows the message and a link to the repair page", async () => {
    rebalance.mockRejectedValue(new ApiError("REPAIR_REQUIRED", 409, "x"));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Create plan" }));
    expect(await screen.findByText("Wallet holdings changed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to repair" })).toHaveAttribute("href", `/portfolio/repair/${ID(30)}`);
  });
});
