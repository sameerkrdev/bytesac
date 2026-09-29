import { z } from "zod";

export const contactTypeSchema = z.enum(["email", "phone"]);
export type ContactType = z.infer<typeof contactTypeSchema>;
export const contactStatusSchema = z.enum(["unverified", "verified"]);

export const contactViewSchema = z.object({
  id: z.uuid(),
  type: contactTypeSchema,
  value: z.string(),
  status: contactStatusSchema,
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ContactView = z.infer<typeof contactViewSchema>;

export const addContactRequestSchema = z.strictObject({
  type: contactTypeSchema,
  /** Email address, or phone in international format starting with "+". */
  value: z.string().trim().min(3).max(254),
});
export type AddContactRequest = z.infer<typeof addContactRequestSchema>;

export const addContactResponseSchema = z.object({
  contact: contactViewSchema,
  verification: z.object({
    expiresAt: z.iso.datetime({ offset: true }),
    resendAvailableAt: z.iso.datetime({ offset: true }),
  }),
});
export type AddContactResponse = z.infer<typeof addContactResponseSchema>;

export const verifyContactRequestSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export type VerifyContactRequest = z.infer<typeof verifyContactRequestSchema>;
