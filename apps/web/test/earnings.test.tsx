import type { Earnings as EarningsView } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Earnings } from "@/components/organization/earnings";
import { asRole, ORG_ID } from "./org-fixtures";

const T = "2026-09-29T00:00:00.000Z";
const data: EarningsView = {
  totalMicro: "2500000", waivedCount: 1,
  groups: [{ basketId: ORG_ID, basketName: "Core Crypto", versionNumber: 2, kind: "manager_entry", month: "2026-09", amountMicro: "2500000" }],
  recent: [{ settledAt: T, basketId: ORG_ID, kind: "manager_entry", amountMicro: "2500000", tx: "sig", explorerUrl: "https://solscan.io/tx/sig" }],
};
function setup(role: Parameters<typeof asRole>[0]) {
  const client = { getOrganization: vi.fn(async () => asRole(role)), getEarnings: vi.fn(async () => data) };
  render(<QueryClientProvider client={new QueryClient()}><Earnings orgId={ORG_ID} client={client} /></QueryClientProvider>);
  return client;
}

describe("Earnings", () => {
  it("is hidden without earnings.read and loads nothing", async () => {
    const c = setup("MANAGER");
    expect(await screen.findByText(/have access to earnings/)).toBeInTheDocument();
    expect(c.getEarnings).not.toHaveBeenCalled();
  });

  it("shows totals, breakdown, explorer links, the waived count and the CSV link", async () => {
    setup("OWNER");
    expect(await screen.findByText("Settled manager fees: 2.5 USDC")).toBeInTheDocument();
    expect(screen.getByText("2026-09 · Core Crypto v2 · Entry fee: 2.5 USDC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View transaction/ })).toHaveAttribute("href", "https://solscan.io/tx/sig");
    expect(screen.getByText(/1 manager fee was waived/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", `/api/v1/organizations/${ORG_ID}/earnings?format=csv`);
  });
});
