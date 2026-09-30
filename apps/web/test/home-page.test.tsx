import type { MeResponse } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const myInvitations = vi.fn().mockResolvedValue({ invitations: [] });
vi.mock("@/lib/api", () => ({ api: { myInvitations: () => myInvitations() } }));
import HomePage from "@/app/(app)/home/page";
import { MeProvider } from "@/components/me-context";

const me = (permissions: MeResponse["permissions"], organizations: MeResponse["organizations"] = []): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions, platformRoles: [], organizations,
});
const home = (m: MeResponse) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={m}><HomePage /></MeProvider></QueryClientProvider>);

describe("Home manager card", () => {
  it("with the permission and no organization offers to create one", () => {
    home(me(["create_manager_organization"]));
    expect(screen.getByRole("link", { name: "Create your organization" })).toHaveAttribute("href", "/organization");
    expect(screen.queryByRole("link", { name: "Become a fund manager" })).toBeNull();
  });
  it("with an organization shows its status and links to the workspace", () => {
    home(me(["create_manager_organization"], [{ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", role: "OWNER", status: "UNDER_REVIEW", membershipId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", membershipStatus: "ACTIVE" }]));
    expect(screen.getByText("Under review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Your organization/ })).toHaveAttribute("href", "/organization");
  });
  it("shows a card per pending invitation linking to it", async () => {
    myInvitations.mockResolvedValueOnce({ invitations: [{ membershipId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", organization: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", displayName: "Ada Capital" }, role: "MANAGER", expiresAt: "2026-10-14T00:00:00.000Z" }] });
    home(me([]));
    const card = await screen.findByRole("link", { name: /Invitation from Ada Capital/ });
    expect(card).toHaveAttribute("href", "/invitations/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70");
    expect(card).toHaveTextContent("Join as Manager");
  });
  it("otherwise offers the apply link", () => {
    home(me([]));
    expect(screen.getByRole("link", { name: "Become a fund manager" })).toHaveAttribute("href", "/managers/apply");
  });
});
