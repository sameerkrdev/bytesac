import { createHash, randomBytes, randomUUID } from "node:crypto";
import createHttpError, { isHttpError } from "http-errors";
import { and, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { applicationEmailCodes, applicationEvents, db, isUniqueViolation, managerApplications, type DbOrTx } from "@repo/db";
import {
  familyOf, type ApplicationStatusResponse, type ConfirmApplicationEmailResponse, type CreateApplicationRequest, type CreateApplicationResponse,
} from "@repo/validator";
import { env } from "../env";
import { consume, limits } from "../middleware/rate-limit";
import type { RequestMeta } from "../middleware/request-context";
import { sendApplicationEmail } from "../providers/resend";
import { writeAudit } from "./audit";
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SEC, OTP_TTL, generateOtp, hashOtp, otpMatches } from "./otp";
import { hashToken } from "./sessions";
import { canonicalizeAddress } from "./wallets";

const otpExpired = () => createHttpError("This code has expired. Request a new one.", { code: "OTP_EXPIRED" });
const attemptsExceeded = () => createHttpError("Too many attempts. Request a new code.", { code: "OTP_ATTEMPTS_EXCEEDED" });
const notFound = () => createHttpError("Application not found", { code: "NOT_FOUND" });
const tokenInvalid = () => createHttpError("This status link is invalid or has expired.", { code: "APPLICATION_TOKEN_INVALID" });
const cooldownError = (sec: number) => createHttpError("Please wait before requesting another code", { code: "OTP_COOLDOWN", headers: { "retry-after": String(sec) } });
const emailKey = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 32);

/** Supersedes any pending code and inserts a fresh one; the caller emails it after commit. */
async function newCode(tx: DbOrTx, applicationId: string): Promise<{ codeId: string; code: string }> {
  await tx.update(applicationEmailCodes).set({ status: "superseded", resolvedAt: sql`now()` })
    .where(and(eq(applicationEmailCodes.applicationId, applicationId), eq(applicationEmailCodes.status, "pending")));
  const codeId = randomUUID();
  const code = generateOtp();
  await tx.insert(applicationEmailCodes).values({
    id: codeId, applicationId, codeHash: hashOtp(env.OTP_HMAC_SECRET, codeId, code), expiresAt: sql`now() + ${OTP_TTL}::interval`,
  });
  return { codeId, code };
}

async function markFailed(id: string): Promise<void> {
  await db.update(applicationEmailCodes).set({ status: "failed", resolvedAt: sql`now()` })
    .where(and(eq(applicationEmailCodes.id, id), eq(applicationEmailCodes.status, "pending")));
}

async function emailCode(email: string, c: { codeId: string; code: string }, applicationId: string): Promise<void> {
  try {
    await sendApplicationEmail("code", email, { code: c.code }, `application-code/${c.codeId}`);
  } catch (err) {
    await markFailed(c.codeId);
    // The application exists; hand the client its id so it can offer "resend code".
    if (isHttpError(err)) err.details = { applicationId };
    throw err;
  }
}

export async function createApplication(meta: RequestMeta, body: CreateApplicationRequest): Promise<CreateApplicationResponse> {
  const { walletChain, walletAddress: typedAddress, ...fields } = body;
  const walletAddress = canonicalizeAddress(walletChain, typedAddress);
  await consume(limits.appCreateIp, meta.ip);
  await consume(limits.appCreateEmail, emailKey(body.email));
  const created = await db.transaction(async (tx) => {
    const [app] = await tx.insert(managerApplications).values({ ...fields, walletChain, walletAddress, walletFamily: familyOf(walletChain) }).returning({ id: managerApplications.id });
    await tx.insert(applicationEvents).values({ applicationId: app!.id, actorType: "applicant", kind: "status_changed", fromStatus: null, toStatus: "EMAIL_PENDING", requestId: meta.requestId });
    return { applicationId: app!.id, ...(await newCode(tx, app!.id)) };
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, "manager_applications_open_email") || isUniqueViolation(err, "manager_applications_open_wallet")) {
      throw createHttpError("An application for this email or wallet is already in progress. Check your email.", { code: "APPLICATION_EXISTS" });
    }
    throw err;
  });
  await emailCode(body.email, created, created.applicationId);
  return { applicationId: created.applicationId };
}

export async function resendApplicationCode(_meta: RequestMeta, applicationId: string): Promise<void> {
  const [app] = await db.select().from(managerApplications).where(eq(managerApplications.id, applicationId));
  if (!app || app.status !== "EMAIL_PENDING") throw notFound();
  await consume(limits.appResendEmail, emailKey(app.email));
  const created = await db.transaction(async (tx) => {
    await tx.select({ id: managerApplications.id }).from(managerApplications).where(eq(managerApplications.id, applicationId)).for("update");
    // Cooldown against DB time, re-checked under the row lock so concurrent resends cannot both pass.
    const [last] = await tx.select({ since: sql<number>`extract(epoch from now() - ${applicationEmailCodes.createdAt})::int` }).from(applicationEmailCodes)
      .where(eq(applicationEmailCodes.applicationId, applicationId)).orderBy(desc(applicationEmailCodes.createdAt)).limit(1);
    if (last && last.since < OTP_RESEND_COOLDOWN_SEC) throw cooldownError(OTP_RESEND_COOLDOWN_SEC - last.since);
    return newCode(tx, applicationId);
  });
  await emailCode(app.email, created, applicationId);
}

