import type { MeResponse } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/(app)/home/page";
import { MeProvider } from "@/components/me-context";

const me = (permissions: string[]): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions, platformRoles: [],
});
const home = (m: MeResponse) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={m}><HomePage /></MeProvider></QueryClientProvider>);

describe("Home manager card", () => {
  it("shows the approved card with the permission", () => {
    home(me(["create_manager_organization"]));
    expect(screen.getByText(/approved to create a manager organization/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become a fund manager" })).toBeNull();
  });
  it("otherwise offers the apply link", () => {
    home(me([]));
    expect(screen.getByRole("link", { name: "Become a fund manager" })).toHaveAttribute("href", "/managers/apply");
  });
});
