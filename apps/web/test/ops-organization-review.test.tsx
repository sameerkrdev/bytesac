import { ApiError } from "@repo/api-client";
import { ORGANIZATION_TRANSITIONS, type OrganizationReviewDetail } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizationReviewView, OrganizationTransitionForm } from "@/components/ops/organization-review";
import { ORG_ID, version } from "./org-fixtures";

const T = "2026-09-29T00:00:00.000Z";
const detail = (over: Partial<OrganizationReviewDetail> = {}): OrganizationReviewDetail => ({
  id: ORG_ID, type: "individual", status: "UNDER_REVIEW", jurisdiction: "GB", currentVersionId: null, submittedAt: T, verifiedAt: null, decidedByUserId: null, createdAt: T,
  owner: { userId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", addresses: [{ chain: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T" }] },
  versions: [version({ status: "in_review", publicProfile: { displayName: "Ada Capital" }, privateDetails: { legalName: "Ada Lovelace" } })],
  documents: [{ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", documentType: "government_id", contentType: "application/pdf", sizeBytes: 2048, status: "uploaded", uploadedAt: T, versionIds: [] }],
  payoutWallets: [], events: [{ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e71", actorType: "ops", actorUserId: null, kind: "note", fromStatus: null, toStatus: null, versionId: null, payoutWalletId: null, decision: null, internalNote: "Looks fine", messageToOwner: null, createdAt: T }],
  template: { requiredFields: [], requiredDocuments: [] }, ...over,
});
const view = (opsGetOrganization: () => Promise<OrganizationReviewDetail>) =>
  render(<QueryClientProvider client={new QueryClient()}><OrganizationReviewView id={ORG_ID} client={{ opsGetOrganization, opsTransitionOrganization: vi.fn(), opsDecideOrganizationVersion: vi.fn(), opsDecidePayoutWallet: vi.fn(), opsAddOrganizationNote: vi.fn() }} /></QueryClientProvider>);

describe("OrganizationTransitionForm", () => {
  it("offers only the allowed targets for the status", () => {
    render(<OrganizationTransitionForm status="UNDER_REVIEW" pending={false} onSubmit={vi.fn()} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Select a status", "Changes required", "Verified", "Not approved"]);
    expect(ORGANIZATION_TRANSITIONS.UNDER_REVIEW).toHaveLength(3);
  });

  it("offers nothing for terminal statuses", () => {
    render(<OrganizationTransitionForm status="REJECTED" pending={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("requires a message to the owner for changes required", async () => {
    const onSubmit = vi.fn();
    render(<OrganizationTransitionForm status="UNDER_REVIEW" pending={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Move to"), "CHANGES_REQUIRED");
    expect(screen.getByRole("button", { name: "Update status" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Message to owner/), "Clearer ID please");
    await userEvent.click(screen.getByRole("button", { name: "Update status" }));
    expect(onSubmit).toHaveBeenCalledWith({ to: "CHANGES_REQUIRED", internalNote: undefined, messageToOwner: "Clearer ID please" });
  });
});

describe("OrganizationReviewView", () => {
  it("shows panels from catalog labels, a download link and marks internal notes", async () => {
    view(async () => detail());
    expect(await screen.findByRole("heading", { name: "Ada Capital" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Public profile" })).toHaveTextContent("Display name");
    expect(screen.getByRole("region", { name: "Private details" })).toHaveTextContent("Legal nameAda Lovelace");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/api/v1/ops/organizations/${ORG_ID}/documents/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70/download`);
    expect(screen.getByText("Internal")).toBeInTheDocument();
  });

  it("shows the access-lost state on 403", async () => {
    view(async () => { throw new ApiError("FORBIDDEN", 403, "no"); });
    expect(await screen.findByText(/Your role may have been removed/)).toBeInTheDocument();
  });
});
