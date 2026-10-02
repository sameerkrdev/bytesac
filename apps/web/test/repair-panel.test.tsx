import { ApiError } from "@repo/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ID, position, renderApp } from "./invest-fixtures";

const getPortfolio = vi.fn();
const sync = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getPortfolio: () => getPortfolio(), sync: (b: unknown) => sync(b), repair: vi.fn(), cancelOperation: vi.fn() } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import { RepairPanel } from "@/components/portfolio/repair-panel";

const A = ID(60);
const B = ID(61);
const eth = { asset: ID(30), symbol: "ETH", totalShortfall: "10000000000000000", positions: [
  { positionId: A, basketSlug: "core", ledger: "20000000000000000", shortfall: "6000000000000000" },
  { positionId: B, basketSlug: "growth", ledger: "10000000000000000", shortfall: "4000000000000000" }] };
const cash = { asset: "cash", symbol: "USDC", totalShortfall: "3000000", positions: [{ positionId: A, basketSlug: "core", ledger: "5000000", shortfall: "3000000" }] };
const show = (r: object, asset: string) => {
  getPortfolio.mockResolvedValue({ positions: [position()], repairs: [r], formerPositions: [], openOperations: [], history: [] });
  renderApp(<RepairPanel asset={asset} />);
};

beforeEach(() => vi.clearAllMocks());

describe("RepairPanel", () => {
  it("lists the affected baskets with recorded, allocated and short amounts", async () => {
    show(eth, ID(30));
    expect(await screen.findByText(/Recorded 0.02 · allocated 0.014 · short 0.006/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy back" })).toBeInTheDocument();
  });

  it("Sync is prefilled pro-rata, shows the sum check and saves raw unit strings only when exact", async () => {
    sync.mockResolvedValue({ synced: [] });
    show(eth, ID(30));
    await userEvent.click(await screen.findByRole("button", { name: "Sync" }));
    const first = screen.getByLabelText(/core: reduce by/);
    const second = screen.getByLabelText(/growth: reduce by/);
    expect(first).toHaveValue("0.006");
    expect(second).toHaveValue("0.004");
    expect(screen.getByText("Must add up to 0.01 ETH")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.clear(first);
    await userEvent.type(first, "0.005");
    expect(save).toBeDisabled();
    await userEvent.clear(first);
    await userEvent.type(first, "0.007");
    await userEvent.clear(second);
    await userEvent.type(second, "0.003");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ asset: { deploymentId: ID(30) }, split: [{ positionId: A, quantity: "7000000000000000" }, { positionId: B, quantity: "3000000000000000" }] }));
  });

  it("SHORTFALL_CHANGED refreshes the figures and says so", async () => {
    sync.mockRejectedValue(new ApiError("SHORTFALL_CHANGED", 409, "x"));
    show(eth, ID(30));
    await userEvent.click(await screen.findByRole("button", { name: "Sync" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Your holdings changed — review the new figures")).toBeInTheDocument();
    expect(getPortfolio).toHaveBeenCalledTimes(2);
  });

  it("basket cash has no Buy back, only Sync", async () => {
    show(cash, "cash");
    expect(await screen.findByLabelText(/core: reduce by/)).toHaveValue("3");
    expect(screen.queryByRole("button", { name: "Buy back" })).toBeNull();
  });
});
