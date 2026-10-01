import type { AssetTagView } from "@repo/validator";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetTags } from "@/components/ops/asset-tags";
import { renderAs, T } from "./asset-fixtures";

const tag = (over: Partial<AssetTagView> = {}): AssetTagView => ({ id: "tag-1", key: "layer-1", label: "Layer 1", status: "active", createdAt: T, retiredAt: null, ...over });
const client = (tags = [tag(), tag({ id: "tag-2", key: "old", label: "Old", status: "retired", retiredAt: T })]) => ({
  opsListAssetTags: vi.fn().mockResolvedValue({ tags }),
  opsCreateAssetTag: vi.fn().mockResolvedValue(tag({ id: "tag-3", key: "defi", label: "DeFi" })),
  opsRetireAssetTag: vi.fn().mockResolvedValue(tag({ status: "retired", retiredAt: T })),
});

describe("Ops asset tags", () => {
  it("lists active and retired tags, offering retire on active ones only", async () => {
    renderAs(<AssetTags client={client()} />);
    expect(await screen.findByText("Layer 1")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/^Retired /)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Retire / })).toHaveLength(1);
  });

  it("creates a tag from a valid key and label, and refuses an invalid key", async () => {
    const c = client();
    renderAs(<AssetTags client={c} />);
    await userEvent.type(await screen.findByLabelText(/^Key/), "Not Valid!");
    await userEvent.type(screen.getByLabelText("Label"), "DeFi");
    await userEvent.click(screen.getByRole("button", { name: "Create tag" }));
    expect(c.opsCreateAssetTag).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Use a 2 to 32 character key");

    await userEvent.clear(screen.getByLabelText(/^Key/));
    await userEvent.type(screen.getByLabelText(/^Key/), "defi");
    await userEvent.click(screen.getByRole("button", { name: "Create tag" }));
    expect(c.opsCreateAssetTag).toHaveBeenCalledWith({ key: "defi", label: "DeFi" });
  });

  it("retires a tag after confirmation", async () => {
    const c = client();
    renderAs(<AssetTags client={c} />);
    await userEvent.click(await screen.findByRole("button", { name: "Retire layer-1" }));
    expect(c.opsRetireAssetTag).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(c.opsRetireAssetTag).toHaveBeenCalledWith("tag-1");
  });

  it("is admin only", () => {
    const c = client();
    renderAs(<AssetTags client={c} />, ["ops_reviewer"]);
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have access to this area.");
    expect(c.opsListAssetTags).not.toHaveBeenCalled();
  });
});
