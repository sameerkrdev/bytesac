import { createHash, randomUUID } from "node:crypto";
import createHttpError, { isHttpError } from "http-errors";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { contactVerifications, contacts, db, isUniqueViolation, type DbOrTx } from "@repo/db";
import { logger } from "@repo/logger";
import type { AddContactResponse, ContactType, ContactView } from "@repo/validator";
import { env } from "../env";
import { consume, limits } from "../middleware/rate-limit";
import type { RequestMeta } from "../middleware/request-context";
import { sendOtpEmail } from "../providers/resend";
import { checkSmsVerification, startSmsVerification } from "../providers/twilio";
import { writeAudit } from "./audit";
import { maskContact, normalizeContact } from "./contact-value";
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SEC, OTP_TTL, generateOtp, hashOtp, otpMatches } from "./otp";

type ContactRow = typeof contacts.$inferSelect;
type VerificationRow = typeof contactVerifications.$inferSelect;
interface Ctx { userId: string; sessionId: string; meta: RequestMeta }

export function contactView(c: ContactRow): ContactView {
  return { id: c.id, type: c.type, value: c.value, status: c.status === "verified" ? "verified" : "unverified", verifiedAt: c.verifiedAt?.toISOString() ?? null };
}

const cooldownError = (retryAfterSec: number) =>
  createHttpError("Please wait before requesting another code", { code: "OTP_COOLDOWN", headers: { "retry-after": String(retryAfterSec) } });
const contactNotFound = () => createHttpError("Contact not found", { code: "NOT_FOUND" });
const otpExpired = () => createHttpError("This code has expired. Request a new one.", { code: "OTP_EXPIRED" });
const attemptsExceeded = () => createHttpError("Too many attempts. Request a new code.", { code: "OTP_ATTEMPTS_EXCEEDED" });

/** Takes every send limit (per user, destination, IP and channel-wide); on any failure gives back the points already taken. */
async function takeSendLimits(userId: string, destination: string, channel: "email" | "sms", ip: string): Promise<Array<() => Promise<unknown>>> {
  const dest = createHash("sha256").update(destination).digest("hex").slice(0, 32);
  const refunds: Array<() => Promise<unknown>> = [];
  try {
    refunds.push(await consume(limits.otpUser, userId));
    refunds.push(await consume(limits.otpDestinationHour, dest));
    refunds.push(await consume(limits.otpDestinationDay, dest));
    refunds.push(await consume(limits.otpIp, ip));
    refunds.push(await consume(channel === "email" ? limits.otpGlobalEmail : limits.otpGlobalSms, channel).catch((err: unknown) => {
      if (!isHttpError(err) || err.code !== "RATE_LIMITED") throw err;
      logger.error("OTP global circuit breaker tripped", { channel });
      throw createHttpError("Verification codes are temporarily unavailable. Try again later.", { code: "OTP_DELIVERY_FAILED" });
    }));
    return refunds;
  } catch (err) {
    await Promise.all(refunds.map((refund) => refund()));
    throw err;
  }
}

function mapSendRace(err: unknown): unknown {
  if (isUniqueViolation(err, "contact_verifications_one_pending") || isUniqueViolation(err, "contacts_one_current_per_type")) {
    return cooldownError(OTP_RESEND_COOLDOWN_SEC);
  }
  return err;
}

async function supersedePending(tx: DbOrTx, contactId: string): Promise<void> {
  await tx.update(contactVerifications).set({ status: "superseded", resolvedAt: sql`now()` })
    .where(and(eq(contactVerifications.contactId, contactId), eq(contactVerifications.status, "pending")));
}

async function markFailed(id: string): Promise<void> {
  await db.update(contactVerifications).set({ status: "failed", resolvedAt: sql`now()` })
    .where(and(eq(contactVerifications.id, id), eq(contactVerifications.status, "pending")));
}

async function ownedContact(userId: string, contactId: string): Promise<ContactRow | undefined> {
  const [row] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.userId, userId), ne(contacts.status, "replaced")));
  return row;
}

