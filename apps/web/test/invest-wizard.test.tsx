import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { operation, renderApp } from "./invest-fixtures";

const api = { investPlan: vi.fn(), cancelOperation: vi.fn(), getOperation: vi.fn() };
vi.mock("@/lib/api", () => ({ api: { investPlan: (b: unknown) => api.investPlan(b), cancelOperation: (id: string) => api.cancelOperation(id), getOperation: (id: string) => api.getOperation(id) } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import { InvestWizard } from "@/components/invest/invest-wizard";

const open = () => renderApp(<InvestWizard basketId="b" name="Core Crypto" minimumUsdc="250" incrementUsdc="50" open onOpenChange={() => undefined} />);
const amount = () => screen.getByLabelText("Amount (USDC on Solana)");
const slippage = () => screen.getByLabelText("Slippage tolerance (%)");
const preview = () => screen.getByRole("button", { name: "Get preview" });
const type = async (el: HTMLElement, value: string) => { await userEvent.clear(el); await userEvent.type(el, value); };

beforeEach(() => vi.clearAllMocks());

describe("InvestWizard", () => {
  it("starts at the minimum and enforces minimum and increment", async () => {
    open();
    expect(amount()).toHaveValue("250");
    expect(preview()).toBeEnabled();
    await type(amount(), "100");
    expect(screen.getByText("The minimum is 250 USDC.")).toBeInTheDocument();
    expect(preview()).toBeDisabled();
    await type(amount(), "275");
    expect(screen.getByText("The amount must be a multiple of 50 USDC.")).toBeInTheDocument();
    expect(preview()).toBeDisabled();
    await type(amount(), "300.5");
    expect(preview()).toBeDisabled();
    await type(amount(), "300");
    expect(preview()).toBeEnabled();
  });

  it("slippage defaults to 1% and must stay between 0.01% and 3%", async () => {
    open();
    expect(slippage()).toHaveValue("1");
    await type(slippage(), "3");
    expect(preview()).toBeEnabled();
    await type(slippage(), "3.01");
    expect(screen.getByText("Slippage must be between 0.01% and 3%.")).toBeInTheDocument();
    expect(preview()).toBeDisabled();
    await type(slippage(), "0");
    expect(preview()).toBeDisabled();
  });

  it("the preview lists the legs, the fees and the no-refund note", async () => {
    api.investPlan.mockResolvedValue(operation());
    open();
    await type(slippage(), "2");
    await userEvent.click(preview());
    expect(api.investPlan).toHaveBeenCalledWith({ basketId: "b", amountUsdc: "250", slippageBps: 200, idempotencyKey: expect.any(String) });
    expect(await screen.findByText("Network fee (paid to Bytesac for gas)")).toBeInTheDocument();
    expect(screen.getByText("Fees are not refunded if the operation does not complete.")).toBeInTheDocument();
    expect(screen.getByText("1. Fees")).toBeInTheDocument();
    expect(screen.getByText("2. Buy ETH")).toBeInTheDocument();
    expect(screen.getByText("99.93 USDC → about 0.03 ETH (at least 0.0297 ETH)")).toBeInTheDocument();
  });

  it("going back discards the plan so another can be made", async () => {
    api.investPlan.mockResolvedValue(operation());
    api.cancelOperation.mockResolvedValue(operation({ status: "CANCELLED" }));
    open();
    await userEvent.click(preview());
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(api.cancelOperation).toHaveBeenCalledWith(operation().id);
    expect(await screen.findByRole("button", { name: "Get preview" })).toBeInTheDocument();
  });

  it("a plan refused by the server shows its reason", async () => {
    const { ApiError } = await import("@repo/api-client");
    api.investPlan.mockRejectedValue(new ApiError("INSUFFICIENT_BALANCE", 409, "no"));
    open();
    await userEvent.click(preview());
    expect(await screen.findByText("Not enough USDC")).toBeInTheDocument();
  });
});
