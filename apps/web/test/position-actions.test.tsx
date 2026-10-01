import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Headline } from "@repo/validator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ID, position, renderApp } from "./invest-fixtures";

const keepCustom = vi.fn().mockResolvedValue(undefined);
const revertCustom = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({ api: { keepCustom: (...a: unknown[]) => keepCustom(...a), revertCustom: (...a: unknown[]) => revertCustom(...a) } }));
import { PositionActions } from "@/components/portfolio/position-actions";

const latestVersion = { id: ID(50), number: 2, rationale: "Rotate", diff: { added: [], removed: [], changed: [], bandChanged: [], constraints: false, rebalance: false, fees: false, minimums: false } };
const show = (headline: Headline, o: Parameters<typeof position>[0] = {}, repairAsset?: string) => renderApp(<PositionActions position={position({ headline, ...o })} repairAsset={repairAsset} />);
const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => vi.clearAllMocks());

describe("PositionActions", () => {
  it("REBALANCE_AVAILABLE offers Review update to the latest version", () => {
    show("REBALANCE_AVAILABLE", { latestVersion, states: { version: "OUT_OF_DATE", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" } });
    expect(screen.getByText("New version available")).toBeInTheDocument();
    expect(href("Review update")).toBe(`/portfolio/${ID(40)}/rebalance?target=latest`);
  });

  it("a skipped version still offers Review update, without raising the badge", () => {
    show("ALIGNED", { latestVersion, states: { version: "SKIPPED", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" } });
    expect(screen.getByText("Aligned")).toBeInTheDocument();
    expect(screen.getByText("You skipped version 2")).toBeInTheDocument();
    expect(href("Review update")).toContain("target=latest");
  });

  it("DRIFTED offers Rebalance to target and Keep custom, which calls the API", async () => {
    show("DRIFTED");
    expect(href("Rebalance to target")).toBe(`/portfolio/${ID(40)}/rebalance?target=applied`);
    await userEvent.click(screen.getByRole("button", { name: "Keep custom" }));
    expect(keepCustom).toHaveBeenCalledWith(ID(40));
  });

  it("CUSTOMIZED offers Revert custom", async () => {
    show("CUSTOMIZED");
    await userEvent.click(screen.getByRole("button", { name: "Revert custom" }));
    expect(revertCustom).toHaveBeenCalledWith(ID(40));
  });

  it("REPAIR_REQUIRED links to the repair page of the short asset", () => {
    show("REPAIR_REQUIRED", {}, ID(30));
    expect(href("Repair")).toBe(`/portfolio/repair/${ID(30)}`);
  });

  it("EXECUTION_INCOMPLETE continues to the same target", () => {
    show("EXECUTION_INCOMPLETE");
    expect(href("Continue")).toContain("target=applied");
  });

  it("EXECUTION_PENDING links to the open operation", () => {
    show("EXECUTION_PENDING");
    expect(href("View operation")).toBe("#open-operations");
  });

  it("ALIGNED has no action", () => {
    show("ALIGNED");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
