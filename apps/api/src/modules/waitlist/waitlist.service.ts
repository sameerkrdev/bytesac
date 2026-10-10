import { eq, sql } from "drizzle-orm";
import createHttpError from "http-errors";
import { db, waitlistSignups } from "@repo/db";
import type { WaitlistJoinRequest, WaitlistJoinResponse } from "@repo/validator";
import { waitlistWelcomeEmail } from "@/providers/waitlist-email";
import { sendWaitlistWelcomeEmail } from "@/providers/resend";

export async function joinWaitlist(input: WaitlistJoinRequest): Promise<WaitlistJoinResponse> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: waitlistSignups.id, welcomeEmailSentAt: waitlistSignups.welcomeEmailSentAt })
    .from(waitlistSignups)
    .where(sql`lower(trim(${waitlistSignups.email})) = ${email}`)
    .limit(1);

  if (existing[0]) {
    await db.update(waitlistSignups)
      .set({
        fullName: input.name.trim(),
        phone: input.phone?.trim() || null,
        country: input.country ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(waitlistSignups.id, existing[0].id));
    return { ok: true, joined: false };
  }

  const [row] = await db.insert(waitlistSignups).values({
    email,
    fullName: input.name.trim(),
    phone: input.phone?.trim() || null,
    country: input.country ?? null,
  }).returning({ id: waitlistSignups.id });

  const mail = waitlistWelcomeEmail(input.name);
  try {
    await sendWaitlistWelcomeEmail(email, mail, `waitlist-welcome/${row!.id}`);
    await db.update(waitlistSignups).set({ welcomeEmailSentAt: sql`now()` }).where(eq(waitlistSignups.id, row!.id));
  } catch (err) {
    throw createHttpError("We couldn't send your confirmation email. Try again shortly.", { code: "WAITLIST_EMAIL_FAILED", cause: err });
  }

  return { ok: true, joined: true };
}
