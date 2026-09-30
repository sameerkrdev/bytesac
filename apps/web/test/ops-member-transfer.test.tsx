import { ApiError } from "@repo/api-client";
import type { MeResponse, OrganizationReviewDetail } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/components/me-context";
import { TransferOwnership } from "@/components/ops/transfer-ownership";
import { ORG_ID } from "./org-fixtures";

const T = "2026-09-29T00:00:00.000Z";
const TARGET = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e91";
const org = { id: ORG_ID, members: [
  { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e90", role: "OWNER", status: "ACTIVE", publicDisplayName: "Olga", verificationApproved: false },
  { id: TARGET, role: "ADMIN", status: "ACTIVE", publicDisplayName: "Adam", verificationApproved: true },
  { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e92", role: "MANAGER", status: "ACTIVE", publicDisplayName: "Unverified Una", verificationApproved: false },
  { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e93", role: "MANAGER", status: "UNDER_REVIEW", publicDisplayName: "Pending Pat", verificationApproved: true },
] } as unknown as OrganizationReviewDetail;

const me = (platformRoles: MeResponse["platformRoles"]): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: T }, wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions: [], platformRoles, organizations: [],
});
const show = (roles: MeResponse["platformRoles"], opsTransferOwnership = vi.fn().mockResolvedValue(undefined)) => {
  render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={me(roles)}><TransferOwnership org={org} client={{ opsTransferOwnership }} /></MeProvider></QueryClientProvider>);
  return opsTransferOwnership;
};
const REASON = "Owner asked support to hand over.";

describe("TransferOwnership", () => {
  it("is hidden for an ops_reviewer", () => {
    show(["ops_reviewer"]);
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).toBeNull();
  });

  it("offers only active, verified, non-owner members and submits for an ops_admin", async () => {
    const transfer = show(["ops_admin"]);
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["Select a member", "Adam · Admin"]);
    await userEvent.selectOptions(within(dialog).getByLabelText("New owner"), TARGET);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), REASON);
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm transfer" }));
    expect(transfer).toHaveBeenCalledWith(ORG_ID, { targetMembershipId: TARGET, reason: REASON });
  });

  it("validates the reason length before calling the API", async () => {
    const transfer = show(["ops_admin"]);
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("New owner"), TARGET);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "too short");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm transfer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("10 to 1000");
    expect(transfer).not.toHaveBeenCalled();
  });

  it("shows a 409 inline and keeps the dialog open", async () => {
    show(["ops_admin"], vi.fn().mockRejectedValue(new ApiError("INVALID_TRANSITION", 409, "This member must complete verification first.")));
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("New owner"), TARGET);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), REASON);
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm transfer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This member must complete verification first.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
