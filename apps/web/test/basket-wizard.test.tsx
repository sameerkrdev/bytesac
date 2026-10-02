import { ApiError } from "@repo/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BasketWizard } from "@/components/baskets/basket-wizard";
import { BID, T, basketAsset, basketAssignment, basketClient, basketDetail, basketVersion } from "./org-fixtures";

const wizard = (client: ReturnType<typeof basketClient>) => render(<QueryClientProvider client={new QueryClient()}><BasketWizard bid={BID} client={client} /></QueryClientProvider>);

describe("Basket wizard", () => {
  it("saves optional minimum-trade thresholds and flags values outside the bounds", async () => {
    const client = basketClient();
    wizard(client);
    await userEvent.click(await screen.findByRole("button", { name: /Rebalanc/ }));
    const bps = screen.getByLabelText(/Minimum trade \(bps\)/);
    await userEvent.type(bps, "5");
    expect(screen.getByText("Enter a whole number from 10 to 1000.")).toBeInTheDocument();
    await userEvent.clear(bps);
    await userEvent.type(bps, "75");
    expect(screen.queryByText("Enter a whole number from 10 to 1000.")).toBeNull();
    const usdc = screen.getByLabelText(/Minimum trade \(USDC\)/);
    await userEvent.type(usdc, "500");
    expect(screen.getByText(/between 1 and 100 USDC/)).toBeInTheDocument();
    await userEvent.clear(usdc);
    await userEvent.type(usdc, "10");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(client.saveBasketDraft).toHaveBeenCalledWith(BID, expect.objectContaining({ rebalance: expect.objectContaining({ minTradeBps: 75, minTradeUsdc: "10" }) }));
  });

  it("saves with the version's updatedAt as expectedUpdatedAt", async () => {
    const client = basketClient();
    wizard(client);
    const name = await screen.findByLabelText("Name");
    await userEvent.type(name, " II");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(client.saveBasketDraft).toHaveBeenCalledWith(BID, expect.objectContaining({ name: "Core Crypto II", expectedUpdatedAt: T }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the conflict banner on VERSION_CONFLICT and reloads on request", async () => {
    const client = basketClient({ saveBasketDraft: vi.fn().mockRejectedValue(new ApiError("VERSION_CONFLICT", 409, "conflict")) });
    wizard(client);
    await userEvent.type(await screen.findByLabelText("Name"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This draft changed since you opened it. Reload to continue.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(client.getBasket).toHaveBeenCalledTimes(2);
  });

  it("groups validation issues by section in Review & preview", async () => {
    const version = basketVersion({ strategyRisks: null, assets: [basketAsset(), basketAsset({ instrumentId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5004", name: "Ether", symbol: "ETH", targetWeightBps: 3000 })] });
    wizard(basketClient({ getBasket: vi.fn().mockResolvedValue(basketDetail({ openVersion: version })) }));
    await userEvent.click(await screen.findByRole("button", { name: /Review & preview/ }));
    const panel = screen.getByRole("region", { name: "Validation" });
    expect(within(panel).getByText("Assets & allocation")).toBeInTheDocument();
    expect(within(panel).getByText("Risks & disclosures")).toBeInTheDocument();
    expect(within(panel).getByText(/Weights add up to 90%/)).toBeInTheDocument();
    expect(within(panel).getByText(/Describe the strategy's risks/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("labels the preview as not public", async () => {
    wizard(basketClient());
    await userEvent.click(await screen.findByRole("button", { name: /Review & preview/ }));
    expect(await screen.findByText("Preview — not public")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Allocation" })).toBeInTheDocument();
  });

  it("shows the reviewer's section comments beside the section", async () => {
    const reviews = [{ id: "r1", versionId: basketVersion().id, decision: "changes_required" as const, checklist: {}, sectionComments: [{ section: "thesis" as const, comment: "Explain the thesis more" }], messageToManager: "Please fix", createdAt: T }];
    wizard(basketClient({ getBasket: vi.fn().mockResolvedValue(basketDetail({ openVersion: basketVersion({ status: "changes_required" }), reviews })) }));
    expect(await screen.findByText("Please fix")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Thesis/ }));
    expect(screen.getByText("Explain the thesis more")).toBeInTheDocument();
  });

  it("shows Awaiting platform approval beside a pending lead", async () => {
    const pending = { ...basketDetail().assignments[0]!, id: "a2", displayName: "Sam Lead", status: "PENDING_APPROVAL" as const, isSelf: false };
    wizard(basketClient({ getBasket: vi.fn().mockResolvedValue(basketDetail({ assignments: [basketDetail().assignments[0]!, pending] })) }));
    await userEvent.click(await screen.findByRole("button", { name: /^Managers/ }));
    expect(within(screen.getByRole("list", { name: "Managers" })).getByText("Awaiting platform approval")).toBeInTheDocument();
  });

  it("hides the lead controls from a co-manager with assign, and self-edit and self-end-lead from everyone", async () => {
    const lead = basketAssignment({ id: "a-lead", displayName: "Lead Person", isSelf: false });
    const me = basketAssignment({ id: "a-me", membershipId: "m-me", displayName: "Me", role: "co_manager", permissions: ["edit", "assign"], isSelf: true });
    const other = basketAssignment({ id: "a-other", membershipId: "m-other", displayName: "Other", role: "co_manager", permissions: ["edit", "submit"], isSelf: false });
    const view = wizard(basketClient({ getBasket: vi.fn().mockResolvedValue(basketDetail({ myPermissions: ["edit", "assign"], canControlLead: false, assignments: [lead, me, other] })) }));
    await userEvent.click(await screen.findByRole("button", { name: /^Managers/ }));
    const rows = within(screen.getByRole("list", { name: "Managers" })).getAllByRole("listitem");
    expect(within(rows[0]!).queryByRole("button", { name: "End assignment" })).toBeNull();
    expect(within(rows[1]!).getByRole("button", { name: "End assignment" })).toBeInTheDocument();
    expect(within(rows[1]!).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(rows[2]!).getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.queryByRole("option", { name: "Lead" })).toBeNull();
    view.unmount();

    wizard(basketClient({ getBasket: vi.fn().mockResolvedValue(basketDetail({ assignments: [basketAssignment({ isSelf: true })] })) }));
    await userEvent.click(await screen.findByRole("button", { name: /^Managers/ }));
    expect(within(screen.getByRole("list", { name: "Managers" })).queryByRole("button", { name: "End assignment" })).toBeNull();
    expect(screen.getByRole("option", { name: "Lead" })).toBeInTheDocument();
  });
});
