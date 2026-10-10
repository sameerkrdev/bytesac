import { themes } from "@repo/design-tokens";
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

  it("uses the theme tokens for both colour schemes", () => {
    const { html } = waitlistWelcomeEmail("Ada");
    expect(html).toContain(themes.light.canvas);
    expect(html).toContain(themes.light.accent);
    expect(html).toContain(`prefers-color-scheme: dark`);
    expect(html).toContain(themes.dark.surface);
  });

  it("escapes the name", () => {
    const { html } = waitlistWelcomeEmail("<script>x</script> Doe");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
