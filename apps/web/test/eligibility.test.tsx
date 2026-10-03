import { ApiError } from "@repo/api-client";
import { ELIGIBILITY_ATTESTATION, type EligibilityResponse } from "@repo/validator";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asset, deployment, renderAs } from "./asset-fixtures";
import { operation, renderApp } from "./invest-fixtures";

const api = {
  declareEligibility: vi.fn(), getEligibility: vi.fn(), investPlan: vi.fn(), cancelOperation: vi.fn(), getOperation: vi.fn(),
};
vi.mock("@/lib/api", () => ({
  api: {
    declareEligibility: (b: unknown) => api.declareEligibility(b), getEligibility: () => api.getEligibility(),
    investPlan: (b: unknown) => api.investPlan(b), cancelOperation: (id: string) => api.cancelOperation(id), getOperation: (id: string) => api.getOperation(id),
  },
}));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { InvestWizard } from "@/components/invest/invest-wizard";
import { AssetDeployments } from "@/components/ops/assets/asset-deployments";
import { AssetRules } from "@/components/ops/assets/asset-rules";
import { EligibilitySection } from "@/components/profile/eligibility-section";

const view = (over: Partial<NonNullable<EligibilityResponse["declaration"]>> = {}): EligibilityResponse => ({
  declaration: { country: "DE", investorStatus: "retail", attestationVersion: ELIGIBILITY_ATTESTATION.version, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2027-10-01T00:00:00.000Z", expired: false, ...over },
});
const save = () => screen.getByRole("button", { name: "Save declaration" });
const fill = async () => {
  await userEvent.selectOptions(screen.getByLabelText("Country of residence"), "DE");
  await userEvent.click(screen.getByRole("radio", { name: /Accredited investor/ }));
  await userEvent.click(screen.getByRole("checkbox"));
};

beforeEach(() => vi.clearAllMocks());

describe("DeclarationForm", () => {
  it("needs a country, an investor status and the attestation before it can be saved", async () => {
    renderApp(<DeclarationForm />);
    expect(save()).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Country of residence"), "DE");
    await userEvent.click(screen.getByRole("radio", { name: /Retail investor/ }));
    expect(save()).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(save()).toBeEnabled();
    expect(screen.getByText(ELIGIBILITY_ATTESTATION.text)).toBeInTheDocument();
  });

  it("sends the declaration with the attestation version and reports it saved", async () => {
    api.declareEligibility.mockResolvedValue(view());
    const onSaved = vi.fn();
    renderApp(<DeclarationForm onSaved={onSaved} />);
    await fill();
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.declareEligibility).toHaveBeenCalledWith({ country: "DE", investorStatus: "accredited", attestationVersion: ELIGIBILITY_ATTESTATION.version });
  });

  it("shows the server's refusal", async () => {
    api.declareEligibility.mockRejectedValue(new ApiError("RATE_LIMITED", 429, "slow down"));
    renderApp(<DeclarationForm />);
    await fill();
    await userEvent.click(save());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("Profile eligibility section", () => {
  it("shows the current declaration and when it expires", async () => {
    api.getEligibility.mockResolvedValue(view());
    renderApp(<EligibilitySection />);
    expect(await screen.findByText("Germany · Retail investor")).toBeInTheDocument();
    expect(screen.getByText(/Valid until/)).toBeInTheDocument();
  });

  it("flags an expired declaration and asks for a new one when there is none", async () => {
    api.getEligibility.mockResolvedValue(view({ expired: true }));
    const { unmount } = renderApp(<EligibilitySection />);
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    unmount();
    api.getEligibility.mockResolvedValue({ declaration: null });
    renderApp(<EligibilitySection />);
    expect(await screen.findByText("You have not declared yet.")).toBeInTheDocument();
  });
});

describe("Inline declaration when a plan needs one", () => {
  it("shows the form on DECLARATION_REQUIRED and retries the plan once it is saved", async () => {
    api.investPlan.mockRejectedValueOnce(new ApiError("DECLARATION_REQUIRED", 409, "Declare first")).mockResolvedValue(operation());
    api.declareEligibility.mockResolvedValue(view());
    renderApp(<InvestWizard basketId="b" name="Core" minimumUsdc="250" incrementUsdc={null} open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Get preview" }));
    expect(await screen.findByLabelText("Country of residence")).toBeInTheDocument();
    expect(screen.queryByText("Eligibility declaration needed")).toBeNull();
    await fill();
    await userEvent.click(save());
    await waitFor(() => expect(api.investPlan).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Continue to signing")).toBeInTheDocument();
  });
});

describe("Ops eligibility fields", () => {
  const rules = (client: object) => renderAs(<AssetRules a={asset({ assetType: "TOKENIZED_FUND" })} locked={false} isAdmin onChange={vi.fn()} client={client as never} />);

  it("a rule can be limited to investor statuses; none selected means every status", async () => {
    const opsCreateRule = vi.fn().mockResolvedValue(asset());
    rules({ opsCreateRule, opsUpdateRule: vi.fn() });
    await userEvent.type(screen.getByLabelText(/Jurisdiction/), "DE");
    await userEvent.click(screen.getByRole("checkbox", { name: "accredited" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "professional" }));
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(opsCreateRule).toHaveBeenCalledWith(asset().id, expect.objectContaining({ jurisdiction: "DE", investorStatuses: ["accredited", "professional"] })));
  });

  it("an admin flags a deployment as permissioned; a reviewer cannot", async () => {
    const opsSetPermissioned = vi.fn().mockResolvedValue(asset());
    const view = (roles: Parameters<typeof renderAs>[1], d = deployment()) => renderAs(<AssetDeployments a={asset({ deployments: [d] })} locked={false} isAdmin={roles?.includes("ops_admin") ?? false} onChange={vi.fn()} client={{ opsSetPermissioned } as never} />, roles);
    const { unmount } = view(["ops_admin"]);
    await userEvent.click(await screen.findByRole("button", { name: "Flag as permissioned" }));
    await waitFor(() => expect(opsSetPermissioned).toHaveBeenCalledWith(asset().id, deployment().id, { permissioned: true }));
    unmount();
    view(["ops_reviewer"], deployment({ permissioned: true }));
    expect(await screen.findByText(/Permissioned: restricts who can hold it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /permissioned flag|Flag as permissioned/ })).toBeNull();
  });
});
