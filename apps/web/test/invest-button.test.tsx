import type { Investability } from "@repo/validator";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ID, renderApp } from "./invest-fixtures";

const getInvestability = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getInvestability: (slug: string) => getInvestability(slug) } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import { InvestButton } from "@/components/invest/invest-button";

const inv = (o: Partial<Investability> = {}): Investability => ({
  basketId: ID(3), investable: true, reasons: [], requiredFamilies: ["solana", "evm", "bitcoin"], minimumUsdc: "250",
  eligibility: { eligible: true, reasons: [] }, ...o,
});
const show = (i: Investability) => {
  getInvestability.mockResolvedValue(i);
  renderApp(<InvestButton slug="core-crypto" name="Core Crypto" minimumUsdc="250" incrementUsdc="50" />);
};

describe("InvestButton", () => {
  it("an investable basket and an eligible user can invest, which opens the wizard", async () => {
    show(inv());
    await userEvent.click(await screen.findByRole("button", { name: "Invest" }));
    expect(getInvestability).toHaveBeenCalledWith("core-crypto");
    expect(await screen.findByText("Invest in Core Crypto")).toBeInTheDocument();
  });

  it("a basket that is not investable says why and cannot be invested in", async () => {
    show(inv({ investable: false, reasons: [{ code: "RWA_NOT_SUPPORTED", message: "TSLA: tokenized assets can't be invested in yet." }] }));
    expect(await screen.findByRole("button", { name: "Not investable yet" })).toBeDisabled();
    expect(screen.getByText("TSLA: tokenized assets can't be invested in yet.")).toBeInTheDocument();
  });

  it("a signed-out visitor is sent to sign in", async () => {
    show(inv({ eligibility: undefined }));
    expect(await screen.findByRole("link", { name: "Sign in to invest" })).toHaveAttribute("href", "/sign-in");
  });

  it("each missing step has an action link", async () => {
    show(inv({
      eligibility: {
        eligible: false,
        reasons: [
          { code: "PHONE_NOT_VERIFIED", message: "Verify your phone." }, { code: "EVM_ADDRESS_REQUIRED", message: "Link an EVM wallet." },
          { code: "BTC_ADDRESS_REQUIRED", message: "Link a Bitcoin wallet." }, { code: "OPERATION_IN_PROGRESS", message: "Finish or cancel your current operation first." },
        ],
      },
    }));
    expect(await screen.findByRole("button", { name: "Invest" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Verify your phone" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: "Link an EVM wallet" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: "Link a Bitcoin wallet" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: "Finish your current operation" })).toHaveAttribute("href", "/portfolio");
  });
});
