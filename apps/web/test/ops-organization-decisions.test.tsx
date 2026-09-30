import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizationChangeRequest } from "@/components/ops/organization-change-request";
import { OrganizationPayoutChange } from "@/components/ops/organization-payout-change";
import { version, wallet } from "./org-fixtures";

const doc = (id: string, documentType: string) => ({ id, documentType, contentType: "application/pdf", sizeBytes: 1, status: "uploaded" as const, uploadedAt: null });
const current = version({ status: "approved", publicProfile: { displayName: "Ada Capital", about: "Same about text for both versions." }, documents: [doc("0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e71", "government_id")] });
const proposed = version({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e65", versionNumber: 2, status: "in_review", publicProfile: { displayName: "Ada Partners", about: "Same about text for both versions." },
  documents: [doc("0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e72", "proof_of_address")] });

describe("OrganizationChangeRequest", () => {
  it("marks changed rows with text and lists added and removed documents", () => {
    render(<OrganizationChangeRequest current={current} proposed={proposed} pending={false} onDecide={vi.fn()} />);
    const changed = screen.getByRole("row", { name: /Display name/ });
    expect(within(changed).getByText("Changed")).toBeInTheDocument();
    expect(within(changed).getByText("Ada Capital")).toBeInTheDocument();
    expect(within(changed).getByText("Ada Partners")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /About/ })).queryByText("Changed")).toBeNull();
    expect(screen.getByText("Added: Proof of address")).toBeInTheDocument();
    expect(screen.getByText("Removed: Government ID")).toBeInTheDocument();
  });

  it("approves, and needs a message to request changes", async () => {
    const onDecide = vi.fn();
    render(<OrganizationChangeRequest current={current} proposed={proposed} pending={false} onDecide={onDecide} />);
    expect(screen.getByRole("button", { name: "Request changes" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Message to owner/), "Explain the rename");
    await userEvent.click(screen.getByRole("button", { name: "Request changes" }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "changes_required", internalNote: undefined, messageToOwner: "Explain the rename" });
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: "approved", internalNote: undefined, messageToOwner: "Explain the rename" });
  });

  it("offers no decision once changes were already requested", () => {
    render(<OrganizationChangeRequest current={current} proposed={{ ...proposed, status: "changes_required" }} pending={false} onDecide={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("OrganizationPayoutChange", () => {
  it("shows both wallets and calls the decision with the note", async () => {
    const onDecide = vi.fn();
    const cur = wallet({ status: "VERIFIED", verifiedAt: "2026-09-29T00:00:00.000Z" });
    const next = wallet({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e64", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", status: "REPLACEMENT_PENDING", verifiedAt: "2026-09-30T00:00:00.000Z" });
    render(<OrganizationPayoutChange current={cur} proposed={next} pending={false} onDecide={onDecide} />);
    expect(screen.getByText(cur.address)).toBeInTheDocument();
    expect(screen.getByText(next.address)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Internal note/), "Checked on chain");
    await userEvent.click(screen.getByRole("button", { name: "Approve wallet change" }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "approved", internalNote: "Checked on chain" });
    await userEvent.click(screen.getByRole("button", { name: "Reject wallet change" }));
    expect(onDecide).toHaveBeenLastCalledWith({ decision: "rejected", internalNote: "Checked on chain" });
  });
});
