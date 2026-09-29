import type { ContactType } from "@repo/contracts";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import { z } from "zod";
import { DomainError } from "../../../shared/errors.js";

export function normalizeContact(type: ContactType, raw: string, allowedCountries: string[]): string {
  const value = raw.trim();
  if (type === "email") {
    const email = value.toLowerCase();
    if (!z.email().safeParse(email).success) throw new DomainError("VALIDATION_FAILED", "Enter a valid email address");
    return email;
  }
  if (!value.startsWith("+")) throw new DomainError("VALIDATION_FAILED", "Enter the phone number with its country code, e.g. +91 98765 43210");
  let parsed;
  try { parsed = parsePhoneNumberWithError(value); } catch { throw new DomainError("VALIDATION_FAILED", "Enter a valid phone number"); }
  if (!parsed.isValid()) throw new DomainError("VALIDATION_FAILED", "Enter a valid phone number");
  if (!parsed.country || !allowedCountries.includes(parsed.country)) {
    throw new DomainError("VALIDATION_FAILED", "SMS verification is not supported for this country yet");
  }
  return parsed.number;
}

export function maskContact(type: ContactType, value: string): string {
  if (type === "email") {
    const [local, domain] = value.split("@");
    return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
  }
  return `+${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}
