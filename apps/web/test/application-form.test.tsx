import { ApiError } from "@repo/api-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApplicationForm } from "@/components/managers/application-form";

const APP_ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
const long = "This is a sufficiently long answer.";

function client() {
  return {
    createApplication: vi.fn(async () => ({ applicationId: APP_ID })),
    confirmApplicationEmail: vi.fn(async () => ({ statusToken: "tok123" })),
    resendApplicationCode: vi.fn(async () => undefined),
  };
}

async function put(el: HTMLElement, text: string) {
  await userEvent.click(el);
  await userEvent.paste(text);
}

async function fill(over: { website?: string } = {}) {
    await put(screen.getByLabelText("Full name"), "Ada Lovelace");
  await put(screen.getByLabelText("Email address"), "ada@example.com");
  await put(screen.getByLabelText("Country"), "gb");
  if (over.website) await put(screen.getByLabelText("Website (optional)"), over.website);
  for (const l of ["Professional background", "Investment experience", "Why do you want to manage baskets on Bytesac?", "What baskets do you plan to offer?"]) await put(screen.getByLabelText(l), long);
  await put(screen.getByLabelText("Wallet address"), "0x1234567890abcdef1234567890abcdef12345678");
}

describe("ApplicationForm", () => {
  it("firm without a firm name shows a field error and does not submit", async () => {
    const c = client();
    render(<ApplicationForm client={c} />);
    await userEvent.selectOptions(screen.getByLabelText("Applying as"), "firm");
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Submit application" }));
    expect(await screen.findByText("Firm name is required for firms")).toBeInTheDocument();
    expect(c.createApplication).not.toHaveBeenCalled();
  });

  it("rejects an http website", async () => {
    const c = client();
    render(<ApplicationForm client={c} />);
    await fill({ website: "http://example.com" });
    await userEvent.click(screen.getByRole("button", { name: "Submit application" }));
    await waitFor(() => expect(screen.getByLabelText("Website (optional)")).toHaveAttribute("aria-invalid", "true"));
    expect(c.createApplication).not.toHaveBeenCalled();
  });

  it("submits, shows the code step, then the one-time status link", async () => {
    const c = client();
    render(<ApplicationForm client={c} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Submit application" }));
    await userEvent.type(await screen.findByLabelText("6-digit code"), "123456");
    expect(c.createApplication).toHaveBeenCalledWith(expect.objectContaining({ applicantType: "individual", email: "ada@example.com", country: "GB", walletChain: "ethereum" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    expect(c.confirmApplicationEmail).toHaveBeenCalledWith(APP_ID, { code: "123456" });
    expect(await screen.findByText("Check your email for your private status link.")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringMatching(/\/managers\/status#tok123$/));
  });

  it("wrong code shows an inline error and keeps the code step", async () => {
    const c = client();
    c.confirmApplicationEmail.mockRejectedValueOnce(new ApiError("OTP_INVALID", 400, "bad"));
    render(<ApplicationForm client={c} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Submit application" }));
    await userEvent.type(await screen.findByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    expect(await screen.findByText("Incorrect code")).toBeInTheDocument();
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });

  it("code email failure on create continues at the code step with the resend cooldown running", async () => {
    const c = client();
    c.createApplication.mockRejectedValueOnce(new ApiError("OTP_DELIVERY_FAILED", 503, "x", undefined, { applicationId: APP_ID }));
    render(<ApplicationForm client={c} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Submit application" }));
    // The failed code row counts toward the server's 60 s cooldown, so Resend is not offered immediately.
    expect(await screen.findByRole("button", { name: /Resend in [0-9]+ s/ })).toBeDisabled();
    expect(c.resendApplicationCode).not.toHaveBeenCalled();
  });
});
