import { eq, sql } from "drizzle-orm";
import { logger } from "@repo/logger";
import { db, waitlistSignups } from "@repo/db";
import type { WaitlistEmailJoinRequest, WaitlistJoinRequest, WaitlistJoinResponse } from "@repo/validator";
import { waitlistWelcomeEmail } from "@/providers/waitlist-email";
import { sendWaitlistWelcomeEmail } from "@/providers/resend";

type SignupDetails = { fullName: string; phone: string | null; country: string | null };

/** Upsert by email. The welcome email goes out once: on the first join, or on a later join if it never went out. A send failure never fails the join. */
export async function joinWaitlist(input: WaitlistJoinRequest): Promise<WaitlistJoinResponse> {
  return join(input.email, { fullName: input.name.trim(), phone: input.phone?.trim() || null, country: input.country ?? null });
}

/** Email-only join. An existing signup keeps the name, phone and country it already has. */
export async function joinWaitlistByEmail(input: WaitlistEmailJoinRequest): Promise<WaitlistJoinResponse> {
  return join(input.email, null);
}

async function join(rawEmail: string, details: SignupDetails | null): Promise<WaitlistJoinResponse> {
  const email = rawEmail.trim().toLowerCase();
  const [existing] = await db.select({ id: waitlistSignups.id, fullName: waitlistSignups.fullName, welcomeEmailSentAt: waitlistSignups.welcomeEmailSentAt })
    .from(waitlistSignups)
    .where(sql`lower(trim(${waitlistSignups.email})) = ${email}`)
    .limit(1);

  let id: string;
  if (existing) {
    if (details) await db.update(waitlistSignups).set({ ...details, updatedAt: sql`now()` }).where(eq(waitlistSignups.id, existing.id));
    if (existing.welcomeEmailSentAt) return { ok: true, joined: false, emailSent: true };
    id = existing.id;
  } else {
    const [row] = await db.insert(waitlistSignups).values({ email, ...details }).returning({ id: waitlistSignups.id });
    id = row!.id;
  }

  try {
    const name = details?.fullName ?? existing?.fullName ?? null;
    await sendWaitlistWelcomeEmail(email, waitlistWelcomeEmail(name), `waitlist-welcome/${id}`);
    await db.update(waitlistSignups).set({ welcomeEmailSentAt: sql`now()` }).where(eq(waitlistSignups.id, id));
    return { ok: true, joined: !existing, emailSent: true };
  } catch (err) {
    logger.warn("waitlist welcome email failed", { signupId: id, error: err instanceof Error ? err.message : String(err) });
    return { ok: true, joined: !existing, emailSent: false };
  }
}
