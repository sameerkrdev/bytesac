import { APPLICATION_TRANSITIONS } from "@repo/validator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TransitionForm } from "@/components/ops/transition-form";

describe("TransitionForm", () => {
  it("offers only the allowed targets for the current status", () => {
    render(<TransitionForm status="SUBMITTED" pending={false} onSubmit={vi.fn()} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Select a status", "In review", "Not approved"]);
    expect(APPLICATION_TRANSITIONS.SUBMITTED).toHaveLength(2);
  });

  it("offers nothing for terminal statuses", () => {
    render(<TransitionForm status="SCREENING_REJECTED" pending={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/No further status changes/)).toBeInTheDocument();
  });

  it("requires a message to the applicant for additional information", async () => {
    const onSubmit = vi.fn();
    render(<TransitionForm status="SCREENING" pending={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Move to"), "ADDITIONAL_INFORMATION_REQUIRED");
    expect(screen.getByRole("button", { name: "Update status" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Message to applicant/), "Send proof");
    await userEvent.click(screen.getByRole("button", { name: "Update status" }));
    expect(onSubmit).toHaveBeenCalledWith({ to: "ADDITIONAL_INFORMATION_REQUIRED", internalNote: undefined, messageToApplicant: "Send proof" });
  });

  it("does not require a message for other targets", async () => {
    const onSubmit = vi.fn();
    render(<TransitionForm status="SCREENING" pending={false} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Move to"), "CONTACTED");
    await userEvent.click(screen.getByRole("button", { name: "Update status" }));
    expect(onSubmit).toHaveBeenCalledWith({ to: "CONTACTED", internalNote: undefined, messageToApplicant: undefined });
  });
});
