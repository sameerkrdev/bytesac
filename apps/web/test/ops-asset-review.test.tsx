import { ApiError } from "@repo/api-client";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetDecisionForm, AssetReviewPanel } from "@/components/ops/assets/asset-review-panel";
import { ADMIN, ASSET_ID, SUBMITTER, asset, renderAs } from "./asset-fixtures";

const panel = (over: Parameters<typeof asset>[0], roles: Parameters<typeof renderAs>[1] = ["ops_admin"], userId = ADMIN, extra: Record<string, unknown> = {}) => {
  const client = { opsSubmitAsset: vi.fn().mockResolvedValue(asset()), opsDecideAsset: vi.fn().mockResolvedValue(asset()), opsAssetAction: vi.fn().mockResolvedValue(asset()), ...extra };
  const onChange = vi.fn();
  renderAs(<AssetReviewPanel a={asset(over)} isAdmin={roles.includes("ops_admin")} onChange={onChange} client={client} />, roles, userId);
  return { client, onChange };
};

describe("submit checklist", () => {
  it("lists the missing requirements and blocks submit", () => {
    panel({ missing: ["deployment", "market_price_reference"] });
    expect(screen.getByText("Add at least one deployment.")).toBeInTheDocument();
    expect(screen.getByText("Add a market price reference (CoinMarketCap id).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("submits when complete", async () => {
    const { client, onChange } = panel({});
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(client.opsSubmitAsset).toHaveBeenCalledWith(ASSET_ID);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("says Resubmit for CHANGES_REQUIRED", () => {
    panel({ status: "CHANGES_REQUIRED" });
    expect(screen.getByRole("button", { name: "Resubmit for review" })).toBeEnabled();
  });
});

describe("AssetDecisionForm", () => {
  it("blocks changes required without a message", async () => {
    const onSubmit = vi.fn();
    renderAs(<AssetDecisionForm pending={false} onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", { name: "Submit decision" });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "changes_required");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Message to the editor (required)"), "Add the issuer");
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ decision: "changes_required", message: "Add the issuer", internalNote: undefined });
  });

  it("approval needs no message", async () => {
    const onSubmit = vi.fn();
    renderAs(<AssetDecisionForm pending={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "approved");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(onSubmit).toHaveBeenCalledWith({ decision: "approved", message: undefined, internalNote: undefined });
  });
});

describe("review access", () => {
  it("hides the decision form from an ops_reviewer", () => {
    panel({ status: "UNDER_REVIEW", submittedByUserId: SUBMITTER }, ["ops_reviewer"]);
    expect(screen.queryByLabelText("Decision")).toBeNull();
    expect(screen.getByText("Waiting for an admin to review this asset.")).toBeInTheDocument();
  });

  it("hides lifecycle buttons from an ops_reviewer", () => {
    panel({ status: "ACTIVE" }, ["ops_reviewer"]);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("tells the submitting admin another admin must review", () => {
    panel({ status: "UNDER_REVIEW", submittedByUserId: ADMIN });
    expect(screen.getByText("You submitted this asset — another admin must review it.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Decision")).toBeNull();
  });

  it("another admin gets the decision form", () => {
    panel({ status: "UNDER_REVIEW", submittedByUserId: SUBMITTER });
    expect(screen.getByLabelText("Decision")).toBeInTheDocument();
  });

  it("shows the access-lost state when the decision is refused with 403", async () => {
    panel({ status: "UNDER_REVIEW", submittedByUserId: SUBMITTER }, ["ops_admin"], ADMIN, { opsDecideAsset: vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")) });
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "approved");
    await userEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role may have been removed");
  });
});

describe("lifecycle", () => {
  const confirm = async (open: string) => {
    await userEvent.click(screen.getByRole("button", { name: open }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
  };

  it.each([
    ["APPROVED", "Activate", "activate"], ["ACTIVE", "Pause", "pause"], ["PAUSED", "Resume", "resume"], ["ACTIVE", "Deprecate", "deprecate"], ["DRAFT", "Retire", "retire"],
  ] as const)("%s: %s calls %s after confirming", async (status, label, action) => {
    const { client } = panel({ status });
    await confirm(label);
    expect(client.opsAssetAction).toHaveBeenCalledWith(ASSET_ID, action);
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { client } = panel({ status: "ACTIVE" });
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(client.opsAssetAction).not.toHaveBeenCalled();
  });

  it("shows the servers message when the change is refused", async () => {
    panel({ status: "ACTIVE" }, ["ops_admin"], ADMIN, { opsAssetAction: vi.fn().mockRejectedValue(new ApiError("INVALID_TRANSITION", 409, "This asset is retired.")) });
    await confirm("Pause");
    expect(await screen.findByRole("alert")).toHaveTextContent("This asset is retired.");
  });
});
