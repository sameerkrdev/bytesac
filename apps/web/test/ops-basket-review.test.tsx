import { ApiError } from "@repo/api-client";
import { REVIEW_CHECKLIST_KEYS } from "@repo/validator";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BasketDecisionForm, BasketReview } from "@/components/ops/baskets/basket-review";
import { BasketsQueue } from "@/components/ops/baskets/baskets-queue";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderAs } from "./asset-fixtures";
import { BID, T, basketAssignment, basketVersion, opsBasketDetail } from "./org-fixtures";

const LABELS = ["A. Completeness", "B. Assets", "C. Allocation", "D. Communication", "E. Managers", "F. Fees", "G. Operations"];
const fillChecklist = async () => { for (const l of LABELS) await userEvent.selectOptions(screen.getByLabelText(l), "pass"); };
const client = (over: Record<string, unknown> = {}) => ({
  opsGetBasket: vi.fn().mockResolvedValue(opsBasketDetail()), opsDecideBasketVersion: vi.fn().mockResolvedValue(opsBasketDetail()), opsDecideBasketLead: vi.fn().mockResolvedValue(opsBasketDetail()),
  opsPauseBasket: vi.fn(), opsResumeBasket: vi.fn(), opsRetireBasket: vi.fn(), opsDecideBasketRetirement: vi.fn(), ...over,
});
const confirm = async (open: string) => {
  await userEvent.click(screen.getByRole("button", { name: open }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
};

describe("Basket decision form", () => {
  it("approve is offered to admins only", () => {
    const { unmount } = render(<BasketDecisionForm isAdmin={false} pending={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("option", { name: "Approve" })).toBeNull();
    unmount();
    render(<BasketDecisionForm isAdmin pending={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Approve" })).toBeInTheDocument();
  });

  it("changes required and reject need a message for the manager", async () => {
    const onSubmit = vi.fn();
    render(<BasketDecisionForm isAdmin={false} pending={false} onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", { name: "Submit decision" });
    await fillChecklist();
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "changes_required");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Message to manager (required)"), "Fix the weights");
    expect(submit).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "rejected");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ decision: "rejected", messageToManager: "Fix the weights" }));
    const body = onSubmit.mock.calls[0]![0];
    expect(Object.keys(body.checklist)).toEqual([...REVIEW_CHECKLIST_KEYS]);
  });

  it("escalation needs an internal note, which is never sent as a message", async () => {
    const onSubmit = vi.fn();
    render(<BasketDecisionForm isAdmin={false} pending={false} onSubmit={onSubmit} />);
    await fillChecklist();
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "escalated");
    expect(screen.getByRole("button", { name: "Submit decision" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Internal note \(required/), "Needs legal");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ decision: "escalated", internalNote: "Needs legal", messageToManager: undefined }));
  });

  it("needs every checklist line answered and carries section comments", async () => {
    const onSubmit = vi.fn();
    render(<BasketDecisionForm isAdmin pending={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "approved");
    expect(screen.getByRole("button", { name: "Submit decision" })).toBeDisabled();
    await fillChecklist();
    await userEvent.selectOptions(screen.getByLabelText("Section"), "fees");
    await userEvent.type(screen.getByLabelText("Comment"), "Check the fee");
    await userEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved", sectionComments: [{ section: "fees", comment: "Check the fee" }] }));
  });
});

