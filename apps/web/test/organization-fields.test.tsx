import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizationFields } from "@/components/organization/organization-fields";
import { orgDetail, version } from "./org-fixtures";

const next = () => userEvent.click(screen.getByRole("button", { name: /Continue/ }));

describe("OrganizationFields (stepped)", () => {
  it("walks public profile, private details and review, marking optional fields", async () => {
    render(<OrganizationFields org={orgDetail()} version={version()} readOnly={false} onChange={vi.fn()} client={{ updateOrganizationDraft: vi.fn() }} />);
    expect(screen.getByRole("heading", { name: "Public profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Website (optional)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Legal name")).toBeNull();
    await next();
    expect(screen.getByRole("heading", { name: "Private details (never shown publicly)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal company name/)).toBeNull();
    await next();
    expect(screen.getByRole("heading", { name: "Review and save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
  });

  it("stops on a step with an invalid value and keeps every typed value", async () => {
    const updateOrganizationDraft = vi.fn();
    render(<OrganizationFields org={orgDetail()} version={version()} readOnly={false} onChange={vi.fn()} client={{ updateOrganizationDraft }} />);
    await userEvent.type(screen.getByLabelText("Display name"), "Ada Capital");
    await userEvent.type(screen.getByLabelText("Website (optional)"), "http://example.com");
    await next();
    expect(screen.getByLabelText("Website (optional)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada Capital");
    expect(screen.getByLabelText("Website (optional)")).toHaveValue("http://example.com");
    expect(updateOrganizationDraft).not.toHaveBeenCalled();
  });

  it("saves only filled fields, split by visibility, on the last step", async () => {
    const saved = orgDetail();
    const updateOrganizationDraft = vi.fn().mockResolvedValue(saved);
    const onChange = vi.fn();
    render(<OrganizationFields org={orgDetail()} version={version()} readOnly={false} onChange={onChange} client={{ updateOrganizationDraft }} />);
    await userEvent.type(screen.getByLabelText("Display name"), "Ada Capital");
    await next();
    await userEvent.type(screen.getByLabelText("Legal name"), "Ada Lovelace");
    await next();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(updateOrganizationDraft).toHaveBeenCalledWith(saved.id, { publicProfile: { displayName: "Ada Capital" }, privateDetails: { legalName: "Ada Lovelace" } });
    expect(onChange).toHaveBeenCalledWith(saved);
  });

  it("is a read-only summary without a save button", () => {
    render(<OrganizationFields org={orgDetail()} version={version({ publicProfile: { displayName: "Ada" } })} readOnly onChange={vi.fn()} client={{ updateOrganizationDraft: vi.fn() }} />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});
