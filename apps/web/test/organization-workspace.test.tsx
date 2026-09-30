import { ApiError } from "@repo/api-client";
import type { MeResponse, OrganizationDetail } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/components/me-context";
import { SubmitChecklist } from "@/components/organization/submit-checklist";
import { orgDetail, ORG_ID, version } from "./org-fixtures";

const getOrganization = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getOrganization: (id: string) => getOrganization(id) } }));
vi.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ account: null, signMessage: vi.fn(), connect: vi.fn() }) }));
import OrganizationPage from "@/app/(app)/organization/page";

const me = (status: MeResponse["organizations"][number]["status"] | null): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions: ["create_manager_organization"], platformRoles: [],
  organizations: status ? [{ id: ORG_ID, role: "OWNER", status }] : [],
});
const page = (m: MeResponse) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={m}><OrganizationPage /></MeProvider></QueryClientProvider>);

beforeEach(() => getOrganization.mockReset());

describe("Organization workspace", () => {
  it("offers the create step when there is no organization", () => {
    page(me(null));
    expect(screen.getByRole("button", { name: "Create organization" })).toBeInTheDocument();
    expect(getOrganization).not.toHaveBeenCalled();
  });

  it("is read-only with a banner while under review", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "UNDER_REVIEW", openVersion: version({ status: "in_review" }) }));
    page(me("UNDER_REVIEW"));
    expect(await screen.findByText(/being reviewed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: /submit|resubmit/i })).toBeNull();
  });

  it("shows the ops message and re-enables editing on CHANGES_REQUIRED", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "CHANGES_REQUIRED", openVersion: version({ status: "changes_required" }), latestMessageToOwner: "Please upload a clearer ID.", missing: { fields: [], documents: [], payoutWallet: false } }));
    page(me("CHANGES_REQUIRED"));
    expect(await screen.findByText("Please upload a clearer ID.")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeEnabled();
  });

  it("verified: links to the public profile and starts a change request", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "VERIFIED", openVersion: null, currentVersion: version({ status: "approved", publicProfile: { displayName: "Ada" } }) }));
    page(me("VERIFIED"));
    expect(await screen.findByRole("link", { name: "View public profile" })).toHaveAttribute("href", `/organizations/${ORG_ID}`);
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
  });
});

describe("SubmitChecklist", () => {
  const client = (over: Record<string, unknown> = {}) => ({ submitOrganization: vi.fn(), submitOrganizationChangeRequest: vi.fn(), ...over });

  it("lists what is missing and disables submit", () => {
    const org: OrganizationDetail = orgDetail({ missing: { fields: ["about"], documents: ["government_id"], payoutWallet: true } });
    render(<SubmitChecklist org={org} onChange={vi.fn()} onIncomplete={vi.fn()} client={client()} />);
    expect(screen.getByText("Fill in: About")).toBeInTheDocument();
    expect(screen.getByText("Upload: Government ID")).toBeInTheDocument();
    expect(screen.getByText("Verify your payout wallet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("submits when complete", async () => {
    const c = client({ submitOrganization: vi.fn().mockResolvedValue(orgDetail({ status: "SUBMITTED" })) });
    const onChange = vi.fn();
    render(<SubmitChecklist org={orgDetail()} onChange={onChange} onIncomplete={vi.fn()} client={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(c.submitOrganization).toHaveBeenCalledWith(ORG_ID);
    expect(onChange).toHaveBeenCalled();
  });

  it("refreshes the list when the API says requirements are incomplete", async () => {
    const c = client({ submitOrganization: vi.fn().mockRejectedValue(new ApiError("REQUIREMENTS_INCOMPLETE", 422, "no")) });
    const onIncomplete = vi.fn();
    render(<SubmitChecklist org={orgDetail()} onChange={vi.fn()} onIncomplete={onIncomplete} client={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not ready to submit");
    expect(onIncomplete).toHaveBeenCalled();
  });
});