describe("Basket review", () => {
  it("shows the snapshot, internal notes labelled Internal, and hides Approve from a reviewer", async () => {
    const reviews = [{ id: "r1", versionId: basketVersion().id, decision: "escalated" as const, checklist: {}, sectionComments: [], messageToManager: null, createdAt: T, reviewerUserId: "u", internalNote: "Legal to look", reviewedHash: "h" }];
    renderAs(<BasketReview bid={BID} client={client({ opsGetBasket: vi.fn().mockResolvedValue(opsBasketDetail({ reviews })) })} />, ["ops_reviewer"]);
    expect(await screen.findByRole("heading", { name: "Core Crypto" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Snapshot" })).toHaveTextContent("Solana");
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.getByText("Legal to look")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Approve" })).toBeNull();
  });

  it("shows the diff against the published version", async () => {
    const diff = { added: [], removed: [], changed: [{ instrumentId: basketVersion().assets[0]!.instrumentId, fromBps: 5000, toBps: 6000 }], bandChanged: [], constraints: false, rebalance: false, fees: true, minimums: false };
    renderAs(<BasketReview bid={BID} client={client({ opsGetBasket: vi.fn().mockResolvedValue(opsBasketDetail({ diff })) })} />, ["ops_admin"]);
    const region = await screen.findByRole("region", { name: "Changes from the published version" });
    expect(region).toHaveTextContent("Solana (SOL): 50% to 60%");
    expect(region).toHaveTextContent("Fees changed");
  });

  it("tells a reviewer from the organization they cannot decide on it (403)", async () => {
    const opsDecideBasketVersion = vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "You can't review your own organization."));
    renderAs(<BasketReview bid={BID} client={client({ opsDecideBasketVersion })} />, ["ops_reviewer"]);
    await screen.findByRole("heading", { name: "Core Crypto" });
    await fillChecklist();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Decision" }), "changes_required");
    await userEvent.type(screen.getByLabelText("Message to manager (required)"), "Please fix");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't review your own organization.");
  });

  it("an admin approves a pending lead after confirming", async () => {
    const pending = basketAssignment({ id: "lead-2", displayName: "Sam Lead", status: "PENDING_APPROVAL", isSelf: false });
    const opsDecideBasketLead = vi.fn().mockResolvedValue(opsBasketDetail());
    renderAs(<BasketReview bid={BID} client={client({ opsGetBasket: vi.fn().mockResolvedValue(opsBasketDetail({ assignments: [basketAssignment({ isSelf: false }), pending] })), opsDecideBasketLead })} />, ["ops_admin"]);
    await screen.findByRole("region", { name: "Lead approval" });
    await confirm("Approve lead");
    expect(opsDecideBasketLead).toHaveBeenCalledWith(BID, "lead-2", { decision: "approved" });
  });

  it("a reviewer sees the pending lead but no approve control", async () => {
    const pending = basketAssignment({ id: "lead-2", displayName: "Sam Lead", status: "PENDING_APPROVAL", isSelf: false });
    renderAs(<BasketReview bid={BID} client={client({ opsGetBasket: vi.fn().mockResolvedValue(opsBasketDetail({ assignments: [pending] })) })} />, ["ops_reviewer"]);
    const card = await screen.findByRole("region", { name: "Lead approval" });
    expect(card).toHaveTextContent("Only an ops admin can decide.");
    expect(screen.queryByRole("button", { name: "Approve lead" })).toBeNull();
  });
});

describe("Baskets queue", () => {
  it("lists the queue and switches tabs", async () => {
    const opsListBaskets = vi.fn().mockResolvedValue({ items: [{ id: BID, name: "Core Crypto", organizationId: "o", organizationName: "Ada Capital", status: "DRAFT", latestVersionNumber: 1, latestVersionStatus: "in_review", updatedAt: T }], nextCursor: null });
    render(<QueryClientProvider client={new QueryClient()}><BasketsQueue client={{ opsListBaskets }} /></QueryClientProvider>);
    expect(await screen.findByRole("link", { name: "Core Crypto" })).toHaveAttribute("href", `/ops/baskets/${BID}`);
    await userEvent.click(screen.getByRole("button", { name: "Retirements" }));
    expect(opsListBaskets).toHaveBeenLastCalledWith({ queue: "retirements", cursor: undefined });
  });

  it("says when the queue is empty and shows the access-lost message on 403", async () => {
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><BasketsQueue client={{ opsListBaskets: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) }} /></QueryClientProvider>);
    expect(await screen.findByText("No baskets found.")).toBeInTheDocument();
    unmount();
    render(<QueryClientProvider client={new QueryClient()}><BasketsQueue client={{ opsListBaskets: vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")) }} /></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role may have been removed");
  });
});
