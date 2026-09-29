import createHttpError from "http-errors";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import { z, type ContactType } from "@repo/validator";

const invalid = (message: string) => createHttpError(message, { code: "VALIDATION_FAILED" });

export function normalizeContact(type: ContactType, raw: string, allowedCountries: string[]): string {
  const value = raw.trim();
  if (type === "email") {
    const email = value.toLowerCase();
    if (!z.email().safeParse(email).success) throw invalid("Enter a valid email address");
    return email;
  }
  if (!value.startsWith("+")) throw invalid("Enter the phone number with its country code, e.g. +91 98765 43210");
  let parsed;
  try { parsed = parsePhoneNumberWithError(value); } catch { throw invalid("Enter a valid phone number"); }
  if (!parsed.isValid()) throw invalid("Enter a valid phone number");
  if (!parsed.country || !allowedCountries.includes(parsed.country)) throw invalid("SMS verification is not supported for this country yet");
  return parsed.number;
}

export function maskContact(type: ContactType, value: string): string {
  if (type === "email") {
    const [local, domain] = value.split("@");
    return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
  }
  return `+${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}
