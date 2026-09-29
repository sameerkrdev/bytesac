import { ApiError } from "@repo/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ContactVerifier } from "@/components/contacts/contact-verifier";

const contact = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", type: "phone" as const, value: "+14155552671", status: "unverified" as const, verifiedAt: null };
const later = new Date(Date.now() + 60_000).toISOString();
const client = () => ({
  addContact: jest.fn(async () => ({ contact, verification: { expiresAt: later, resendAvailableAt: later } })),
  verifyContact: jest.fn(async () => ({ ...contact, status: "verified" as const, verifiedAt: new Date().toISOString() })),
  resendContact: jest.fn(async () => ({ contact, verification: { expiresAt: later, resendAvailableAt: later } })),
});

describe("ContactVerifier (mobile)", () => {
  it("phone: send → OTP with spaces → verified", async () => {
    const c = client();
    const onChanged = jest.fn();
    await render(<ContactVerifier type="phone" client={c} onChanged={onChanged} />);
    await fireEvent.changeText(screen.getByLabelText("Phone number"), "+1 415 555 2671");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(c.addContact).toHaveBeenCalledWith({ type: "phone", value: "+1 415 555 2671" }));
    await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123 456");
    await fireEvent.press(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(c.verifyContact).toHaveBeenCalledWith(contact.id, { code: "123456" }));
    expect(await screen.findByText("Verified")).toBeOnTheScreen();
    expect(onChanged).toHaveBeenCalled();
  });
  it("missing country code: server message inline, value kept", async () => {
    const c = client();
    c.addContact.mockRejectedValueOnce(new ApiError("VALIDATION_FAILED", 400, "Enter the phone number with its country code, e.g. +91 98765 43210"));
    await render(<ContactVerifier type="phone" client={c} />);
    await fireEvent.changeText(screen.getByLabelText("Phone number"), "98765");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/country code/)).toBeOnTheScreen();
    expect(screen.getByLabelText("Phone number").props.value).toBe("98765");
  });
  it("Change while awaiting a code keeps the typed value and clears code entry", async () => {
    const c = client();
    await render(<ContactVerifier type="phone" client={c} />);
    await fireEvent.changeText(screen.getByLabelText("Phone number"), "+14155552671");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("6-digit code");
    await fireEvent.press(screen.getByRole("button", { name: "Change phone" }));
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    expect(screen.getByLabelText("Phone number").props.value).toBe("+14155552671");
    expect(screen.getByRole("button", { name: "Send code" })).toBeOnTheScreen();
  });
  it("Change on a verified existing contact never restores it", async () => {
    await render(<ContactVerifier type="phone" client={client()} existing={{ ...contact, status: "verified", verifiedAt: "2026-09-29T00:00:00.000Z" }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.getByRole("button", { name: "Send code" })).toBeOnTheScreen();
  });
});
