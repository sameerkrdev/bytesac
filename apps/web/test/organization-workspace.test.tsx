import { ApiError } from "@repo/api-client";
import type { MeResponse, OrganizationDetail } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeProvider } from "@/components/me-context";
import { SubmitChecklist } from "@/components/organization/submit-checklist";
import { asRole, orgDetail, ORG_ID, version, wallet } from "./org-fixtures";

const getOrganization = vi.fn();
const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams(search), usePathname: () => "/organization" }));
vi.mock("@/lib/api", () => ({
  api: {
    getOrganization: (id: string) => getOrganization(id), listOrganizationMembers: vi.fn().mockResolvedValue({ members: [] }), listOrgBaskets: vi.fn().mockResolvedValue({ baskets: [] }),
  },
}));
vi.mock("@/lib/wallet/use-wallet-connector", () => ({ useWalletConnector: () => ({ account: null, signMessage: vi.fn(), connect: vi.fn() }) }));
import OrganizationPage from "@/app/(app)/organization/page";
import OrganizationSettingsPage from "@/app/(app)/organization/settings/page";

const me = (status: MeResponse["organizations"][number]["status"] | null, role: MeResponse["organizations"][number]["role"] = "OWNER", membershipStatus: MeResponse["organizations"][number]["membershipStatus"] = "ACTIVE"): MeResponse => ({
  user: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions: ["create_manager_organization"], platformRoles: [],
  organizations: status ? [{ id: ORG_ID, displayName: null, role, status, membershipId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70", membershipStatus }] : [],
});
const show = (Page: ComponentType, m: MeResponse) => render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={m}><Page /></MeProvider></QueryClientProvider>);
const page = (m: MeResponse) => show(OrganizationPage, m);
const settings = (m: MeResponse) => show(OrganizationSettingsPage, m);
const verifiedOrg = (over: Partial<OrganizationDetail> = {}) => orgDetail({ status: "VERIFIED", openVersion: null, currentVersion: version({ status: "approved", publicProfile: { displayName: "Ada" } }), ...over });

beforeEach(() => getOrganization.mockReset());

describe("Overview", () => {
  it("offers the create step when there is no organization", () => {
    page(me(null));
    expect(screen.getByRole("button", { name: "Create organization" })).toBeInTheDocument();
    expect(getOrganization).not.toHaveBeenCalled();
  });

  it("says when the organization is being reviewed", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "UNDER_REVIEW", openVersion: version({ status: "in_review" }) }));
    page(me("UNDER_REVIEW"));
    expect(await screen.findByText(/being reviewed/)).toBeInTheDocument();
  });

  it("puts the ops message first in Next steps, linking to Settings", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "CHANGES_REQUIRED", openVersion: version({ status: "changes_required" }), latestMessageToOwner: "Please upload a clearer ID.", missing: { fields: [], documents: [], payoutWallet: false } }));
    page(me("CHANGES_REQUIRED"));
    const link = (await screen.findByText("Please upload a clearer ID.")).closest("a")!;
    expect(link).toHaveAttribute("href", `/organization/settings?org=${ORG_ID}`);
    expect(link).toHaveTextContent("Bytesac asked for changes");
  });

  it("verified: shows status cards, the areas and a public page link", async () => {
    getOrganization.mockResolvedValue(verifiedOrg({ payoutWallets: [wallet({ status: "VERIFIED" })] }));
    page(me("VERIFIED"));
    expect(await screen.findByRole("link", { name: "Public page" })).toHaveAttribute("href", `/organizations/${ORG_ID}`);
    expect(screen.getByRole("link", { name: "Verification" })).toHaveAttribute("href", `/organization/settings?org=${ORG_ID}`);
    expect(screen.getByRole("link", { name: /Roles & access/ })).toHaveAttribute("href", `/organization/roles?org=${ORG_ID}`);
  });

  it("a member who is not active yet is sent to the membership page instead of the organization", async () => {
    page(me("VERIFIED", "ADMIN", "PENDING_DOCUMENTS"));
    expect(await screen.findByRole("link", { name: "Open your membership" })).toHaveAttribute("href", "/organization/membership/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70");
    expect(getOrganization).not.toHaveBeenCalled();
  });
});

