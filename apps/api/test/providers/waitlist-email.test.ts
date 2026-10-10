import { describe, expect, it } from "vitest";
import { waitlistWelcomeEmail } from "@/providers/waitlist-email";

describe("waitlistWelcomeEmail", () => {
  it("personalises the subject and includes html and text", () => {
    const mail = waitlistWelcomeEmail("Sameer Kumar");
    expect(mail.subject).toContain("Sameer");
    expect(mail.html).toContain("Sameer");
    expect(mail.text).toContain("self-custody");
    expect(mail.html).toContain("Cofounder");
  });
});
