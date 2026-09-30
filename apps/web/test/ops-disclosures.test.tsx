import type { DisclosureTemplateView } from "@repo/validator";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DisclosureTemplates } from "@/components/ops/baskets/disclosure-templates";
import { renderAs } from "./asset-fixtures";

const T = "2026-09-30T00:00:00.000Z";
const tpl = (over: Partial<DisclosureTemplateView> = {}): DisclosureTemplateView => ({ id: "t1", key: "no_guarantee", version: 1, title: "No guarantee", body: "Nothing is guaranteed.", condition: "always", status: "active", createdAt: T, retiredAt: null, ...over });
const client = (groups = [{ key: "no_guarantee", templates: [tpl()] }]) => ({
  opsListDisclosureTemplates: vi.fn().mockResolvedValue({ groups }),
  opsCreateDisclosureTemplate: vi.fn().mockResolvedValue({ groups: [{ key: "no_guarantee", templates: [tpl({ version: 2, id: "t2" }), tpl({ status: "retired" })] }] }),
  opsRetireDisclosureTemplate: vi.fn().mockResolvedValue({ groups }),
});

describe("Disclosure templates", () => {
  it("lists templates by key with versions and status", async () => {
    renderAs(<DisclosureTemplates client={client([{ key: "no_guarantee", templates: [tpl({ version: 2, id: "t2" }), tpl({ status: "retired", retiredAt: T })] }])} />);
    const group = await screen.findByRole("region", { name: "no_guarantee" });
    expect(group).toHaveTextContent("Version 2: No guarantee");
    expect(group).toHaveTextContent("Version 1: No guarantee · Retired");
  });

  it("creates the next version from the form", async () => {
    const c = client();
    renderAs(<DisclosureTemplates client={c} />);
    await userEvent.click(await screen.findByRole("button", { name: "New version of no_guarantee" }));
    const form = screen.getByRole("form", { name: "New version of no_guarantee" });
    await userEvent.clear(within(form).getByLabelText("Title"));
    await userEvent.type(within(form).getByLabelText("Title"), "No guarantee of returns");
    await userEvent.selectOptions(within(form).getByLabelText("Shown when"), "has_stablecoin");
    await userEvent.click(within(form).getByRole("button", { name: "Publish new version" }));
    expect(c.opsCreateDisclosureTemplate).toHaveBeenCalledWith({ key: "no_guarantee", title: "No guarantee of returns", body: "Nothing is guaranteed.", condition: "has_stablecoin" });
  });

  it("does not submit an empty body", async () => {
    renderAs(<DisclosureTemplates client={client()} />);
    await userEvent.click(await screen.findByRole("button", { name: "New version of no_guarantee" }));
    const form = screen.getByRole("form", { name: "New version of no_guarantee" });
    await userEvent.clear(within(form).getByLabelText("Body (plain text)"));
    expect(within(form).getByRole("button", { name: "Publish new version" })).toBeDisabled();
  });

  it("retires the active version after confirming", async () => {
    const c = client();
    renderAs(<DisclosureTemplates client={c} />);
    await userEvent.click(await screen.findByRole("button", { name: "Retire version 1 of no_guarantee" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(c.opsRetireDisclosureTemplate).toHaveBeenCalledWith("t1");
  });

  it("is admin only", () => {
    renderAs(<DisclosureTemplates client={client()} />, ["ops_reviewer"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Only ops admins");
  });
});
