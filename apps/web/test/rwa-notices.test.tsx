import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchItem } from "./discovery-fixtures";
import { feeLeg, ID, operation, position, renderApp, sellLeg } from "./invest-fixtures";

const api = { sellPlan: vi.fn(), cancelOperation: vi.fn(), getOperation: vi.fn() };
vi.mock("@/lib/api", () => ({ api: { sellPlan: (b: unknown) => api.sellPlan(b), cancelOperation: (id: string) => api.cancelOperation(id), getOperation: (id: string) => api.getOperation(id) } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import { EligibilityNotices } from "@/components/eligibility/notices";
import { ResultsList } from "@/components/discovery/results-list";
import { SellDialog } from "@/components/portfolio/exit-dialogs";

const names = { a: "Fund (FND)", b: "Stock (STK)", c: "Bond (BND)", d: "Gold (GLD)", e: "Cash fund (CSH)" };
const row = (instrumentId: string, outcome: string) => ({ instrumentId, outcome, reason: "RULE" });

beforeEach(() => vi.clearAllMocks());

describe("Basket eligibility notices", () => {
  it("words each outcome and says nothing about allowed assets", () => {
    render(<EligibilityNotices names={names} eligibility={{ requirements: true, assets: [row("a", "RESTRICTED"), row("b", "KYC_REQUIRED"), row("c", "REVIEW_REQUIRED"), row("d", "DECLARATION_REQUIRED"), row("e", "ALLOWED")] }} />);
    expect(screen.getByText("Fund (FND): Not available in your region / for your investor status")).toBeInTheDocument();
    expect(screen.getByText("Stock (STK): Identity verification required — not available yet")).toBeInTheDocument();
    expect(screen.getByText("Bond (BND): Needs review — contact support")).toBeInTheDocument();
    expect(screen.getByText(/Gold \(GLD\): Declare your country/)).toBeInTheDocument();
    expect(screen.queryByText(/Cash fund/)).toBeNull();
  });

  it("a signed-out visitor sees one line", () => {
    render(<EligibilityNotices names={names} eligibility={{ requirements: true }} />);
    expect(screen.getByText("Some assets have eligibility requirements")).toBeInTheDocument();
  });

  it("shows nothing without tokenized assets or when everything is allowed", () => {
    const { container, rerender } = render(<EligibilityNotices names={names} eligibility={{ requirements: false }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<EligibilityNotices names={names} eligibility={{ requirements: true, assets: [row("a", "ALLOWED")] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Discovery badge", () => {
  it("marks a basket that holds tokenized assets and never hides it", () => {
    render(<ResultsList items={[searchItem({ hasEligibilityRequirements: true }), searchItem({ slug: "plain", name: "Plain" })]} />);
    expect(screen.getAllByText("Eligibility requirements")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Plain" })).toBeInTheDocument();
  });
});

describe("Sell dialog exclusions", () => {
  it("lists the assets left out of the sale with the server's notice", async () => {
    const notice = "You can't sell FND through Bytesac in your region; it stays in your wallet.";
    api.sellPlan.mockResolvedValue(operation({ kind: "sell_to_usdc", sellPercent: 100, amountUsdc: null, legs: [sellLeg(), feeLeg({ id: ID(13), sequence: 2 })], excluded: [{ instrumentId: ID(31), symbol: "FND", notice }] }));
    renderApp(<SellDialog position={position()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sell to USDC" }));
    await userEvent.click(await screen.findByRole("button", { name: "Get preview" }));
    expect(await screen.findByText(notice)).toBeInTheDocument();
  });
});