async function send(contact: ContactRow, ctx: Ctx): Promise<VerificationRow> {
  const channel = contact.type === "email" ? "email" : "sms";
  const refunds = await takeSendLimits(ctx.userId, contact.value, channel, ctx.meta.ip);
  const id = randomUUID();
  const code = channel === "email" ? generateOtp() : null;
  let verification: VerificationRow | undefined;
  try {
    verification = await db.transaction(async (tx) => {
      // Serialise concurrent sends on the contact row and re-check the cooldown with DB time.
      await tx.execute(sql`SELECT id FROM app.contacts WHERE id = ${contact.id} FOR UPDATE`);
      const [locked] = await tx.select().from(contacts).where(and(eq(contacts.id, contact.id), ne(contacts.status, "replaced")));
      if (!locked || locked.status !== "unverified") throw contactNotFound();
      const [last] = await tx.select({ since: sql<number>`extract(epoch from now() - ${contactVerifications.createdAt})::int` }).from(contactVerifications)
        .where(and(eq(contactVerifications.contactId, contact.id), eq(contactVerifications.status, "pending")))
        .orderBy(desc(contactVerifications.createdAt)).limit(1);
      if (last && last.since < OTP_RESEND_COOLDOWN_SEC) throw cooldownError(OTP_RESEND_COOLDOWN_SEC - last.since);
      await supersedePending(tx, contact.id);
      const [row] = await tx.insert(contactVerifications).values({
        id, contactId: contact.id, destination: contact.value, channel,
        codeHash: code ? hashOtp(env.OTP_HMAC_SECRET, id, code) : null,
        expiresAt: sql`now() + ${OTP_TTL}::interval`,
      }).returning();
      return row!;
    });
    if (channel === "email") {
      await sendOtpEmail(contact.value, code!, id);
    } else {
      const providerRef = await startSmsVerification(contact.value);
      await db.update(contactVerifications).set({ providerRef }).where(eq(contactVerifications.id, id));
    }
  } catch (rawErr) {
    if (verification) await markFailed(verification.id);
    await Promise.all(refunds.map((refund) => refund()));
    throw mapSendRace(rawErr);
  }
  return verification;
}

function response(contact: ContactRow, v: VerificationRow): AddContactResponse {
  return {
    contact: contactView(contact),
    verification: { expiresAt: v.expiresAt.toISOString(), resendAvailableAt: new Date(v.createdAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000).toISOString() },
  };
}

