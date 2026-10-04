import { ApiError } from "@repo/api-client";
import type { ListMembersResponse } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Members } from "@/components/organization/members";
import { asRole, memberView } from "./org-fixtures";

const client = (members: ListMembersResponse["members"], over: Record<string, unknown> = {}) => ({
  listOrganizationMembers: vi.fn().mockResolvedValue({ members }),
  inviteOrganizationMember: vi.fn(), cancelMemberInvite: vi.fn(), changeMemberRole: vi.fn(), removeMember: vi.fn(), confirmMemberRemoval: vi.fn(), cancelMemberRemoval: vi.fn(),
  listOrganizationRoles: vi.fn().mockResolvedValue({ builtIn: [], custom: [] }), assignMemberCustomRole: vi.fn(), ...over,
});
const show = (role: Parameters<typeof asRole>[0], c: ReturnType<typeof client>) =>
  render(<QueryClientProvider client={new QueryClient()}><Members org={asRole(role, { status: "VERIFIED" })} client={c} /></QueryClientProvider>);

/** Opens the invite dialog and returns it. */
const openInvite = async () => { await userEvent.click(await screen.findByRole("button", { name: "Invite a member" })); return screen.findByRole("form", { name: "Invite a member" }); };
const roleChoices = (form: HTMLElement) => within(within(form).getByRole("radiogroup", { name: "Role" })).getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
const next = () => userEvent.click(screen.getByRole("button", { name: /Continue/ }));

const people = () => [
  memberView({ role: "OWNER", isSelf: true, publicDisplayName: "Olga" }),
  memberView({ role: "ADMIN", publicDisplayName: "Adam", verificationStatus: "approved" }),
  memberView({ role: "VIEWER", publicDisplayName: null }),
];

