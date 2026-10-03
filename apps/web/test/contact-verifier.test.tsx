import { ApiError } from "@repo/api-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContactVerifier } from "@/components/contacts/contact-verifier";

const contact = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", type: "email" as const, value: "a@b.co", status: "unverified" as const, verifiedAt: null };
const later = new Date(Date.now() + 60_000).toISOString();

function client() {
  return {
    addContact: vi.fn(async () => ({ contact, verification: { expiresAt: later, resendAvailableAt: later } })),
    verifyContact: vi.fn(async () => ({ ...contact, status: "verified" as const, verifiedAt: new Date().toISOString() })),
    resendContact: vi.fn(async () => ({ contact, verification: { expiresAt: later, resendAvailableAt: later } })),
  };
}

describe("ContactVerifier", () => {
  it("send → code → verified; resend disabled during cooldown", async () => {
    const c = client();
    const onVerified = vi.fn();
    render(<ContactVerifier type="email" client={c} onVerified={onVerified} />);
    await userEvent.type(screen.getByLabelText("Email address"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(c.addContact).toHaveBeenCalledWith({ type: "email", value: "a@b.co" });
    expect(await screen.findByRole("button", { name: /resend in/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(c.verifyContact).toHaveBeenCalledWith(contact.id, { code: "123456" }));
    expect(onVerified).toHaveBeenCalled();
    expect(await screen.findByText("Verified")).toBeInTheDocument();
  });

  it("sends the contact once when the button is clicked twice", async () => {
    const c = client();
    render(<ContactVerifier type="email" client={c} />);
    await userEvent.type(screen.getByLabelText("Email address"), "a@b.co");
    const send = screen.getByRole("button", { name: "Send code" });
    await userEvent.dblClick(send);
    await screen.findByRole("button", { name: /resend in/i });
    expect(c.addContact).toHaveBeenCalledTimes(1);
  });

  it("keeps entered value and shows field error on validation failure", async () => {
    const c = client();
    c.addContact.mockRejectedValueOnce(new ApiError("VALIDATION_FAILED", 400, "Enter the phone number with its country code, e.g. +91 98765 43210"));
    render(<ContactVerifier type="phone" client={c} />);
    await userEvent.type(screen.getByLabelText("Phone number"), "98765");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/country code/)).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveValue("98765");
  });

  it("wrong code shows inline error and keeps the form", async () => {
    const c = client();
    c.verifyContact.mockRejectedValueOnce(new ApiError("OTP_INVALID", 400, "That code is incorrect"));
    render(<ContactVerifier type="email" client={c} />);
    await userEvent.type(screen.getByLabelText("Email address"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.type(await screen.findByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Incorrect code")).toBeInTheDocument();
  });
});

describe("ContactVerifier change and cooldown", () => {
  it("verified contact can be changed", async () => {
    const verified = { ...contact, status: "verified" as const, verifiedAt: new Date().toISOString() };
    render(<ContactVerifier type="email" existing={verified} client={client()} />);
    expect(screen.queryByRole("button", { name: "Send code" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Email address")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Email address"), "new@b.co");
    expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("Change while awaiting a code drops the contact but keeps the typed value", async () => {
    const verified = { ...contact, status: "verified" as const, verifiedAt: new Date().toISOString() };
    const onChanged = vi.fn();
    render(<ContactVerifier type="email" existing={verified} client={client()} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await userEvent.type(screen.getByLabelText("Email address"), "new@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("button", { name: "Change email" })).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.getByLabelText("Email address")).toHaveValue("new@b.co");
    expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("OTP_COOLDOWN shows title and message and reuses the countdown", async () => {
    const c = client();
    const past = new Date(Date.now() - 1_000).toISOString();
    c.addContact.mockResolvedValueOnce({ contact, verification: { expiresAt: later, resendAvailableAt: past } });
    c.resendContact.mockRejectedValueOnce(new ApiError("OTP_COOLDOWN", 429, "wait", 45));
    render(<ContactVerifier type="email" client={c} />);
    await userEvent.type(screen.getByLabelText("Email address"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.click(await screen.findByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("Please wait")).toBeInTheDocument();
    expect(screen.getByText("You can request another code shortly.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend in (4[0-5]) s/i })).toBeDisabled();
  });

  it("resend counts down, is disabled, then enables", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const c = client();
      const soon = new Date(Date.now() + 3_000).toISOString();
      c.addContact.mockResolvedValueOnce({ contact, verification: { expiresAt: soon, resendAvailableAt: soon } });
      render(<ContactVerifier type="email" client={c} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(screen.getByLabelText("Email address"), "a@b.co");
      await user.click(screen.getByRole("button", { name: "Send code" }));
      const btn = await screen.findByRole("button", { name: /resend in \d+ s/i });
      expect(btn).toBeDisabled();
      await act(async () => { vi.advanceTimersByTime(4_000); });
      expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
