import { ApiError } from "@repo/api-client";
import type { MeResponse } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/components/me-context";
import { RolesManager } from "@/components/ops/roles-manager";

const UID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
const RID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
const role = { id: RID, userId: UID, role: "ops_admin" as const, grantedByUserId: null, grantedAt: "2026-09-29T00:00:00.000Z" };
const me = (platformRoles: MeResponse["platformRoles"]): MeResponse => ({
  user: { id: UID, status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: UID, walletProvider: null, addresses: [] }, contacts: [], permissions: [], platformRoles, organizations: [],
});

function setup(platformRoles: MeResponse["platformRoles"] = ["ops_admin"]) {
  const client = {
    opsListRoles: vi.fn(async () => ({ roles: [role] })),
    opsGrantRole: vi.fn(async () => role),
    opsRevokeRole: vi.fn(async () => undefined),
  };
  render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={me(platformRoles)}><RolesManager client={client} /></MeProvider></QueryClientProvider>);
  return client;
}

describe("RolesManager", () => {
  it("non-admins see no access and load nothing", () => {
    const c = setup(["ops_reviewer"]);
    expect(screen.getByText("You don't have access to this area.")).toBeInTheDocument();
    expect(c.opsListRoles).not.toHaveBeenCalled();
  });

  it("grants a role", async () => {
    const c = setup();
    await screen.findByText(UID);
    await userEvent.type(screen.getByLabelText("User ID"), UID);
    await userEvent.click(screen.getByRole("button", { name: "Grant role" }));
    await waitFor(() => expect(c.opsGrantRole).toHaveBeenCalledWith({ userId: UID, role: "ops_reviewer" }));
  });

  it("revokes after confirmation", async () => {
    const c = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Revoke ops_admin/ }));
    expect(c.opsRevokeRole).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(c.opsRevokeRole).toHaveBeenCalledWith(RID));
  });

  it("shows the last-admin refusal inline", async () => {
    const c = setup();
    c.opsRevokeRole.mockRejectedValueOnce(new ApiError("INVALID_TRANSITION", 409, "At least one ops admin must remain."));
    await userEvent.click(await screen.findByRole("button", { name: /Revoke ops_admin/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm revoke" }));
    expect(await screen.findByText("At least one ops admin must remain.")).toBeInTheDocument();
  });
});
