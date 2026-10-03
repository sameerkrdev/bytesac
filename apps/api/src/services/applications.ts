import { createHash, randomBytes, randomUUID } from "node:crypto";
import createHttpError, { isHttpError } from "http-errors";
import { and, desc, eq, gt, ilike, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { applicationEmailCodes, applicationEvents, db, isUniqueViolation, managerApplications, userPermissions, type DbOrTx, type Tx } from "@repo/db";
import {
  APPLICATION_TRANSITIONS, CHAINS, familyOf,
  type ApplicationDetail, type ApplicationStatus, type ApplicationStatusResponse, type Chain, type ConfirmApplicationEmailResponse,
  type CreateApplicationRequest, type CreateApplicationResponse, type ListApplicationsQuery, type ListApplicationsResponse,
  type TransitionApplicationRequest, type VerificationMethod, z,
} from "@repo/validator";
import { env } from "@/config/dotenv";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import type { RequestMeta } from "@/middlewares/request-context.middleware";
import { sendApplicationEmail, type ApplicationEmailKind } from "@/providers/resend";
import { writeAudit } from "./audit";
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SEC, OTP_TTL, generateOtp, hashOtp, otpMatches } from "./otp";
import { hashToken } from "./sessions";
import { canonicalizeAddress, findAddressOwner } from "./wallets";

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
    const [locked] = await tx.select({ status: managerApplications.status }).from(managerApplications).where(eq(managerApplications.id, applicationId)).for("update");
    if (locked?.status !== "EMAIL_PENDING") throw notFound();
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

// ---------------------------------------------------------------------------------------------------------------------
// Ops screening and wallet-proof permission grant
// ---------------------------------------------------------------------------------------------------------------------

export interface OpsCtx { userId: string; meta: RequestMeta }
type ApplicationRow = typeof managerApplications.$inferSelect;
type EventRow = typeof applicationEvents.$inferSelect;

const PAGE_SIZE = 25;
const STATUS_EMAILS: Partial<Record<ApplicationStatus, ApplicationEmailKind>> = {
  CONTACTED: "contacted", ADDITIONAL_INFORMATION_REQUIRED: "info_required", SCREENING_APPROVED: "approved", SCREENING_REJECTED: "rejected",
};

/**
 * Grants create_manager_organization when a proven user owns the submitted wallet of an approved application. Runs inside the caller's transaction.
 * The application row is locked by address without filtering on status: a concurrent approval then either commits first (this sees it)
 * or waits for this transaction (its owner lookup then sees the user), so one of the two always grants.
 */
export async function grantIfProven(tx: Tx, i: { userId: string; chain: Chain; address: string; method: VerificationMethod; requestId: string }): Promise<void> {
  const [app] = await tx.select().from(managerApplications).where(and(
    eq(managerApplications.walletFamily, familyOf(i.chain)),
    eq(managerApplications.walletAddress, i.address),
    ne(managerApplications.status, "SCREENING_REJECTED"),
  )).for("update");
  if (!app || app.status !== "SCREENING_APPROVED" || app.walletProvenAt) return;
  // Smart-contract wallets are proven per chain; an ECDSA/ed25519 key proves every chain of its family.
  if ((i.method === "erc1271" || i.method === "erc6492") && app.walletChain !== i.chain) return;
  if (app.decidedByUserId === i.userId) {
    // No self-approval: it stays unproven until another reviewer rejects it and the applicant re-applies.
    await tx.insert(applicationEvents).values({
      applicationId: app.id, actorType: "system", kind: "note", internalNote: "Permission not granted: the applicant approved their own application.", requestId: i.requestId,
    });
    await writeAudit(tx, {
      actorType: "system", action: "permission.grant_skipped_self_approval", entityType: "user", entityId: i.userId, requestId: i.requestId, metadata: { applicationId: app.id },
    });
    return;
  }
  await tx.insert(userPermissions).values({ userId: i.userId, permission: "create_manager_organization", sourceApplicationId: app.id }).onConflictDoNothing();
  await tx.update(managerApplications).set({ userId: i.userId, walletProvenAt: sql`now()`, updatedAt: sql`now()` }).where(eq(managerApplications.id, app.id));
  await tx.insert(applicationEvents).values({ applicationId: app.id, actorType: "system", kind: "permission_granted", requestId: i.requestId });
  await writeAudit(tx, {
    actorType: "system", action: "permission.granted", entityType: "user", entityId: i.userId, requestId: i.requestId,
    metadata: { permission: "create_manager_organization", applicationId: app.id },
  });
}

const eventView = (e: EventRow): ApplicationDetail["events"][number] => ({
  id: e.id, actorType: e.actorType, actorUserId: e.actorUserId, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus,
  internalNote: e.internalNote, messageToApplicant: e.messageToApplicant, applicantMessage: e.applicantMessage, createdAt: e.createdAt.toISOString(),
});

