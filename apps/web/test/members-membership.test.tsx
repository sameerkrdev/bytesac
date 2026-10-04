import { ApiError } from "@repo/api-client";
import type { MemberVerificationView, MyMembership } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const getMemberVerification = vi.fn();
const updateMemberVerification = vi.fn();
const submitMemberVerification = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    getMemberVerification: (mid: string) => getMemberVerification(mid), updateMemberVerification: (...a: unknown[]) => updateMemberVerification(...a),
    submitMemberVerification: (mid: string) => submitMemberVerification(mid),
    presignMemberDocument: vi.fn(), confirmMemberDocument: vi.fn(), unlinkMemberDocument: vi.fn(),
  },
}));
import { MemberVerification } from "@/components/members/member-verification";
import { MembershipPage } from "@/components/members/membership-profile";

const MID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e70";
const membership = (over: Partial<MyMembership> = {}): MyMembership => ({
  id: MID, organizationId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", role: "ANALYST", requestedRole: null, status: "ACTIVE", publicDisplayName: null, publicTitle: null, ...over,
});
const view = (over: Partial<MemberVerificationView> = {}): MemberVerificationView => ({
  membershipId: MID, membershipStatus: "PENDING_DOCUMENTS", role: "MANAGER", requestedRole: null, organization: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", displayName: "Ada Capital" },
  status: "draft", details: {}, documents: [], template: { requiredFields: ["legalName", "dateOfBirth", "residentialAddress", "professionalHistory"], requiredDocuments: ["government_id", "proof_of_address"] },
  missing: { fields: ["legalName"], documents: ["government_id"] }, submittedAt: null, latestMessageToMember: null, ...over,
});
const client = (m: MyMembership, over: Record<string, unknown> = {}) => ({ getMembership: vi.fn().mockResolvedValue(m), updateMembershipProfile: vi.fn(), leaveOrganization: vi.fn(), ...over });
const page = (c: ReturnType<typeof client>) => render(<QueryClientProvider client={new QueryClient()}><MembershipPage mid={MID} client={c} /></QueryClientProvider>);

beforeEach(() => { push.mockReset(); getMemberVerification.mockReset(); updateMemberVerification.mockReset(); submitMemberVerification.mockReset(); });

describe("Membership page profile", () => {
  it("saves the public name and title, and null clears a value", async () => {
    const c = client(membership({ publicDisplayName: "Old Name", publicTitle: "Analyst" }), { updateMembershipProfile: vi.fn().mockResolvedValue(membership({ publicDisplayName: "Ada L." })) });
    page(c);
    const name = await screen.findByLabelText("Public name");
    expect(name).toHaveValue("Old Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Ada L.");
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.updateMembershipProfile).toHaveBeenCalledWith(MID, { publicDisplayName: "Ada L.", publicTitle: null });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("rejects a one-letter public name before calling the API", async () => {
    const c = client(membership());
    page(c);
    await userEvent.type(await screen.findByLabelText("Public name"), "A");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.updateMembershipProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Public name")).toHaveAttribute("aria-invalid", "true");
  });

  it("ANALYST/VIEWER have no verification section; an active member can leave after confirming", async () => {
    const c = client(membership(), { leaveOrganization: vi.fn().mockResolvedValue(membership({ status: "REVOKED" })) });
    page(c);
    await userEvent.click(await screen.findByRole("button", { name: "Leave organization" }));
    expect(c.leaveOrganization).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave" }));
    expect(c.leaveOrganization).toHaveBeenCalledWith(MID);
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/home"));
    expect(getMemberVerification).not.toHaveBeenCalled();
  });

  it("the owner cannot leave", async () => {
    page(client(membership({ role: "OWNER" })));
    await screen.findByLabelText("Public name");
    expect(screen.queryByRole("button", { name: "Leave organization" })).toBeNull();
  });

  it("shows the verification of a MANAGER", async () => {
    getMemberVerification.mockResolvedValue(view());
    page(client(membership({ role: "MANAGER", status: "PENDING_DOCUMENTS" })));
    expect(await screen.findByRole("heading", { name: "Identity verification" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public profile", level: 3 })).toBeNull();
  });
});

describe("MemberVerification", () => {
  const show = () => render(<QueryClientProvider client={new QueryClient()}><MemberVerification mid={MID} /></QueryClientProvider>);

  it("shows the member fields and documents only, and the checklist disables submit", async () => {
    getMemberVerification.mockResolvedValue(view());
    show();
    expect(await screen.findByLabelText("Legal name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(screen.queryByText(/licen/i)).toBeNull();
    expect(screen.getByText("Government ID")).toBeInTheDocument();
    expect(screen.getByText("Fill in: Legal name")).toBeInTheDocument();
    expect(screen.getByText("Upload: Government ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("saves details through the member endpoint", async () => {
    getMemberVerification.mockResolvedValue(view());
    updateMemberVerification.mockResolvedValue(view({ details: { legalName: "Ada Lovelace" } }));
    show();
    await userEvent.type(await screen.findByLabelText("Legal name"), "Ada Lovelace");
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(updateMemberVerification).toHaveBeenCalledWith(MID, { details: { legalName: "Ada Lovelace" } });
  });

  it("submits when complete and becomes read-only", async () => {
    getMemberVerification.mockResolvedValue(view({ missing: { fields: [], documents: [] } }));
    submitMemberVerification.mockResolvedValue(view({ status: "in_review", membershipStatus: "UNDER_REVIEW", missing: { fields: [], documents: [] } }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    expect(submitMemberVerification).toHaveBeenCalledWith(MID);
    expect(await screen.findByText("In review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit|resubmit/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull(); // read-only summary
  });

  it("shows the ops message on changes required and allows resubmitting", async () => {
    getMemberVerification.mockResolvedValue(view({ status: "changes_required", membershipStatus: "CHANGES_REQUIRED", latestMessageToMember: "Upload a clearer ID.", missing: { fields: [], documents: [] } }));
    show();
    expect(await screen.findByText("Upload a clearer ID.")).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeEnabled();
  });

  it("refreshes the checklist when the API says requirements are incomplete", async () => {
    getMemberVerification.mockResolvedValue(view({ missing: { fields: [], documents: [] } }));
    submitMemberVerification.mockRejectedValue(new ApiError("REQUIREMENTS_INCOMPLETE", 422, "no"));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not ready to submit");
    await vi.waitFor(() => expect(getMemberVerification).toHaveBeenCalledTimes(2));
  });
});
