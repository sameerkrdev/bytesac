import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetEditor } from "@/components/ops/assets/asset-editor";
import { ASSET_ID, T, asset, lookups, renderAs } from "./asset-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const tags = [
  { id: "tag-1", key: "layer-1", label: "Layer 1", status: "active", createdAt: T, retiredAt: null },
  { id: "tag-2", key: "old", label: "Old", status: "retired", createdAt: T, retiredAt: T },
  { id: "tag-3", key: "gone", label: "Gone", status: "retired", createdAt: T, retiredAt: T },
] as const;
const editor = (detail = asset(), extra: Record<string, unknown> = {}) => {
  const client = { ...lookups(), opsListAssetTags: vi.fn().mockResolvedValue({ tags }), opsGetAsset: vi.fn().mockResolvedValue(detail), opsUpdateAsset: vi.fn().mockResolvedValue(detail), ...extra };
  renderAs(<AssetEditor id={ASSET_ID} client={client as never} />);
  return client;
};

describe("Asset sector and tags", () => {
  it("saves the sector and the picked tags", async () => {
    const c = editor();
    await userEvent.selectOptions(await screen.findByLabelText("Sector"), "stablecoin");
    await userEvent.click(await screen.findByLabelText("Layer 1"));
    await userEvent.click(screen.getByRole("button", { name: "Save sector and tags" }));
    expect(c.opsUpdateAsset).toHaveBeenCalledWith(ASSET_ID, { sector: "stablecoin", tagIds: ["tag-1"] });
  });

  it("offers active tags and the retired tags already on the asset (so they can be removed), not other retired ones", async () => {
    const c = editor(asset({ sector: "defi", tags: [{ id: "tag-2", key: "old", label: "Old" }] }));
    expect(await screen.findByLabelText("Sector")).toHaveValue("defi");
    expect(await screen.findByLabelText(/Old/)).toBeChecked();
    expect(screen.queryByLabelText(/Gone/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Old/));
    await userEvent.click(screen.getByRole("button", { name: "Save sector and tags" }));
    expect(c.opsUpdateAsset).toHaveBeenCalledWith(ASSET_ID, { sector: "defi", tagIds: [] });
  });

  it("is editable on a live asset", async () => {
    editor(asset({ status: "ACTIVE" }));
    expect(await screen.findByLabelText("Sector")).toBeEnabled();
  });

  it("is disabled while the asset is under review", async () => {
    editor(asset({ status: "UNDER_REVIEW" }));
    expect(await screen.findByLabelText("Sector")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save sector and tags" })).not.toBeInTheDocument();
  });
});
