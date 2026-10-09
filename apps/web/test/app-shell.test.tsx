import type { MeResponse } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/portfolio" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api", () => ({ api: { logout: vi.fn() } }));
vi.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ disconnect: vi.fn() }) }));
vi.mock("@/components/notifications/bell", () => ({ NotificationsBell: () => <span>bell</span> }));
vi.mock("@/components/layout/wallet-menu", () => ({ WalletMenu: () => <span>wallets</span> }));
vi.mock("@/components/notifications/push-toggle", () => ({ revokePushOnLogout: vi.fn() }));
import { AppShell, PublicShell } from "@/components/layout/app-shell";
import { areaOf, navFor } from "@/components/layout/nav";
import { MeProvider } from "@/components/me-context";

const org = (membershipStatus: "ACTIVE" | "UNDER_REVIEW"): MeResponse["organizations"][number] => ({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", displayName: null, role: "OWNER", status: "VERIFIED", membershipId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", membershipStatus });
const me = (o: Partial<MeResponse> = {}): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions: [], platformRoles: [], organizations: [], ...o,
});
const labels = (items: { label: string }[]) => items.map((i) => i.label);

beforeEach(() => { nav.path = "/portfolio"; });

describe("navFor", () => {
  it("an investor sees Home, Discover and Portfolio, plus Alerts and Profile on the phone tab bar", () => {
    const n = navFor(me());
    expect(labels(n.primary)).toEqual(["Home", "Discover", "Portfolio"]);
    expect(labels(n.tabs)).toEqual(["Home", "Discover", "Portfolio", "Alerts", "Profile"]);
    expect(n.manager).toEqual([]);
    expect(n.ops).toEqual([]);
  });
  it("a signed-out visitor sees the marketing navigation", () => {
    expect(labels(navFor(null).primary)).toEqual(["Baskets", "How it works", "Your wallet", "For managers", "Fees"]);
  });
  it("a manager needs an active membership", () => {
    expect(labels(navFor(me({ organizations: [org("ACTIVE")] })).manager)).toEqual(["Overview", "Baskets", "Team", "Roles & access", "Wallets", "Settings", "Earnings"]);
    expect(navFor(me({ organizations: [org("UNDER_REVIEW")] })).manager).toEqual([]);
  });
  it("a reviewer sees ops without the admin-only areas, an admin sees all", () => {
    const flat = (m: MeResponse) => navFor(m).ops.flatMap((g) => labels(g.items));
    const reviewer = flat(me({ platformRoles: ["ops_reviewer"] }));
    expect(reviewer).toEqual(expect.arrayContaining(["Applications", "Assets", "Fees", "Revenue"]));
    for (const adminOnly of ["Roles", "Tags", "Disclosures"]) expect(reviewer).not.toContain(adminOnly);
    expect(flat(me({ platformRoles: ["ops_admin"] }))).toEqual(expect.arrayContaining(["Roles", "Tags", "Disclosures", "Manager profiles", "Routing"]));
  });
  it("knows which workspace a path belongs to", () => {
    expect(areaOf("/ops/assets")).toBe("ops");
    expect(areaOf("/organization/earnings")).toBe("manager");
    expect(areaOf("/organizations/abc")).toBeNull();
    expect(areaOf("/portfolio")).toBeNull();
  });
});

const shell = (m: MeResponse) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={m}><AppShell><p>content</p></AppShell></MeProvider></QueryClientProvider>);

describe("AppShell", () => {
  it("shows the investor navigation, the bell and the account menu, marks the current page", () => {
    shell(me());
    const primary = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(primary.getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
    expect(primary.getByRole("link", { name: "Discover" })).toHaveAttribute("href", "/baskets");
    expect(screen.queryByRole("link", { name: "Manager" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ops" })).toBeNull();
    expect(screen.getByText("bell")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Manager" })).toBeNull();
  });
  it("a manager gets a Manager entry and, inside the workspace, its second row", () => {
    nav.path = "/organization/earnings";
    shell(me({ organizations: [org("ACTIVE")] }));
    expect(screen.getByRole("link", { name: "Manager" })).toHaveAttribute("href", "/organization");
    const row = within(screen.getByRole("navigation", { name: "Manager" }));
    expect(row.getByRole("link", { name: "Earnings" })).toHaveAttribute("aria-current", "page");
    expect(row.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });
  it("an ops user gets grouped ops areas inside /ops and none elsewhere", () => {
    nav.path = "/ops/assets";
    const { unmount } = shell(me({ platformRoles: ["ops_reviewer"] }));
    const row = within(screen.getByRole("navigation", { name: "Operations" }));
    expect(row.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
    expect(row.getByRole("link", { name: "Revenue" })).toBeInTheDocument();
    expect(row.queryByRole("link", { name: "Roles" })).toBeNull();
    unmount();
    nav.path = "/portfolio";
    shell(me({ platformRoles: ["ops_reviewer"] }));
    expect(screen.queryByRole("navigation", { name: "Operations" })).toBeNull();
    expect(screen.getByRole("link", { name: "Ops" })).toHaveAttribute("href", "/ops");
  });
  it("a detail page highlights its section", () => {
    nav.path = "/baskets/core-crypto";
    shell(me());
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Discover" })).toHaveAttribute("aria-current", "page");
  });
});

describe("PublicShell", () => {
  it("offers the marketing navigation and Sign in, and no account menu", () => {
    render(<PublicShell><p>public</p></PublicShell>);
    const primary = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(primary.getByRole("link", { name: "Fees" })).toHaveAttribute("href", "/fees");
    expect(primary.getByRole("link", { name: "Baskets" })).toHaveAttribute("href", "/baskets");
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  });
});
