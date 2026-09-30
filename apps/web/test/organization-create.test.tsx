import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateOrganization } from "@/components/organization/create-organization";
import { orgDetail } from "./org-fixtures";

describe("CreateOrganization", () => {
  it("submits type and uppercased jurisdiction", async () => {
    const created = orgDetail({ type: "firm" });
    const createOrganization = vi.fn().mockResolvedValue(created);
    const onCreated = vi.fn();
    render(<CreateOrganization client={{ createOrganization }} onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("radio", { name: "Firm" }));
    await userEvent.type(screen.getByLabelText(/Country/), "gb");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(createOrganization).toHaveBeenCalledWith({ type: "firm", jurisdiction: "GB" });
  });

  it("shows a field error for an invalid jurisdiction and does not call the API", async () => {
    const createOrganization = vi.fn();
    render(<CreateOrganization client={{ createOrganization }} onCreated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Country/), "G");
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(screen.getByText(/ISO 3166-1 alpha-2/)).toBeInTheDocument();
    expect(createOrganization).not.toHaveBeenCalled();
  });
});