describe("Members section gating", () => {
  it("VIEWER sees the list but no invite form and no row actions", async () => {
    show("VIEWER", client(people()));
    expect(await screen.findByText("Olga (you)")).toBeInTheDocument();
    expect(screen.getByText("No public name")).toBeInTheDocument();
    expect(screen.getByText("Verification: Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite a member" })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove|cancel invite/i })).toBeNull();
  });

  it("ADMIN cannot invite ADMIN, change or remove an admin directly, or touch the owner", async () => {
    show("ADMIN", client(people()));
    await screen.findByText("Olga (you)");
    const adam = screen.getByText("Adam").closest("li") as HTMLElement;
    expect(within(adam).queryByLabelText(/Role for/)).toBeNull();
    expect(within(adam).getByRole("button", { name: "Request removal" })).toBeInTheDocument();
    expect(within(screen.getByText("Olga (you)").closest("li") as HTMLElement).queryByRole("button")).toBeNull();
    await userEvent.type(within(await openInvite()).getByLabelText("Wallet address"), "0xabc");
    await next();
    expect(roleChoices(screen.getByRole("form", { name: "Invite a member" }))).toEqual(["MANAGER", "ANALYST", "VIEWER"]);
  });

  it("OWNER can invite ADMIN and sees the transfer note", async () => {
    show("OWNER", client(people()));
    await screen.findByText("Olga (you)");
    expect(screen.getByText("To transfer ownership, contact support.")).toBeInTheDocument();
    await userEvent.type(within(await openInvite()).getByLabelText("Wallet address"), "0xabc");
    await next();
    expect(roleChoices(screen.getByRole("form", { name: "Invite a member" }))).toEqual(["ADMIN", "MANAGER", "ANALYST", "VIEWER"]);
  });

  it("the invited wallet and email show only when the API sends them", async () => {
    show("ADMIN", client([memberView({ role: "VIEWER", status: "INVITED", invitedWallet: { chain: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T" }, invitedEmail: "v@example.com" })]));
    expect(await screen.findByText(/v@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel invite" })).toBeInTheDocument();
  });
});

describe("Invite (stepped)", () => {
  it("validates each step before calling the API", async () => {
    const c = client([]);
    show("OWNER", c);
    await openInvite();
    await next();
    expect(screen.getByLabelText("Wallet address")).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(screen.getByLabelText("Wallet address"), "0xabc");
    await next();
    await next();
    await userEvent.type(screen.getByLabelText("Email for the invitation"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(c.inviteOrganizationMember).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email for the invitation")).toHaveAttribute("aria-invalid", "true");
  });

  it("sends the parsed invitation and refreshes the list", async () => {
    const invited = memberView({ role: "ANALYST", status: "PENDING_WALLET_VERIFICATION" });
    const c = client([], { inviteOrganizationMember: vi.fn().mockResolvedValue({ members: [invited] }) });
    show("OWNER", c);
    await openInvite();
    await userEvent.type(screen.getByLabelText("Wallet address"), "0xabc");
    await next();
    await userEvent.click(screen.getByRole("radio", { name: /Analyst/ }));
    await next();
    await userEvent.type(screen.getByLabelText("Email for the invitation"), "New@Example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(c.inviteOrganizationMember).toHaveBeenCalledWith(expect.any(String), { walletChain: "ethereum", walletAddress: "0xabc", role: "ANALYST", email: "new@example.com" });
    expect(await screen.findByText("Waiting for wallet")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("form", { name: "Invite a member" })).toBeNull());
  });

  it("shows INVITE_EXISTS inline and keeps the dialog", async () => {
    const c = client([], { inviteOrganizationMember: vi.fn().mockRejectedValue(new ApiError("INVITE_EXISTS", 409, "dup")) });
    show("OWNER", c);
    await openInvite();
    await userEvent.type(screen.getByLabelText("Wallet address"), "0xabc");
    await next();
    await next();
    await userEvent.type(screen.getByLabelText("Email for the invitation"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already invited");
    expect(screen.getByRole("form", { name: "Invite a member" })).toBeInTheDocument();
  });
});

describe("Destructive actions", () => {
  it("removing a member asks for confirmation first", async () => {
    const viewer = memberView({ role: "VIEWER" });
    const c = client([viewer], { removeMember: vi.fn().mockResolvedValue({ members: [] }) });
    show("OWNER", c);
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(c.removeMember).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove member" }));
    expect(c.removeMember).toHaveBeenCalledWith(expect.any(String), viewer.id);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("an ADMIN's removal of another admin is only a request", async () => {
    const adam = memberView({ role: "ADMIN" });
    const c = client([adam], { removeMember: vi.fn().mockResolvedValue({ members: [{ ...adam, status: "REMOVAL_REQUESTED" }] }) });
    show("ADMIN", c);
    await userEvent.click(await screen.findByRole("button", { name: "Request removal" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Request removal" }));
    expect(c.removeMember).toHaveBeenCalledWith(expect.any(String), adam.id);
    expect(await screen.findByText("Removal requested")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm removal/ })).toBeNull();
  });

  it("the OWNER confirms or cancels a removal request", async () => {
    const adam = memberView({ role: "ADMIN", status: "REMOVAL_REQUESTED" });
    const c = client([adam], { confirmMemberRemoval: vi.fn().mockResolvedValue({ members: [] }), cancelMemberRemoval: vi.fn().mockResolvedValue({ members: [{ ...adam, status: "ACTIVE" }] }) });
    show("OWNER", c);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    expect(c.cancelMemberRemoval).toHaveBeenCalledWith(expect.any(String), adam.id);
    expect(await screen.findByText("Active")).toBeInTheDocument();
  });

  it("the OWNER's confirm removal goes through the dialog", async () => {
    const adam = memberView({ role: "ADMIN", status: "REMOVAL_REQUESTED" });
    const c = client([adam], { confirmMemberRemoval: vi.fn().mockResolvedValue({ members: [] }) });
    show("OWNER", c);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm removal" }));
    expect(c.confirmMemberRemoval).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm removal" }));
    expect(c.confirmMemberRemoval).toHaveBeenCalledWith(expect.any(String), adam.id);
  });

  it("a pending membership can be withdrawn through the same remove call", async () => {
    const pending = memberView({ role: "MANAGER", status: "UNDER_REVIEW" });
    const c = client([pending], { removeMember: vi.fn().mockResolvedValue({ members: [] }) });
    show("ADMIN", c);
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Withdraw membership" }));
    expect(c.removeMember).toHaveBeenCalledWith(expect.any(String), pending.id);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull());
  });

  it("an ADMIN cannot withdraw a pending ADMIN or change a pending ADMIN promotion; the OWNER can withdraw", async () => {
    const people = [memberView({ role: "ADMIN", status: "PENDING_DOCUMENTS" }), memberView({ role: "VIEWER", requestedRole: "ADMIN", publicDisplayName: "Vic" })];
    show("ADMIN", client(people));
    await screen.findByText("Vic");
    expect(screen.queryByRole("button", { name: /Withdraw|^Remove$|Request removal/ })).toBeNull();
    expect(screen.queryByLabelText(/Role for/)).toBeNull();
    show("OWNER", client(people));
    expect(await screen.findByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("inviting waits for a verified organization", async () => {
    render(<QueryClientProvider client={new QueryClient()}><Members org={asRole("OWNER", { status: "SUBMITTED" })} client={client(people())} /></QueryClientProvider>);
    await screen.findByText("Olga (you)");
    expect(screen.queryByRole("button", { name: "Invite a member" })).toBeNull();
  });

  it("changing a role applies the chosen role", async () => {
    const viewer = memberView({ role: "VIEWER" });
    const c = client([viewer], { changeMemberRole: vi.fn().mockResolvedValue({ members: [{ ...viewer, role: "ANALYST" }] }) });
    show("OWNER", c);
    await userEvent.selectOptions(await screen.findByLabelText("Role for this member"), "ANALYST");
    expect(c.changeMemberRole).toHaveBeenCalledWith(expect.any(String), viewer.id, { role: "ANALYST" });
  });
});

describe("Custom roles on the team", () => {
  it("offers only custom roles for the member's base role and assigns one", async () => {
    const viewer = memberView({ role: "VIEWER", publicDisplayName: "Vic" });
    const stamp = "2026-10-01T00:00:00.000Z";
    const roles = { builtIn: [], custom: [
      { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4a01", name: "Viewer + adoption", description: null, baseRole: "VIEWER", permissions: ["org.read", "analytics.read"], memberCount: 0, createdAt: stamp, updatedAt: stamp },
      { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4a02", name: "Finance reader", description: null, baseRole: "ANALYST", permissions: ["org.read", "earnings.read"], memberCount: 0, createdAt: stamp, updatedAt: stamp },
    ] };
    const c = client([viewer], {
      listOrganizationRoles: vi.fn().mockResolvedValue(roles),
      assignMemberCustomRole: vi.fn().mockResolvedValue({ members: [{ ...viewer, customRole: { id: roles.custom[0]!.id, name: "Viewer + adoption", applies: true }, permissions: ["org.read", "analytics.read"] }] }),
    });
    show("OWNER", c);
    const select = await screen.findByLabelText("Custom role for Vic");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Standard Viewer", "Viewer + adoption"]);
    await userEvent.selectOptions(select, roles.custom[0]!.id);
    expect(c.assignMemberCustomRole).toHaveBeenCalledWith(expect.any(String), viewer.id, { customRoleId: roles.custom[0]!.id });
    expect(await screen.findByText("Viewer · Viewer + adoption")).toBeInTheDocument();
    expect(screen.getByText("Can: see the organization, see adoption")).toBeInTheDocument();
  });
});
