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
  inviteOrganizationMember: vi.fn(), cancelMemberInvite: vi.fn(), changeMemberRole: vi.fn(), removeMember: vi.fn(), confirmMemberRemoval: vi.fn(), cancelMemberRemoval: vi.fn(), ...over,
});
const show = (role: Parameters<typeof asRole>[0], c: ReturnType<typeof client>) =>
  render(<QueryClientProvider client={new QueryClient()}><Members org={asRole(role)} client={c} /></QueryClientProvider>);

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
    expect(screen.queryByRole("form", { name: "Invite a member" })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove|cancel invite/i })).toBeNull();
  });

  it("ADMIN cannot invite ADMIN, change or remove an admin directly, or touch the owner", async () => {
    show("ADMIN", client(people()));
    await screen.findByText("Olga (you)");
    const roles = within(screen.getByRole("form", { name: "Invite a member" })).getByLabelText("Role");
    expect([...roles.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Manager", "Analyst", "Viewer"]);
    const adam = screen.getByText("Adam").closest("li") as HTMLElement;
    expect(within(adam).queryByLabelText(/Role for/)).toBeNull();
    expect(within(adam).getByRole("button", { name: "Request removal" })).toBeInTheDocument();
    expect(within(screen.getByText("Olga (you)").closest("li") as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("OWNER can invite ADMIN and sees the transfer note", async () => {
    show("OWNER", client(people()));
    await screen.findByText("Olga (you)");
    expect(screen.getByText("To transfer ownership, contact support.")).toBeInTheDocument();
    const roles = within(screen.getByRole("form", { name: "Invite a member" })).getByLabelText("Role");
    expect([...roles.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Admin", "Manager", "Analyst", "Viewer"]);
  });

  it("the invited wallet and email show only when the API sends them", async () => {
    show("ADMIN", client([memberView({ role: "VIEWER", status: "INVITED", invitedWallet: { chain: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T" }, invitedEmail: "v@example.com" })]));
    expect(await screen.findByText(/v@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel invite" })).toBeInTheDocument();
  });
});

describe("Invite form", () => {
  it("validates before calling the API", async () => {
    const c = client([]);
    show("OWNER", c);
    await screen.findByRole("form", { name: "Invite a member" });
    await userEvent.type(screen.getByLabelText("Email for the invitation"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(c.inviteOrganizationMember).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email for the invitation")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Wallet address")).toHaveAttribute("aria-invalid", "true");
  });

  it("sends the parsed invitation, refreshes the list and clears the form", async () => {
    const invited = memberView({ role: "ANALYST", status: "PENDING_WALLET_VERIFICATION" });
    const c = client([], { inviteOrganizationMember: vi.fn().mockResolvedValue({ members: [invited] }) });
    show("OWNER", c);
    await userEvent.type(await screen.findByLabelText("Wallet address"), "0xabc");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "ANALYST");
    await userEvent.type(screen.getByLabelText("Email for the invitation"), "New@Example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(c.inviteOrganizationMember).toHaveBeenCalledWith(expect.any(String), { walletChain: "ethereum", walletAddress: "0xabc", role: "ANALYST", email: "new@example.com" });
    expect(await screen.findByText("Waiting for wallet")).toBeInTheDocument();
    expect(screen.getByLabelText("Wallet address")).toHaveValue("");
  });

  it("shows INVITE_EXISTS inline", async () => {
    const c = client([], { inviteOrganizationMember: vi.fn().mockRejectedValue(new ApiError("INVITE_EXISTS", 409, "dup")) });
    show("OWNER", c);
    await userEvent.type(await screen.findByLabelText("Wallet address"), "0xabc");
    await userEvent.type(screen.getByLabelText("Email for the invitation"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already invited");
    expect(screen.getByLabelText("Wallet address")).toHaveValue("0xabc");
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

  it("changing a role applies the chosen role", async () => {
    const viewer = memberView({ role: "VIEWER" });
    const c = client([viewer], { changeMemberRole: vi.fn().mockResolvedValue({ members: [{ ...viewer, role: "ANALYST" }] }) });
    show("OWNER", c);
    await userEvent.selectOptions(await screen.findByLabelText("Role for this member"), "ANALYST");
    expect(c.changeMemberRole).toHaveBeenCalledWith(expect.any(String), viewer.id, { role: "ANALYST" });
  });
});
