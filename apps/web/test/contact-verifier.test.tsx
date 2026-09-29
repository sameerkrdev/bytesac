import { ApiError } from "@repo/api-client";
import { render, screen, waitFor } from "@testing-library/react";
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
