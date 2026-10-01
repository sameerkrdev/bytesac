import { z } from "zod";
import { chainSchema, signInChainSchema } from "./chains";

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
  // An approval whose applicant never proved the wallet (including a self-approval) can still be rejected by another reviewer; the API refuses it once proven.
  SCREENING_APPROVED: ["SCREENING_REJECTED"],
  SCREENING_REJECTED: [],
};

const freeText = z.string().trim().min(20, "Please write at least 20 characters").max(4000, "Please keep this under 4000 characters");

export const createApplicationRequestSchema = z.strictObject({
  applicantType: z.enum(["individual", "firm"]),
  fullName: z.string().trim().min(2).max(120),
  firmName: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  /** International format, starts with "+". */
  phone: z.string().trim().regex(/^\+/).max(32).optional(),
  country: z.string().regex(/^[A-Z]{2}$/),
  website: z.url({ protocol: /^https$/ }).max(2048).optional(),
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

export const platformRoleSchema = z.enum(["ops_reviewer", "ops_admin"]);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

export const transitionApplicationRequestSchema = z.strictObject({
  to: applicationStatusSchema,
  internalNote: z.string().trim().min(1).max(4000).optional(),
  messageToApplicant: z.string().trim().min(1).max(4000).optional(),
}).refine((v) => v.to !== "ADDITIONAL_INFORMATION_REQUIRED" || v.messageToApplicant, { path: ["messageToApplicant"], message: "A message to the applicant is required" });
export type TransitionApplicationRequest = z.infer<typeof transitionApplicationRequestSchema>;

export const applicationNoteRequestSchema = z.strictObject({ internalNote: z.string().trim().min(1).max(4000) });
export type ApplicationNoteRequest = z.infer<typeof applicationNoteRequestSchema>;

export const listApplicationsQuerySchema = z.object({
  status: applicationStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

export const applicationSummarySchema = z.object({
  id: z.uuid(),
  status: applicationStatusSchema,
  applicantType: z.enum(["individual", "firm"]),
  fullName: z.string(),
  firmName: z.string().nullable(),
  email: z.string(),
  country: z.string(),
  walletChain: chainSchema,
  walletAddress: z.string(),
  walletProvenAt: z.iso.datetime({ offset: true }).nullable(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

export const listApplicationsResponseSchema = z.object({ items: z.array(applicationSummarySchema), nextCursor: z.string().nullable() });
export type ListApplicationsResponse = z.infer<typeof listApplicationsResponseSchema>;

export const applicationEventViewSchema = z.object({
  id: z.uuid(),
  actorType: z.enum(["applicant", "ops", "system"]),
  actorUserId: z.uuid().nullable(),
  kind: z.enum(["status_changed", "note", "applicant_reply", "permission_granted"]),
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema.nullable(),
  internalNote: z.string().nullable(),
  messageToApplicant: z.string().nullable(),
  applicantMessage: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ApplicationEventView = z.infer<typeof applicationEventViewSchema>;

export const applicationDetailSchema = applicationSummarySchema.extend({
  phone: z.string().nullable(),
  website: z.string().nullable(),
  professionalBackground: z.string(),
  investmentExperience: z.string(),
  qualifications: z.string().nullable(),
  reason: z.string(),
  intendedBaskets: z.string(),
  emailConfirmedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedByUserId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  events: z.array(applicationEventViewSchema),
});
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;

export const grantRoleRequestSchema = z.strictObject({ userId: z.uuid(), role: platformRoleSchema });
export type GrantRoleRequest = z.infer<typeof grantRoleRequestSchema>;

export const platformRoleViewSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  role: platformRoleSchema,
  grantedByUserId: z.uuid().nullable(),
  grantedAt: z.iso.datetime({ offset: true }),
});
export type PlatformRoleView = z.infer<typeof platformRoleViewSchema>;

export const platformRolesResponseSchema = z.object({ roles: z.array(platformRoleViewSchema) });
export type PlatformRolesResponse = z.infer<typeof platformRolesResponseSchema>;
