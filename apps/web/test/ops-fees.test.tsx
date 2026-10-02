import type { MeResponse, PlatformFeeScheduleView } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/components/me-context";
import { FeeSchedules } from "@/components/ops/fee-schedules";
import { Revenue } from "@/components/ops/revenue";

const UID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
const OID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
const T = "2026-09-29T00:00:00.000Z";
const row = (o: Partial<PlatformFeeScheduleView>): PlatformFeeScheduleView => ({ id: UID, scope: "default", scopeId: null, operationKind: "invest", bps: 50, minUsdc: null, maxUsdc: "50", endsAt: null, reason: "Launch rate", createdAt: T, supersededAt: null, ...o });
const me = (platformRoles: MeResponse["platformRoles"]): MeResponse => ({
  user: { id: UID, status: "active", createdAt: T }, wallet: { id: UID, walletProvider: null, addresses: [] }, contacts: [], permissions: [], platformRoles, organizations: [],
});
const shell = (roles: MeResponse["platformRoles"], ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={me(roles)}>{ui}</MeProvider></QueryClientProvider>);

function schedules(roles: MeResponse["platformRoles"]) {
  const override = row({ id: OID, scope: "organization", scopeId: OID, bps: 10, maxUsdc: null, reason: "Partner deal" });
  const client = {
    opsListFees: vi.fn(async () => ({ items: [row({}), row({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", bps: 25, supersededAt: T, reason: "Earlier" })] })),
    opsSaveFee: vi.fn(async () => row({})),
    opsListFeeOverrides: vi.fn(async () => ({ items: [override] })),
    opsSaveFeeOverride: vi.fn(async () => override),
    opsEndFeeOverride: vi.fn(async () => override),
  };
  shell(roles, <FeeSchedules client={client} />);
  return client;
}

describe("Ops fee schedules", () => {
  it("shows the default schedule as 'up to' text, the history and the overrides", async () => {
    schedules(["ops_admin"]);
    expect(await screen.findByText("0.5% up to $50")).toBeInTheDocument();
    expect(screen.getByText(/Earlier/)).toBeInTheDocument();
    expect(screen.getByText("Investing: 0.1%")).toBeInTheDocument();
  });

  it("an admin cannot save a change without a reason", async () => {
    const c = schedules(["ops_admin"]);
    await userEvent.click(await screen.findByRole("button", { name: "Save schedule" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(c.opsSaveFee).not.toHaveBeenCalled();
    await userEvent.type(within(screen.getByRole("region", { name: "Default schedule" })).getByLabelText("Reason"), "Promo");
    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(c.opsSaveFee).toHaveBeenCalledWith({ operationKind: "invest", bps: 0, reason: "Promo" }));
  });

  it("a reviewer sees the schedules read-only", async () => {
    schedules(["ops_reviewer"]);
    await screen.findByText("0.5% up to $50");
    expect(screen.queryByRole("button", { name: "Save schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create override" })).toBeNull();
    expect(screen.queryByRole("button", { name: /End override/ })).toBeNull();
    expect(screen.getByText("Only an ops admin can change fees.")).toBeInTheDocument();
  });

  it("creates and ends an override", async () => {
    const c = schedules(["ops_admin"]);
    await screen.findByText("0.5% up to $50");
    const form = within(screen.getByRole("region", { name: "Overrides" }));
    await userEvent.type(form.getByLabelText("Organization or basket ID"), OID);
    await userEvent.clear(form.getByLabelText("Rate (basis points, 0 to 100)"));
    await userEvent.type(form.getByLabelText("Rate (basis points, 0 to 100)"), "20");
    await userEvent.type(form.getByLabelText("Reason"), "Volume deal");
    await userEvent.click(form.getByRole("button", { name: "Create override" }));
    await waitFor(() => expect(c.opsSaveFeeOverride).toHaveBeenCalledWith({ scope: "organization", scopeId: OID, operationKind: "invest", bps: 20, reason: "Volume deal" }));
    await userEvent.click(form.getByRole("button", { name: `End override ${OID}` }));
    await waitFor(() => expect(c.opsEndFeeOverride).toHaveBeenCalledWith(OID));
  });
});

describe("Ops revenue", () => {
  it("shows totals, waived manager fees and a CSV link for the range", async () => {
    const client = { opsGetRevenue: vi.fn(async () => ({ totalMicro: "1500000", platform: [{ operationKind: "invest" as const, month: "2026-09", amountMicro: "1500000" }], waivedManager: [{ reason: "dust" as const, count: 2 }] })) };
    shell(["ops_admin"], <Revenue client={client} />);
    expect(await screen.findByText("Platform fees settled: 1.5 USDC")).toBeInTheDocument();
    expect(screen.getByText("2026-09 · Investing: 1.5 USDC")).toBeInTheDocument();
    expect(screen.getByText("Below $0.01: 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/api/v1/ops/revenue?format=csv");
    await userEvent.type(screen.getByLabelText("From"), "2026-09-01");
    expect(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toContain("from=2026-09-01T00%3A00%3A00.000Z");
  });
});