export async function addContact(ctx: Ctx, i: { type: ContactType; rawValue: string }): Promise<AddContactResponse> {
  const value = normalizeContact(i.type, i.rawValue, env.SMS_ALLOWED_COUNTRIES);
  const contact = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM app.users WHERE id = ${ctx.userId} FOR UPDATE`);
    const [replaced] = await tx.select().from(contacts).where(and(eq(contacts.userId, ctx.userId), eq(contacts.type, i.type), ne(contacts.status, "replaced")));
    // The same value added again (a double click, a retry) is the contact already waiting for its code: not replaced, so the first request's send is not orphaned.
    if (replaced?.status === "unverified" && replaced.value === value) return replaced;
    if (replaced) {
      await tx.update(contacts).set({ status: "replaced" }).where(eq(contacts.id, replaced.id));
      await supersedePending(tx, replaced.id);
    }
    const [created] = await tx.insert(contacts).values({ userId: ctx.userId, type: i.type, value }).returning();
    const base = { actorType: "user" as const, actorUserId: ctx.userId, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, entityType: "contact" };
    if (replaced) await writeAudit(tx, { ...base, action: "contact.replaced", entityId: replaced.id, metadata: { type: i.type, value: maskContact(i.type, replaced.value) } });
    await writeAudit(tx, { ...base, action: "contact.added", entityId: created!.id, metadata: { type: i.type, value: maskContact(i.type, value) } });
    return created!;
  }).catch((err: unknown) => { throw mapSendRace(err); });
  // The pending verification of that contact (if it still has one) is the answer; otherwise a new code goes out.
  const [pending] = await db.select().from(contactVerifications).where(and(eq(contactVerifications.contactId, contact.id), eq(contactVerifications.status, "pending"), sql`${contactVerifications.expiresAt} > now()`))
    .orderBy(desc(contactVerifications.createdAt)).limit(1);
  return response(contact, pending ?? (await send(contact, ctx)));
}

export async function resendContact(ctx: Ctx, contactId: string): Promise<AddContactResponse> {
  const contact = await ownedContact(ctx.userId, contactId);
  if (!contact || contact.status !== "unverified") throw contactNotFound();
  // Check the cooldown before send() takes any rate-limit points, so an exhausted user resending early still sees OTP_COOLDOWN.
  const [last] = await db.select({ since: sql<number>`extract(epoch from now() - ${contactVerifications.createdAt})::int` }).from(contactVerifications)
    .where(and(eq(contactVerifications.contactId, contact.id), eq(contactVerifications.status, "pending")))
    .orderBy(desc(contactVerifications.createdAt)).limit(1);
  if (last && last.since < OTP_RESEND_COOLDOWN_SEC) throw cooldownError(OTP_RESEND_COOLDOWN_SEC - last.since);
  return response(contact, await send(contact, ctx));
}

export async function verifyContact(ctx: Ctx, i: { contactId: string; code: string }): Promise<ContactView> {
  const contact = await ownedContact(ctx.userId, i.contactId);
  if (!contact) throw contactNotFound();
  if (contact.status === "verified") return contactView(contact);
  const [pending] = await db.select().from(contactVerifications)
    .where(and(eq(contactVerifications.contactId, contact.id), eq(contactVerifications.status, "pending")))
    .orderBy(desc(contactVerifications.createdAt)).limit(1);
  if (!pending) {
    const [latest] = await db.select().from(contactVerifications).where(eq(contactVerifications.contactId, contact.id)).orderBy(desc(contactVerifications.createdAt)).limit(1);
    if (latest?.status === "failed" && latest.attempts >= OTP_MAX_ATTEMPTS) throw attemptsExceeded();
    throw otpExpired();
  }
  if (pending.destination !== contact.value) throw otpExpired();
  // Atomically count an attempt; nothing comes back when the code is expired, exhausted or no longer pending.
  const [attempt] = await db.update(contactVerifications).set({ attempts: sql`${contactVerifications.attempts} + 1` })
    .where(and(eq(contactVerifications.id, pending.id), eq(contactVerifications.status, "pending"), lt(contactVerifications.attempts, OTP_MAX_ATTEMPTS), gt(contactVerifications.expiresAt, sql`now()`)))
    .returning();
  if (!attempt) {
    const [row] = await db.select({ expired: sql<boolean>`${contactVerifications.expiresAt} <= now()` }).from(contactVerifications).where(eq(contactVerifications.id, pending.id));
    if (row?.expired ?? true) throw otpExpired();
    await markFailed(pending.id);
    throw attemptsExceeded();
  }
  let ok: boolean;
  try {
    ok = attempt.channel === "email"
      ? otpMatches(env.OTP_HMAC_SECRET, attempt.id, i.code, attempt.codeHash ?? "")
      : await checkSmsVerification(attempt.destination, i.code);
  } catch (err) {
    // A provider outage must not cost the user an attempt (never below zero).
    await db.update(contactVerifications).set({ attempts: sql`${contactVerifications.attempts} - 1` })
      .where(and(eq(contactVerifications.id, attempt.id), gt(contactVerifications.attempts, 0)));
    throw err;
  }
  if (!ok) {
    if (attempt.attempts >= OTP_MAX_ATTEMPTS) await markFailed(attempt.id);
    throw createHttpError("That code is incorrect", { code: "OTP_INVALID" });
  }
  const verified = await db.transaction(async (tx) => {
    const resolved = await tx.update(contactVerifications).set({ status: "verified", resolvedAt: sql`now()` })
      .where(and(eq(contactVerifications.id, attempt.id), eq(contactVerifications.status, "pending"))).returning({ id: contactVerifications.id });
    if (resolved.length === 0) throw otpExpired();
    const [row] = await tx.update(contacts).set({ status: "verified", verifiedAt: sql`now()` })
      .where(and(eq(contacts.id, contact.id), eq(contacts.status, "unverified"))).returning();
    if (!row) throw otpExpired();
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "contact.verified", entityType: "contact", entityId: contact.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { type: contact.type, value: maskContact(contact.type, contact.value) } });
    return row;
  });
  return contactView(verified);
}