const summaryView = (a: ApplicationRow) => ({
  id: a.id, status: a.status, applicantType: a.applicantType, fullName: a.fullName, firmName: a.firmName, email: a.email, country: a.country,
  walletChain: a.walletChain, walletAddress: a.walletAddress, walletProvenAt: a.walletProvenAt?.toISOString() ?? null, submittedAt: a.submittedAt?.toISOString() ?? null,
});

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function getApplicationDetail(id: string): Promise<ApplicationDetail> {
  const [app] = await db.select().from(managerApplications).where(and(eq(managerApplications.id, id), ne(managerApplications.status, "EMAIL_PENDING")));
  if (!app) throw notFound();
  const events = await db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id)).orderBy(applicationEvents.createdAt, applicationEvents.id);
  return {
    ...summaryView(app), phone: app.phone, website: app.website, professionalBackground: app.professionalBackground, investmentExperience: app.investmentExperience,
    qualifications: app.qualifications, reason: app.reason, intendedBaskets: app.intendedBaskets, emailConfirmedAt: iso(app.emailConfirmedAt),
    decidedAt: iso(app.decidedAt), decidedByUserId: app.decidedByUserId, userId: app.userId, events: events.map(eventView),
  };
}

// The cursor carries the timestamp as Postgres text, so microsecond precision survives the round trip.
export const cursorSchema = z.tuple([z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:\d\d)?$/), z.uuid()]);

export async function listApplications(q: ListApplicationsQuery): Promise<ListApplicationsResponse> {
  const conditions = [ne(managerApplications.status, "EMAIL_PENDING")];
  if (q.status) conditions.push(eq(managerApplications.status, q.status));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(managerApplications.email, like), ilike(managerApplications.fullName, like), ilike(managerApplications.firmName, like))!);
  }
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${managerApplications.submittedAt}, ${managerApplications.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({ app: managerApplications, cursorTs: sql<string>`${managerApplications.submittedAt}::text` }).from(managerApplications)
    .where(and(...conditions)).orderBy(desc(managerApplications.submittedAt), desc(managerApplications.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => summaryView(r.app)),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.app.id}`).toString("base64url") : null,
  };
}

export async function transitionApplication(ctx: OpsCtx, id: string, i: TransitionApplicationRequest): Promise<ApplicationDetail> {
  const { app, eventId } = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(managerApplications).where(eq(managerApplications.id, id)).for("update");
    if (!locked) throw notFound();
    const owner = await findAddressOwner(tx, locked.walletChain, locked.walletAddress);
    if (owner?.userId === ctx.userId) throw createHttpError("You can't review your own application.", { code: "FORBIDDEN" });
    if (!APPLICATION_TRANSITIONS[locked.status].includes(i.to) || (locked.status === "SCREENING_APPROVED" && locked.walletProvenAt)) {
      throw createHttpError(`An application in ${locked.status} cannot move to ${i.to}.`, { code: "INVALID_TRANSITION" });
    }
    const decided = i.to === "SCREENING_APPROVED" || i.to === "SCREENING_REJECTED";
    await tx.update(managerApplications).set({
      status: i.to, updatedAt: sql`now()`, ...(decided ? { decidedAt: sql`now()`, decidedByUserId: ctx.userId } : {}),
    }).where(eq(managerApplications.id, id));
    const [event] = await tx.insert(applicationEvents).values({
      applicationId: id, actorType: "ops", actorUserId: ctx.userId, kind: "status_changed", fromStatus: locked.status, toStatus: i.to,
      internalNote: i.internalNote, messageToApplicant: i.messageToApplicant, requestId: ctx.meta.requestId,
    }).returning({ id: applicationEvents.id });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "application.status_changed", entityType: "manager_application", entityId: id,
      requestId: ctx.meta.requestId, metadata: { from: locked.status, to: i.to },
    });
    if (i.to === "SCREENING_APPROVED") {
      // The applicant may already own the wallet: grant now instead of waiting for their next sign-in.
      if (owner && owner.status === "active" && owner.userStatus === "active") {
        await grantIfProven(tx, { userId: owner.userId, chain: locked.walletChain, address: locked.walletAddress, method: owner.verificationMethod, requestId: ctx.meta.requestId });
      }
    }
    return { app: locked, eventId: event!.id };
  });
  const kind = STATUS_EMAILS[i.to];
  if (kind) {
    const short = `${app.walletAddress.slice(0, 6)}…${app.walletAddress.slice(-4)}`;
    await sendApplicationEmail(kind, app.email, { message: i.messageToApplicant, walletLabel: `${short} on ${CHAINS[app.walletChain].label}` }, `application-status/${eventId}`);
  }
  return getApplicationDetail(id);
}

export async function addApplicationNote(ctx: OpsCtx, id: string, note: string): Promise<ApplicationDetail> {
  await db.transaction(async (tx) => {
    const [app] = await tx.select({ id: managerApplications.id }).from(managerApplications).where(and(eq(managerApplications.id, id), ne(managerApplications.status, "EMAIL_PENDING")));
    if (!app) throw notFound();
    await tx.insert(applicationEvents).values({ applicationId: id, actorType: "ops", actorUserId: ctx.userId, kind: "note", internalNote: note, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "application.note_added", entityType: "manager_application", entityId: id, requestId: ctx.meta.requestId });
  });
  return getApplicationDetail(id);
}
