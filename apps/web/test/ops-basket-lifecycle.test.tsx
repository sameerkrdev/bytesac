import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BasketReview } from "@/components/ops/baskets/basket-review";
import { renderAs } from "./asset-fixtures";
import { BID, basketVersion, opsBasketDetail } from "./org-fixtures";

type Detail = Parameters<typeof opsBasketDetail>[0];
const view = (roles: Array<"ops_admin" | "ops_reviewer">, detail: Detail, over: Record<string, unknown> = {}) => {
  const c = {
    opsGetBasket: vi.fn().mockResolvedValue(opsBasketDetail({ openVersion: null, publishedVersion: basketVersion({ status: "published" }), ...detail })),
    opsDecideBasketVersion: vi.fn(), opsDecideBasketLead: vi.fn(), opsPauseBasket: vi.fn().mockResolvedValue(opsBasketDetail()), opsResumeBasket: vi.fn().mockResolvedValue(opsBasketDetail()),
    opsRetireBasket: vi.fn().mockResolvedValue(opsBasketDetail()), opsDecideBasketRetirement: vi.fn().mockResolvedValue(opsBasketDetail()), ...over,
  };
  renderAs(<BasketReview bid={BID} client={c} />, roles);
  return c;
};
const has = (name: string) => screen.queryByRole("button", { name }) !== null;
const confirm = async (open: string, reason?: string) => {
  await userEvent.click(screen.getByRole("button", { name: open }));
  const dialog = await screen.findByRole("dialog");
  if (reason) await userEvent.type(within(dialog).getByLabelText("Reason"), reason);
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
};

describe("Platform lifecycle controls", () => {
  it("a reviewer can pause but not resume or retire", async () => {
    view(["ops_reviewer"], { status: "ACTIVE" });
    await screen.findByRole("region", { name: "Platform actions" });
    expect(has("Pause basket")).toBe(true);
    expect(has("Resume basket")).toBe(false);
    expect(has("Retire basket")).toBe(false);
  });

  it("platform resume is hidden for a reviewer", async () => {
    view(["ops_reviewer"], { status: "PAUSED", pauseKind: "platform", pauseReason: "review" });
    await screen.findByRole("region", { name: "Platform actions" });
    expect(has("Resume basket")).toBe(false);
  });

  it("an admin resumes a platform pause after confirming", async () => {
    const c = view(["ops_admin"], { status: "PAUSED", pauseKind: "platform", pauseReason: "review" });
    await screen.findByRole("region", { name: "Platform actions" });
    await confirm("Resume basket");
    expect(c.opsResumeBasket).toHaveBeenCalledWith(BID);
  });

  it("pausing needs a reason", async () => {
    const c = view(["ops_reviewer"], { status: "ACTIVE" });
    await screen.findByRole("region", { name: "Platform actions" });
    await userEvent.click(screen.getByRole("button", { name: "Pause basket" }));
    expect(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("Reason"), "Investigating");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(c.opsPauseBasket).toHaveBeenCalledWith(BID, { reason: "Investigating" });
  });

  it("an admin retires directly with a reason", async () => {
    const c = view(["ops_admin"], { status: "ACTIVE" });
    await screen.findByRole("region", { name: "Platform actions" });
    await confirm("Retire basket", "Wound down");
    expect(c.opsRetireBasket).toHaveBeenCalledWith(BID, { reason: "Wound down" });
  });

  it("an admin decides a retirement request; a reviewer cannot", async () => {
    const c = view(["ops_admin"], { status: "RETIREMENT_PENDING" });
    await screen.findByRole("region", { name: "Platform actions" });
    await confirm("Approve retirement");
    expect(c.opsDecideBasketRetirement).toHaveBeenCalledWith(BID, { decision: "approved" });
  });

  it("a reviewer sees the retirement request but no decision buttons", async () => {
    view(["ops_reviewer"], { status: "RETIREMENT_PENDING" });
    expect(await screen.findByText("Only an ops admin can decide.")).toBeInTheDocument();
    expect(has("Approve retirement")).toBe(false);
    expect(has("Decline retirement")).toBe(false);
  });
});
