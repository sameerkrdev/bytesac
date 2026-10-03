import type { MeResponse, RoutingView } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/components/me-context";
import { AssetDeployments } from "@/components/ops/assets/asset-deployments";
import { Routing } from "@/components/ops/routing";
import { asset, deployment, me } from "./asset-fixtures";

const ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
const view: RoutingView = {
  bridges: [{ key: "mayan", name: "Mayan", denyEntryId: null }, { key: "stargate", name: "Stargate", denyEntryId: ID }],
  exchanges: [{ key: "1inch", name: "1inch", denyEntryId: null }],
  entries: [{ id: ID, kind: "bridge", toolKey: "stargate", reason: "Incident", createdBy: ID, createdAt: "2026-10-01T00:00:00.000Z", removedBy: null, removedAt: null }],
};
const shell = (roles: MeResponse["platformRoles"], ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={me(roles)}>{ui}</MeProvider></QueryClientProvider>);
const routing = (roles: MeResponse["platformRoles"]) => {
  const client = { opsGetRouting: vi.fn(async () => view), opsDenyRouteTool: vi.fn(async () => view.entries[0]!), opsAllowRouteTool: vi.fn(async () => view.entries[0]!) };
  shell(roles, <Routing client={client} />);
  return client;
};

describe("Ops routing", () => {
  it("denying a tool needs a reason", async () => {
    const c = routing(["ops_admin"]);
    await userEvent.click(await screen.findByRole("button", { name: "Deny Mayan" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm deny" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(c.opsDenyRouteTool).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Reason for denying Mayan/), "Exploit reported");
    await userEvent.click(screen.getByRole("button", { name: "Confirm deny" }));
    await waitFor(() => expect(c.opsDenyRouteTool).toHaveBeenCalledWith({ kind: "bridge", toolKey: "mayan", reason: "Exploit reported" }));
  });
  it("an admin allows a denied tool again", async () => {
    const c = routing(["ops_admin"]);
    await userEvent.click(await screen.findByRole("button", { name: "Allow Stargate" }));
    await waitFor(() => expect(c.opsAllowRouteTool).toHaveBeenCalledWith(ID));
  });
  it("marks an entry whose key LI.FI no longer lists as stale", async () => {
    const stale = { ...view, entries: [{ ...view.entries[0]!, toolKey: "stargateOld", stale: true }] };
    const client = { opsGetRouting: vi.fn(async () => stale), opsDenyRouteTool: vi.fn(), opsAllowRouteTool: vi.fn() };
    shell(["ops_reviewer"], <Routing client={client as never} />);
    expect(await screen.findByText(/Stale — LI.FI no longer lists this key; re-deny under the new key/)).toBeInTheDocument();
  });
  it("a reviewer reads the tables and history but has no actions", async () => {
    routing(["ops_reviewer"]);
    expect(await screen.findByText("Denied")).toBeInTheDocument();
    expect(screen.getByText(/Incident/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deny|Allow/ })).toBeNull();
  });
});

describe("asset deployment LI.FI badge and fee-on-transfer flag", () => {
  const detail = (o: object) => asset({ deployments: [deployment(o)] });
  const deployments = (a: ReturnType<typeof asset>, roles: MeResponse["platformRoles"], client: object = {}) =>
    shell(roles, <AssetDeployments a={a} locked={false} isAdmin={roles.includes("ops_admin")} onChange={vi.fn()} client={client as never} />);
  it("shows the verification badge, in warning style when not verified", async () => {
    deployments(detail({ lifiVerification: "unverified" }), ["ops_reviewer"]);
    expect(await screen.findByText("LI.FI: unverified")).toHaveClass("text-warning");
  });
  it("shows a verified badge", async () => {
    deployments(detail({ lifiVerification: "verified" }), ["ops_reviewer"]);
    expect(await screen.findByText("LI.FI: verified")).toHaveClass("text-success");
  });
  it("an admin flags fee-on-transfer; a reviewer cannot", async () => {
    const opsSetFeeOnTransfer = vi.fn().mockResolvedValue(asset());
    const { unmount } = deployments(detail({}), ["ops_admin"], { opsSetFeeOnTransfer });
    await userEvent.click(await screen.findByRole("button", { name: "Flag as fee-on-transfer" }));
    await waitFor(() => expect(opsSetFeeOnTransfer).toHaveBeenCalledWith(asset().id, deployment().id, { feeOnTransfer: true }));
    unmount();
    deployments(detail({ feeOnTransfer: true }), ["ops_reviewer"]);
    expect(await screen.findByText(/Fee-on-transfer: previews warn/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fee-on-transfer/i })).toBeNull();
  });
});