export async function confirmApplicationEmail(meta: RequestMeta, applicationId: string, code: string): Promise<ConfirmApplicationEmailResponse> {
  const [app] = await db.select().from(managerApplications).where(eq(managerApplications.id, applicationId));
  if (!app) throw notFound();
  if (app.status !== "EMAIL_PENDING") throw otpExpired();
  const [pending] = await db.select().from(applicationEmailCodes)
    .where(and(eq(applicationEmailCodes.applicationId, applicationId), eq(applicationEmailCodes.status, "pending"))).limit(1);
  if (!pending) {
    const [latest] = await db.select().from(applicationEmailCodes).where(eq(applicationEmailCodes.applicationId, applicationId)).orderBy(desc(applicationEmailCodes.createdAt)).limit(1);
    if (latest?.status === "failed" && latest.attempts >= OTP_MAX_ATTEMPTS) throw attemptsExceeded();
    throw otpExpired();
  }
  // Atomically count an attempt; nothing comes back when the code is expired, exhausted or no longer pending.
  const [attempt] = await db.update(applicationEmailCodes).set({ attempts: sql`${applicationEmailCodes.attempts} + 1` })
    .where(and(eq(applicationEmailCodes.id, pending.id), eq(applicationEmailCodes.status, "pending"), lt(applicationEmailCodes.attempts, OTP_MAX_ATTEMPTS), gt(applicationEmailCodes.expiresAt, sql`now()`)))
    .returning();
  if (!attempt) {
    const [row] = await db.select({ expired: sql<boolean>`${applicationEmailCodes.expiresAt} <= now()` }).from(applicationEmailCodes).where(eq(applicationEmailCodes.id, pending.id));
    if (row?.expired ?? true) throw otpExpired();
    await markFailed(pending.id);
    throw attemptsExceeded();
  }
  if (!otpMatches(env.OTP_HMAC_SECRET, attempt.id, code, attempt.codeHash)) {
    if (attempt.attempts >= OTP_MAX_ATTEMPTS) await markFailed(attempt.id);
    throw createHttpError("That code is incorrect", { code: "OTP_INVALID" });
  }
  const statusToken = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    const resolved = await tx.update(applicationEmailCodes).set({ status: "verified", resolvedAt: sql`now()` })
      .where(and(eq(applicationEmailCodes.id, attempt.id), eq(applicationEmailCodes.status, "pending"))).returning({ id: applicationEmailCodes.id });
    if (resolved.length === 0) throw otpExpired();
    const submitted = await tx.update(managerApplications).set({
      status: "SUBMITTED", emailConfirmedAt: sql`now()`, submittedAt: sql`now()`, updatedAt: sql`now()`, statusTokenHash: hashToken(statusToken, env.SESSION_TOKEN_PEPPER),
    }).where(and(eq(managerApplications.id, applicationId), eq(managerApplications.status, "EMAIL_PENDING"))).returning({ id: managerApplications.id });
    if (submitted.length === 0) throw otpExpired();
    await tx.insert(applicationEvents).values({ applicationId, actorType: "applicant", kind: "status_changed", fromStatus: "EMAIL_PENDING", toStatus: "SUBMITTED", requestId: meta.requestId });
    await writeAudit(tx, { actorType: "system", action: "application.submitted", entityType: "manager_application", entityId: applicationId, requestId: meta.requestId });
  });
  await sendApplicationEmail("status_link", app.email, { link: `${env.AUTH_URI}/managers/status#${statusToken}` }, `application-status-link/${applicationId}`);
  return { statusToken };
}

async function applicationByToken(conn: DbOrTx, token: string) {
  const [app] = await conn.select().from(managerApplications)
    .where(and(isNotNull(managerApplications.statusTokenHash), eq(managerApplications.statusTokenHash, hashToken(token, env.SESSION_TOKEN_PEPPER))));
  if (!app) throw tokenInvalid();
  return app;
}

export async function getApplicationStatus(token: string): Promise<ApplicationStatusResponse> {
  const app = await applicationByToken(db, token);
  const [latest] = await db.select({ message: applicationEvents.messageToApplicant }).from(applicationEvents)
    .where(and(eq(applicationEvents.applicationId, app.id), isNotNull(applicationEvents.messageToApplicant)))
    .orderBy(desc(applicationEvents.createdAt), desc(applicationEvents.id)).limit(1);
  return {
    status: app.status, submittedAt: app.submittedAt?.toISOString() ?? null, applicantType: app.applicantType, fullName: app.fullName,
    latestMessage: latest?.message ?? null,
    // A reply moves the application out of ADDITIONAL_INFORMATION_REQUIRED, so one request allows exactly one reply.
    canReply: app.status === "ADDITIONAL_INFORMATION_REQUIRED",
  };
}

export async function replyToApplication(meta: RequestMeta, token: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await applicationByToken(tx, token);
    const [app] = await tx.select().from(managerApplications).where(eq(managerApplications.id, found.id)).for("update");
    if (app!.status !== "ADDITIONAL_INFORMATION_REQUIRED") throw createHttpError("This application is not waiting for a reply.", { code: "REPLY_NOT_ALLOWED" });
    await tx.update(managerApplications).set({ status: "SCREENING", updatedAt: sql`now()` }).where(eq(managerApplications.id, app!.id));
    await tx.insert(applicationEvents).values({
      applicationId: app!.id, actorType: "applicant", kind: "applicant_reply", fromStatus: "ADDITIONAL_INFORMATION_REQUIRED", toStatus: "SCREENING",
      applicantMessage: message, requestId: meta.requestId,
    });
    await writeAudit(tx, { actorType: "system", action: "application.replied", entityType: "manager_application", entityId: app!.id, requestId: meta.requestId });
  });
}
