import { ApiError } from "@repo/api-client";
import type { InvitationView, MyMembership } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { Invitation } from "@/components/members/invitation";

const MID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70";
const invite = (over: Partial<InvitationView> = {}): InvitationView => ({
  membershipId: MID, organization: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", displayName: "Ada Capital" }, role: "ANALYST", expiresAt: new Date(Date.now() + 5 * 864e5).toISOString(), ...over,
});
const membership = (status: MyMembership["status"]): MyMembership => ({ id: MID, organizationId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", role: "ANALYST", requestedRole: null, status, publicDisplayName: null, publicTitle: null });
const client = (invitations: InvitationView[], over: Record<string, unknown> = {}) => ({
  myInvitations: vi.fn().mockResolvedValue({ invitations }), acceptInvitation: vi.fn(), declineInvitation: vi.fn(), ...over,
});
const show = (c: ReturnType<typeof client>) => render(<QueryClientProvider client={new QueryClient()}><Invitation mid={MID} client={c} /></QueryClientProvider>);

beforeEach(() => push.mockReset());

describe("Invitation page", () => {
  it("ANALYST/VIEWER: shows the organization, role and expiry, and accepting goes to the workspace", async () => {
    const c = client([invite()], { acceptInvitation: vi.fn().mockResolvedValue(membership("ACTIVE")) });
    show(c);
    expect(await screen.findByRole("heading", { name: "Join Ada Capital" })).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText(/expires on/)).toBeInTheDocument();
    expect(screen.queryByText(/verify your identity/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(c.acceptInvitation).toHaveBeenCalledWith(MID);
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/organization"));
  });

  it("ADMIN/MANAGER: warns about verification and accepting goes to the membership page", async () => {
    const c = client([invite({ role: "MANAGER" })], { acceptInvitation: vi.fn().mockResolvedValue(membership("PENDING_DOCUMENTS")) });
    show(c);
    expect(await screen.findByText("You'll be asked to verify your identity before joining.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/organization/membership/${MID}`));
  });

  it("declining returns to Home", async () => {
    const c = client([invite()], { declineInvitation: vi.fn().mockResolvedValue(membership("REJECTED")) });
    show(c);
    await userEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(c.declineInvitation).toHaveBeenCalledWith(MID);
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/home"));
  });

  it("an invitation that is no longer open (expired, revoked or answered) offers no actions", async () => {
    show(client([]));
    expect(await screen.findByRole("heading", { name: "Invitation unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
  });

  it("an invitation past its expiry is shown as unavailable", async () => {
    show(client([invite({ expiresAt: new Date(Date.now() - 1000).toISOString() })]));
    expect(await screen.findByRole("heading", { name: "Invitation unavailable" })).toBeInTheDocument();
  });

  it("an accept that loses the race with expiry switches to the unavailable state", async () => {
    const c = client([invite()], { acceptInvitation: vi.fn().mockRejectedValue(new ApiError("INVALID_TRANSITION", 409, "no")) });
    show(c);
    await userEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("heading", { name: "Invitation unavailable" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
