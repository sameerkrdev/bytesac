import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, waitlistSignups } from "@repo/db";
import { eq } from "drizzle-orm";
import { joinWaitlist } from "@/modules/waitlist/waitlist.service";
import { resetDb } from "../../helpers/db";

const sendWaitlistWelcomeEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/providers/resend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/providers/resend")>();
  return { ...mod, sendWaitlistWelcomeEmail };
});

describe("joinWaitlist", () => {
  beforeEach(() => resetDb());
  afterEach(() => vi.restoreAllMocks());

  it("inserts, sends welcome email once, and marks welcomeEmailSentAt", async () => {
    sendWaitlistWelcomeEmail.mockClear();
    const r = await joinWaitlist({ name: "Ada Lovelace", email: "ada@example.com", country: "GB" });
    expect(r).toEqual({ ok: true, joined: true });
    expect(sendWaitlistWelcomeEmail).toHaveBeenCalledOnce();
    const [row] = await db.select().from(waitlistSignups).where(eq(waitlistSignups.email, "ada@example.com"));
    expect(row?.welcomeEmailSentAt).toBeTruthy();
  });

  it("upserts by email without resending welcome mail", async () => {
    sendWaitlistWelcomeEmail.mockClear();
    await joinWaitlist({ name: "Ada", email: "ada@example.com" });
    sendWaitlistWelcomeEmail.mockClear();
    const r = await joinWaitlist({ name: "Ada Updated", email: "Ada@Example.com", phone: "+1" });
    expect(r).toEqual({ ok: true, joined: false });
    expect(sendWaitlistWelcomeEmail).not.toHaveBeenCalled();
    const [row] = await db.select().from(waitlistSignups).where(eq(waitlistSignups.email, "ada@example.com"));
    expect(row?.fullName).toBe("Ada Updated");
    expect(row?.phone).toBe("+1");
  });
});
