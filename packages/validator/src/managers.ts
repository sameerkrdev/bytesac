import { z } from "zod";
import { chainSchema } from "./chains";

export const APPLICATION_STATUSES = ["EMAIL_PENDING", "SUBMITTED", "SCREENING", "CONTACTED", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** Transitions ops may perform. EMAIL_PENDING→SUBMITTED (confirm) and ADDITIONAL_INFORMATION_REQUIRED→SCREENING (applicant reply) are system/applicant-only. */
export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  EMAIL_PENDING: [],
  SUBMITTED: ["SCREENING", "SCREENING_REJECTED"],
  SCREENING: ["CONTACTED", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"],
  CONTACTED: ["SCREENING", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["SCREENING", "SCREENING_REJECTED"],
  SCREENING_APPROVED: [],
  SCREENING_REJECTED: [],
};

const freeText = z.string().trim().min(20).max(4000);

export const createApplicationRequestSchema = z.strictObject({
  applicantType: z.enum(["individual", "firm"]),
  fullName: z.string().trim().min(2).max(120),
  firmName: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  /** International format, starts with "+". */
  phone: z.string().trim().regex(/^\+/).max(32).optional(),
  country: z.string().regex(/^[A-Z]{2}$/),
  website: z.url({ protocol: /^https$/ }).optional(),
  professionalBackground: freeText,
  investmentExperience: freeText,
  reason: freeText,
  intendedBaskets: freeText,
  qualifications: z.string().trim().max(4000).optional(),
  walletChain: chainSchema,
  walletAddress: z.string().trim().min(1).max(128),
}).superRefine((v, ctx) => {
  if (v.applicantType === "firm" && !v.firmName) ctx.addIssue({ code: "custom", path: ["firmName"], message: "Firm name is required for firms" });
});
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>;

export const createApplicationResponseSchema = z.object({ applicationId: z.uuid() });
export type CreateApplicationResponse = z.infer<typeof createApplicationResponseSchema>;

export const confirmApplicationEmailSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export type ConfirmApplicationEmailRequest = z.infer<typeof confirmApplicationEmailSchema>;
export const confirmApplicationEmailResponseSchema = z.object({ statusToken: z.string() });
export type ConfirmApplicationEmailResponse = z.infer<typeof confirmApplicationEmailResponseSchema>;

export const applicationStatusResponseSchema = z.object({
  status: applicationStatusSchema,
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  applicantType: z.enum(["individual", "firm"]),
  fullName: z.string(),
  latestMessage: z.string().nullable(),
  canReply: z.boolean(),
});
export type ApplicationStatusResponse = z.infer<typeof applicationStatusResponseSchema>;

export const applicationReplySchema = z.strictObject({ message: z.string().trim().min(1).max(4000) });
export type ApplicationReplyRequest = z.infer<typeof applicationReplySchema>;