describe("Settings by status and role", () => {
  it("is a read-only summary while under review", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "UNDER_REVIEW", openVersion: version({ status: "in_review", publicProfile: { displayName: "Ada" } }) }));
    settings(me("UNDER_REVIEW"));
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /save draft|submit|resubmit/i })).toBeNull();
  });

  it("re-enables editing on CHANGES_REQUIRED, with Resubmit", async () => {
    getOrganization.mockResolvedValue(orgDetail({ status: "CHANGES_REQUIRED", openVersion: version({ status: "changes_required" }), missing: { fields: [], documents: [], payoutWallet: false } }));
    settings(me("CHANGES_REQUIRED"));
    expect(await screen.findByLabelText("Display name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeEnabled();
  });

  it("verified owner: links to the public profile and starts a change request", async () => {
    getOrganization.mockResolvedValue(verifiedOrg());
    settings(me("VERIFIED"));
    expect(await screen.findByRole("link", { name: "View public profile" })).toHaveAttribute("href", `/organizations/${ORG_ID}`);
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("VIEWER: read-only notice, no edit, save or submit", async () => {
    getOrganization.mockResolvedValue(asRole("VIEWER", { status: "VERIFIED", openVersion: null, currentVersion: version({ status: "approved", publicProfile: { displayName: "Ada" } }), payoutWallets: [wallet({ status: "VERIFIED" })] }));
    settings(me("VERIFIED", "VIEWER"));
    expect(await screen.findByText("You have read-only access. Only the owner edits the organization.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: /submit|save draft/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
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

describe("Organization switcher", () => {
  const OTHER = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e62";
  const row = (id: string, over: Partial<MeResponse["organizations"][number]>): MeResponse["organizations"][number] =>
    ({ id, displayName: null, role: "OWNER", status: "VERIFIED", membershipId: `${id.slice(0, -2)}99`, membershipStatus: "ACTIVE", ...over });
  const multi = (...orgs: MeResponse["organizations"]): MeResponse => ({ ...me(null), organizations: orgs });
  const OWN = row(ORG_ID, { displayName: "My fund" });
  const INVITED = row(OTHER, { displayName: "Older org", role: "ADMIN", status: "VERIFIED", membershipStatus: "PENDING_DOCUMENTS" });

  beforeEach(() => { search = ""; replace.mockReset(); });

  it("is hidden with one organization", async () => {
    getOrganization.mockResolvedValue(verifiedOrg());
    page(multi(OWN));
    await screen.findByRole("heading", { name: "Next steps" });
    expect(screen.queryByLabelText("Organization")).toBeNull();
  });

  it("lists every organization with name, role and membership status, and defaults to the ACTIVE one the user owns", async () => {
    getOrganization.mockResolvedValue(verifiedOrg());
    page(multi(INVITED, OWN));
    const select = (await screen.findByLabelText("Organization")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Older org · Admin · Verification needed", "My fund · Owner · Active"]);
    expect(select.value).toBe(ORG_ID);
    expect(getOrganization).toHaveBeenCalledWith(ORG_ID);
  });

  it("?org= selects that organization's workspace (a pending membership shows its notice)", async () => {
    search = `org=${OTHER}`;
    page(multi(OWN, INVITED));
    expect(await screen.findByText(/Your membership is not active yet/)).toBeInTheDocument();
    expect(getOrganization).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Organization") as HTMLSelectElement).value).toBe(OTHER);
  });

  it("an unknown ?org= falls back to the default", async () => {
    search = "org=0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4eff";
    getOrganization.mockResolvedValue(verifiedOrg());
    page(multi(INVITED, OWN));
    expect(((await screen.findByLabelText("Organization")) as HTMLSelectElement).value).toBe(ORG_ID);
    expect(getOrganization).toHaveBeenCalledWith(ORG_ID);
  });

  it("choosing an organization puts it in the URL", async () => {
    getOrganization.mockResolvedValue(verifiedOrg());
    page(multi(OWN, INVITED));
    await userEvent.selectOptions(await screen.findByLabelText("Organization"), OTHER);
    expect(replace).toHaveBeenCalledWith(`/organization?org=${OTHER}`);
  });

  it("without an owned ACTIVE organization, any ACTIVE one wins over a pending one", async () => {
    getOrganization.mockResolvedValue(verifiedOrg());
    page(multi(INVITED, row(ORG_ID, { displayName: "Advised", role: "VIEWER" })));
    expect(((await screen.findByLabelText("Organization")) as HTMLSelectElement).value).toBe(ORG_ID);
  });
});
