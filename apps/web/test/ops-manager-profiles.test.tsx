import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManagerProfiles } from "@/components/ops/manager-profiles";
import { renderAs, T } from "./asset-fixtures";

const row = (over: object = {}) => ({ id: "p1", handle: "ada-l", displayName: "Ada", status: "published", hiddenReason: null, publishedAt: T, updatedAt: T, ...over });
const client = (items = [row()]) => ({
  opsListManagerProfiles: vi.fn().mockResolvedValue({ items, nextCursor: null }),
  opsHideManagerProfile: vi.fn().mockResolvedValue({}),
  opsUnhideManagerProfile: vi.fn().mockResolvedValue({}),
});

describe("Ops manager profiles", () => {
  it("lists published profiles by default and re-queries by status", async () => {
    const c = client();
    renderAs(<ManagerProfiles client={c as never} />, ["ops_reviewer"]);
    expect(await screen.findByText("@ada-l")).toBeInTheDocument();
    expect(c.opsListManagerProfiles).toHaveBeenCalledWith({ status: "published" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "hidden");
    expect(c.opsListManagerProfiles).toHaveBeenLastCalledWith({ status: "hidden" });
  });

  it("hiding needs a reason and a confirmation", async () => {
    const c = client();
    renderAs(<ManagerProfiles client={c as never} />, ["ops_reviewer"]);
    await userEvent.click(await screen.findByRole("button", { name: "Hide ada-l" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Reason for hiding"), "Misleading claims");
    await userEvent.click(confirm);
    expect(c.opsHideManagerProfile).toHaveBeenCalledWith("p1", { reason: "Misleading claims" });
  });

  it("unhides a hidden profile and shows its reason", async () => {
    const c = client([row({ status: "hidden", hiddenReason: "Misleading claims" })]);
    renderAs(<ManagerProfiles client={c as never} />, ["ops_reviewer"]);
    expect(await screen.findByText("Reason: Misleading claims")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide ada-l" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unhide ada-l" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(c.opsUnhideManagerProfile).toHaveBeenCalledWith("p1");
  });
});
