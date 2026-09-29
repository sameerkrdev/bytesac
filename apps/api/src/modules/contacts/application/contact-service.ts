import { createHash, randomUUID } from "node:crypto";
import type { AddContactResponse, ContactType, ContactView } from "@repo/contracts";
import { DeliveryError } from "../../../adapters/email-sender.js";
import { enforceRateLimit, type RateLimitResult } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { toIso, toIsoOrNull } from "../../../shared/time.js";
import { maskContact, normalizeContact } from "../domain/contact-value.js";
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SEC, generateOtp, hashOtp, otpMatches } from "../domain/otp.js";
import { contactRepo, type ContactRow, type VerificationRow } from "../infra/contact-repository.js";

interface Ctx { userId: string; sessionId: string; meta: RequestMeta }

const GLOBAL_PER_MIN: Record<"email" | "sms", number> = { email: 1000, sms: 200 };

function view(c: ContactRow): ContactView {
  return { id: c.id, type: c.type, value: c.value, status: c.status === "verified" ? "verified" : "unverified", verifiedAt: toIsoOrNull(c.verifiedAt) };
}

function channelOf(type: ContactType): "email" | "sms" {
  return type === "email" ? "email" : "sms";
}

async function consumeSendLimits(deps: AppDeps, userId: string, destination: string, channel: "email" | "sms", ip: string): Promise<RateLimitResult[]> {
  const dest = createHash("sha256").update(destination).digest("hex").slice(0, 32);
  const taken: RateLimitResult[] = [];
  try {
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:user:${userId}`, 5, 3600));
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:dest:${dest}:h`, 3, 3600));
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:dest:${dest}:d`, 10, 86_400));
    taken.push(await enforceRateLimit(deps.rateLimiter, `otp:ip:${ip}`, 10, 3600));
    const g = await deps.rateLimiter.consume(`otp:global:${channel}`, GLOBAL_PER_MIN[channel], 60);
    taken.push(g);
    if (!g.allowed) {
      deps.logger.error({ channel }, "OTP global circuit breaker tripped");
      throw new DomainError("OTP_DELIVERY_FAILED", "Verification codes are temporarily unavailable. Try again later.");
    }
    return taken;
  } catch (err) {
    await Promise.all(taken.filter((t) => t.allowed).map((t) => deps.rateLimiter.refund(t.bucketKey)));
    throw err;
  }
}

async function send(deps: AppDeps, contact: ContactRow, ctx: Ctx): Promise<VerificationRow> {
  const channel = channelOf(contact.type);
  const limits = await consumeSendLimits(deps, ctx.userId, contact.value, channel, ctx.meta.ip);
  const id = randomUUID();
  const code = channel === "email" ? generateOtp() : null;
  const verification = await deps.db.transaction(async (tx) => {
    await contactRepo.supersedePending(tx, contact.id);
    return contactRepo.createVerification(tx, { id, contactId: contact.id, destination: contact.value, channel, codeHash: code ? hashOtp(deps.env.OTP_HMAC_SECRET, id, code) : null });
  });
  try {
    if (channel === "email") {
      await deps.emailSender.sendOtp({ to: contact.value, code: code! });
    } else {
      const { providerRef } = await deps.smsOtp.start({ to: contact.value });
      await contactRepo.setProviderRef(deps.db, verification.id, providerRef);
    }
  } catch (err) {
    await contactRepo.markFailed(deps.db, verification.id);
    await Promise.all(limits.map((l) => deps.rateLimiter.refund(l.bucketKey)));
    if (err instanceof DeliveryError) throw new DomainError("OTP_DELIVERY_FAILED", "We couldn't send the code. Try again shortly.");
    throw err;
  }
  return verification;
}

function response(contact: ContactRow, v: VerificationRow): AddContactResponse {
  return {
    contact: view(contact),
    verification: { expiresAt: toIso(v.expiresAt), resendAvailableAt: toIso(new Date(v.createdAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000)) },
  };
}

export const contactService = {
  async add(deps: AppDeps, i: Ctx & { type: ContactType; rawValue: string }): Promise<AddContactResponse> {
    const value = normalizeContact(i.type, i.rawValue, deps.env.SMS_ALLOWED_COUNTRIES);
    const { contact } = await deps.db.transaction(async (tx) => {
      const out = await contactRepo.replace(tx, i.userId, i.type, value);
      const base = { actorType: "user" as const, actorUserId: i.userId, requestId: i.meta.requestId, sessionId: i.sessionId, entityType: "contact" };
      if (out.replaced) await writeAudit(tx, { ...base, action: "contact.replaced", entityId: out.replaced.id, metadata: { type: i.type, value: maskContact(i.type, out.replaced.value) } });
      await writeAudit(tx, { ...base, action: "contact.added", entityId: out.contact.id, metadata: { type: i.type, value: maskContact(i.type, value) } });
      return out;
    });
    const v = await send(deps, contact, i);
    return response(contact, v);
  },

  async resend(deps: AppDeps, i: Ctx & { contactId: string }): Promise<AddContactResponse> {
    const contact = await contactRepo.ownedCurrent(deps.db, i.userId, i.contactId);
    if (!contact || contact.status !== "unverified") throw new DomainError("NOT_FOUND", "Contact not found");
    const last = await contactRepo.latestPending(deps.db, contact.id);
    if (last) {
      const since = await contactRepo.secondsSinceCreated(deps.db, last.id);
      if (since < OTP_RESEND_COOLDOWN_SEC) {
        throw new DomainError("OTP_COOLDOWN", "Please wait before requesting another code", { retryAfterSec: OTP_RESEND_COOLDOWN_SEC - since });
      }
    }
    const v = await send(deps, contact, i);
    return response(contact, v);
  },

  async verify(deps: AppDeps, i: Ctx & { contactId: string; code: string }): Promise<ContactView> {
    const contact = await contactRepo.ownedCurrent(deps.db, i.userId, i.contactId);
    if (!contact) throw new DomainError("NOT_FOUND", "Contact not found");
    if (contact.status === "verified") return view(contact);
    const pending = await contactRepo.latestPending(deps.db, contact.id);
    if (!pending) {
      const latest = await contactRepo.latest(deps.db, contact.id);
      if (latest?.status === "failed" && latest.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError("OTP_ATTEMPTS_EXCEEDED", "Too many attempts. Request a new code.");
      throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
    }
    if (pending.destination !== contact.value) throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
    const attempt = await contactRepo.registerAttempt(deps.db, pending.id);
    if (!attempt) {
      if (await contactRepo.isExpired(deps.db, pending.id)) throw new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
      await contactRepo.markFailed(deps.db, pending.id);
      throw new DomainError("OTP_ATTEMPTS_EXCEEDED", "Too many attempts. Request a new code.");
    }
    let ok: boolean;
    try {
      ok = attempt.channel === "email"
        ? otpMatches(deps.env.OTP_HMAC_SECRET, attempt.id, i.code, attempt.codeHash ?? "")
        : (await deps.smsOtp.check({ to: attempt.destination, code: i.code })) === "approved";
    } catch (err) {
      if (err instanceof DeliveryError) throw new DomainError("OTP_DELIVERY_FAILED", "We couldn't check the code. Try again shortly.");
      throw err;
    }
    if (!ok) {
      if (attempt.attempts >= OTP_MAX_ATTEMPTS) await contactRepo.markFailed(deps.db, attempt.id);
      throw new DomainError("OTP_INVALID", "That code is incorrect");
    }
    const verified = await deps.db.transaction(async (tx) => {
      const row = await contactRepo.markVerified(tx, attempt.id, contact.id);
      await writeAudit(tx, { actorType: "user", actorUserId: i.userId, action: "contact.verified", entityType: "contact", entityId: contact.id, requestId: i.meta.requestId, sessionId: i.sessionId, metadata: { type: contact.type, value: maskContact(contact.type, contact.value) } });
      return row;
    });
    return view(verified);
  },
};
