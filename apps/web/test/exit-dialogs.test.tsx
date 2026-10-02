import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { feeLeg, ID, operation, position, renderApp, sellLeg } from "./invest-fixtures";

const api = { leavePosition: vi.fn(), sellPlan: vi.fn(), cancelOperation: vi.fn(), getOperation: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: {
    leavePosition: (id: string) => api.leavePosition(id), sellPlan: (b: unknown) => api.sellPlan(b),
    cancelOperation: (id: string) => api.cancelOperation(id), getOperation: (id: string) => api.getOperation(id),
  },
}));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import { LeaveDialog, SellDialog } from "@/components/portfolio/exit-dialogs";

const sellPlan = operation({ kind: "sell_to_usdc", sellPercent: 50, amountUsdc: null, legs: [sellLeg(), feeLeg({ id: ID(13), sequence: 2 })] });

beforeEach(() => vi.clearAllMocks());

describe("Leave basket", () => {
  it("explains that assets stay put, and closes the position only after confirming", async () => {
    api.leavePosition.mockResolvedValue(undefined);
    renderApp(<LeaveDialog position={position()} />);
    await userEvent.click(screen.getByRole("button", { name: "Leave basket (keep assets)" }));
    expect(await screen.findByText(/Your assets stay in your wallets. No transaction is made and nothing is sold/)).toBeInTheDocument();
    expect(api.leavePosition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Leave basket" }));
    expect(api.leavePosition).toHaveBeenCalledWith(ID(40));
  });
});

describe("Sell to USDC", () => {
  it("sells the chosen percent and previews the network fee taken from the proceeds", async () => {
    api.sellPlan.mockResolvedValue(sellPlan);
    renderApp(<SellDialog position={position()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sell to USDC" }));
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "50" } });
    expect(screen.getByLabelText("Percent to sell")).toHaveValue("50");
    await userEvent.click(screen.getByRole("button", { name: "Get preview" }));
    expect(api.sellPlan).toHaveBeenCalledWith({ positionId: ID(40), percent: 50, slippageBps: 100, idempotencyKey: expect.any(String) });
    expect(await screen.findByText("Network fee (paid to Bytesac for gas)")).toBeInTheDocument();
    expect(screen.getByText("Fees are taken from your proceeds.")).toBeInTheDocument();
    expect(screen.getByText("1. Sell ETH")).toBeInTheDocument();
    expect(screen.getByText("0.03 ETH → about 75 USDC (at least 74 USDC)")).toBeInTheDocument();
    expect(screen.getByText("2. Network fee")).toBeInTheDocument();
  });

  it("previews a fee that is paid first when the plan starts with it", async () => {
    api.sellPlan.mockResolvedValue(operation({ kind: "sell_to_usdc", sellPercent: 50, amountUsdc: null, legs: [feeLeg({ id: ID(13), sequence: 1 }), sellLeg({ sequence: 2 })] }));
    renderApp(<SellDialog position={position()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sell to USDC" }));
    await userEvent.click(await screen.findByRole("button", { name: "Get preview" }));
    expect(await screen.findByText("Fees are paid first from the USDC already in your wallet.")).toBeInTheDocument();
  });

  it("shows the server's own message when the network fee USDC is missing", async () => {
    const { ApiError } = await import("@repo/api-client");
    api.sellPlan.mockRejectedValue(new ApiError("INSUFFICIENT_BALANCE", 409, "Add at least $0.19 USDC on Solana to pay the network fee before selling assets on Ethereum."));
    renderApp(<SellDialog position={position()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sell to USDC" }));
    await userEvent.click(await screen.findByRole("button", { name: "Get preview" }));
    expect(await screen.findByText((text) => text === "Add at least $0.19 USDC on Solana to pay the network fee before selling assets on Ethereum.")).toBeInTheDocument();
  });

  it("only whole percents from 1 to 100 can be previewed", async () => {
    renderApp(<SellDialog position={position()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sell to USDC" }));
    const input = await screen.findByLabelText("Percent to sell");
    for (const bad of ["0", "101", "12.5", ""]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole("button", { name: "Get preview" })).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: "100" } });
    expect(screen.getByRole("button", { name: "Get preview" })).toBeEnabled();
  });

  it("a closed position sells its former assets", async () => {
    renderApp(<SellDialog position={position({ status: "CLOSED" })} />);
    expect(screen.getByRole("button", { name: "Sell former assets" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sell to USDC" })).toBeNull();
  });
});
