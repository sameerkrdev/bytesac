import { ApiError } from "@repo/api-client";
import type { MemberReviewDetail, MemberReviewSummary } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemberDecisionForm, MemberReview } from "@/components/ops/member-review";
import { MembersTable } from "@/components/ops/members-table";

const T = "2026-09-29T00:00:00.000Z";
const ORG = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", displayName: "Ada Capital" };
const MID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70";

const summary = (over: Partial<MemberReviewSummary> = {}): MemberReviewSummary => ({
  id: MID, organization: ORG, publicDisplayName: null, role: "MANAGER", requestedRole: null, status: "UNDER_REVIEW", verificationStatus: "in_review", submittedAt: T, updatedAt: T, ...over,
});
const queue = (items: MemberReviewSummary[]) => ({ opsListMembers: vi.fn().mockResolvedValue({ items, nextCursor: null }) });
const table = (c: ReturnType<typeof queue>) => render(<QueryClientProvider client={new QueryClient()}><MembersTable client={c} /></QueryClientProvider>);

const detail = (over: Partial<MemberReviewDetail> = {}): MemberReviewDetail => ({
  id: MID, organization: { ...ORG, status: "VERIFIED" }, userId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", addresses: [{ chain: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T" }],
  role: "MANAGER", requestedRole: null, status: "UNDER_REVIEW",
  verification: {
    id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e80", status: "in_review", details: { legalName: "Grace Hopper", dateOfBirth: "1985-12-09" }, submittedAt: T,
    documents: [{ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e81", documentType: "government_id", contentType: "application/pdf", sizeBytes: 2048, status: "uploaded", uploadedAt: T }],
  },
  events: [
    { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e82", actorType: "ops", actorUserId: null, kind: "verification_decided", fromStatus: "UNDER_REVIEW", toStatus: "CHANGES_REQUIRED", fromRole: null, toRole: null, decision: "changes_required", messageToMember: "Clearer ID", internalNote: "blurry scan", reason: null, createdAt: T },
  ],
  ...over,
});
const review = (c: Record<string, unknown>) => render(<QueryClientProvider client={new QueryClient()}><MemberReview mid={MID} client={{ opsGetMember: vi.fn().mockResolvedValue(detail()), opsDecideMember: vi.fn(), ...c }} /></QueryClientProvider>);

describe("Ops members queue", () => {
  it("renders new and role-upgrade entries with name or a dash", async () => {
    table(queue([summary(), summary({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e71", status: "ACTIVE", role: "ANALYST", requestedRole: "ADMIN", publicDisplayName: "Sam Analyst" })]));
    expect((await screen.findAllByText("Ada Capital")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Manager").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Analyst → Admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sam Analyst").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Ada Capital" })[0]).toHaveAttribute("href", `/ops/members/${MID}`);
  });

  it("an empty queue says so", async () => {
    table(queue([]));
    expect(await screen.findByText("No members found.")).toBeInTheDocument();
  });

  it("a revoked role shows the access-lost message", async () => {
    table({ opsListMembers: vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role may have been removed");
  });
});

describe("MemberDecisionForm", () => {
  it("requires a message for changes required", async () => {
    const onSubmit = vi.fn();
    render(<MemberDecisionForm pending={false} onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", { name: "Submit decision" });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "changes_required");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Message to member (required)"), "Upload a clearer ID");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ decision: "changes_required", messageToMember: "Upload a clearer ID", internalNote: undefined });
  });

  it("approval needs no message", async () => {
    const onSubmit = vi.fn();
    render(<MemberDecisionForm pending={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "approved");
    await userEvent.type(screen.getByLabelText(/Internal note/), "ID checks out");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(onSubmit).toHaveBeenCalledWith({ decision: "approved", messageToMember: undefined, internalNote: "ID checks out" });
  });
});

describe("MemberReview", () => {
  it("shows details with catalog labels, documents with Download, and labels internal notes", async () => {
    review({});
    expect(await screen.findByRole("heading", { name: "Member of Ada Capital" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Verification details" })).toHaveTextContent("Legal nameGrace Hopper");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/api/v1/ops/members/${MID}/documents/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e81/download`);
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.getByText("blurry scan")).toBeInTheDocument();
  });

  it("submits the decision and shows the returned state", async () => {
    const decided = detail({ status: "ACTIVE", verification: { ...detail().verification!, status: "approved" } });
    const opsDecideMember = vi.fn().mockResolvedValue(decided);
    review({ opsDecideMember });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Decision" }), "approved");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(opsDecideMember).toHaveBeenCalledWith(MID, { decision: "approved", messageToMember: undefined, internalNote: undefined });
    expect(await screen.findByText("Nothing to decide: the member has no verification in review.")).toBeInTheDocument();
  });

  it("shows the access-lost state when the decision is refused with 403", async () => {
    review({ opsDecideMember: vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")) });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Decision" }), "rejected");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have access to this area");
  });
});
