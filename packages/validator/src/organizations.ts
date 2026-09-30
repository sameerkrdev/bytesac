import { z } from "zod";
import { chainSchema } from "./chains";

export const ORGANIZATION_TYPES = ["individual", "firm"] as const;
export const organizationTypeSchema = z.enum(ORGANIZATION_TYPES);
export type OrganizationType = z.infer<typeof organizationTypeSchema>;

export const ORGANIZATION_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "RESUBMITTED", "VERIFIED", "REJECTED"] as const;
export const organizationStatusSchema = z.enum(ORGANIZATION_STATUSES);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

/** Ops transitions. DRAFT→SUBMITTED and CHANGES_REQUIRED→RESUBMITTED are owner submits. */
export const ORGANIZATION_TRANSITIONS: Readonly<Record<OrganizationStatus, readonly OrganizationStatus[]>> = {
  DRAFT: [],
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["CHANGES_REQUIRED", "VERIFIED", "REJECTED"],
  CHANGES_REQUIRED: [],
  RESUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  VERIFIED: [],
  REJECTED: [],
};

export const VERSION_STATUSES = ["draft", "in_review", "changes_required", "approved", "rejected", "superseded"] as const;
export const versionStatusSchema = z.enum(VERSION_STATUSES);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

export const PAYOUT_WALLET_STATUSES = ["UNVERIFIED", "VERIFYING", "VERIFIED", "REPLACEMENT_PENDING", "REVOKED"] as const;
export const payoutWalletStatusSchema = z.enum(PAYOUT_WALLET_STATUSES);
export type PayoutWalletStatus = z.infer<typeof payoutWalletStatusSchema>;

export const membershipRoleSchema = z.enum(["OWNER", "ADMIN", "MANAGER", "ANALYST", "VIEWER"]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const ORGANIZATION_PERMISSIONS = ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage"] as const;
export const organizationPermissionSchema = z.enum(ORGANIZATION_PERMISSIONS);
export type OrganizationPermission = z.infer<typeof organizationPermissionSchema>;

/** What a verification requirement template applies to: an organization type, or a member of an organization. */
export const TEMPLATE_SUBJECTS = ["individual", "firm", "member"] as const;
export const templateSubjectSchema = z.enum(TEMPLATE_SUBJECTS);
export type TemplateSubject = z.infer<typeof templateSubjectSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Field catalog and document types
// ---------------------------------------------------------------------------------------------------------------------

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max);
const MIN_AGE = 18;

const dateOfBirth = z.iso.date().refine((d) => {
  const cutoff = new Date(Date.now());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - MIN_AGE);
  return new Date(d) <= cutoff;
}, { message: `Must be at least ${MIN_AGE} years old` });

export const ORGANIZATION_FIELD_KEYS = [
  "displayName", "about", "experience", "investmentPhilosophy", "website", "registrations",
  "legalName", "dateOfBirth", "residentialAddress", "professionalHistory", "qualifications",
  "legalCompanyName", "registrationNumber", "registeredAddress", "businessAddress", "directors", "beneficialOwners", "authorizedRepresentatives",
] as const;
export type OrganizationFieldKey = (typeof ORGANIZATION_FIELD_KEYS)[number];

export interface OrganizationField { label: string; visibility: "public" | "private"; schema: z.ZodType }

export const ORGANIZATION_FIELDS: Readonly<Record<OrganizationFieldKey, OrganizationField>> = {
  displayName: { label: "Display name", visibility: "public", schema: text(2, 120) },
  about: { label: "About", visibility: "public", schema: text(20, 4000) },
  experience: { label: "Experience", visibility: "public", schema: text(20, 4000) },
  investmentPhilosophy: { label: "Investment philosophy", visibility: "public", schema: optionalText(4000) },
  website: { label: "Website", visibility: "public", schema: z.url({ protocol: /^https$/ }).max(2048) },
  registrations: { label: "Registrations and licences", visibility: "public", schema: optionalText(2000) },
  legalName: { label: "Legal name", visibility: "private", schema: text(2, 160) },
  dateOfBirth: { label: "Date of birth", visibility: "private", schema: dateOfBirth },
  residentialAddress: { label: "Residential address", visibility: "private", schema: text(5, 500) },
  professionalHistory: { label: "Professional history", visibility: "private", schema: text(20, 4000) },
  qualifications: { label: "Qualifications", visibility: "private", schema: optionalText(4000) },
  legalCompanyName: { label: "Legal company name", visibility: "private", schema: text(2, 200) },
  registrationNumber: { label: "Registration number", visibility: "private", schema: text(2, 64) },
  registeredAddress: { label: "Registered address", visibility: "private", schema: text(5, 500) },
  businessAddress: { label: "Business address", visibility: "private", schema: optionalText(500) },
  directors: { label: "Directors", visibility: "private", schema: text(2, 4000) },
  beneficialOwners: { label: "Beneficial owners", visibility: "private", schema: text(2, 4000) },
  authorizedRepresentatives: { label: "Authorized representatives", visibility: "private", schema: text(2, 4000) },
};

export const DOCUMENT_TYPE_KEYS = ["government_id", "proof_of_address", "company_registration", "ownership_structure", "director_id", "license_registration"] as const;
export type DocumentTypeKey = (typeof DOCUMENT_TYPE_KEYS)[number];
export const documentTypeSchema = z.enum(DOCUMENT_TYPE_KEYS);

export const ORGANIZATION_DOCUMENT_TYPES: Readonly<Record<DocumentTypeKey, { label: string }>> = {
  government_id: { label: "Government ID" },
  proof_of_address: { label: "Proof of address" },
  company_registration: { label: "Company registration" },
  ownership_structure: { label: "Ownership structure" },
  director_id: { label: "Director ID" },
  license_registration: { label: "Licence or registration" },
};

/** Seeded by migrations 0005 and 0006 (jurisdiction null); apps/api/test/db checks the seeded rows equal this. */
export const DEFAULT_TEMPLATES: Readonly<Record<TemplateSubject, { requiredFields: readonly OrganizationFieldKey[]; requiredDocuments: readonly DocumentTypeKey[] }>> = {
  individual: {
    requiredFields: ["displayName", "about", "experience", "legalName", "dateOfBirth", "residentialAddress", "professionalHistory"],
    requiredDocuments: ["government_id", "proof_of_address"],
  },
  firm: {
    requiredFields: ["displayName", "about", "experience", "legalCompanyName", "registrationNumber", "registeredAddress", "directors", "beneficialOwners", "authorizedRepresentatives"],
    requiredDocuments: ["company_registration", "ownership_structure", "director_id", "proof_of_address"],
  },
  member: {
    requiredFields: ["legalName", "dateOfBirth", "residentialAddress", "professionalHistory"],
    requiredDocuments: ["government_id", "proof_of_address"],
  },
};

export const DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------------

export const createOrganizationRequestSchema = z.strictObject({
  type: organizationTypeSchema,
  jurisdiction: z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 code"),
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

/** Keys must be catalog keys of `visibility`; each value passes its field schema, or is `null` to remove the key. Required-ness is only checked on submit. The output holds the parsed (trimmed) values. */
const draftPart = (visibility: "public" | "private") => z.record(z.string(), z.unknown()).transform((entries, ctx) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    const field = Object.hasOwn(ORGANIZATION_FIELDS, key) ? ORGANIZATION_FIELDS[key as OrganizationFieldKey] : undefined;
    if (field?.visibility !== visibility) {
      ctx.addIssue({ code: "custom", path: [key], message: `Unknown ${visibility} field` });
      continue;
    }
    if (value === null) {
      out[key] = null;
      continue;
    }
    const parsed = field.schema.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
    else for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: [key, ...issue.path], message: issue.message });
  }
  return out;
});

export const updateDraftRequestSchema = z.strictObject({
  publicProfile: draftPart("public").optional(),
  privateDetails: draftPart("private").optional(),
});
export type UpdateDraftRequest = z.infer<typeof updateDraftRequestSchema>;

export const presignDocumentRequestSchema = z.strictObject({
  documentType: documentTypeSchema,
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
});
export type PresignDocumentRequest = z.infer<typeof presignDocumentRequestSchema>;

export const presignDocumentResponseSchema = z.object({
  documentId: z.uuid(),
  uploadUrl: z.url(),
  headers: z.object({ "Content-Type": z.string() }),
});
export type PresignDocumentResponse = z.infer<typeof presignDocumentResponseSchema>;

const internalNote = z.string().trim().min(1).max(4000);
const messageToOwner = internalNote;

export const transitionOrganizationRequestSchema = z.strictObject({
  to: organizationStatusSchema,
  internalNote: internalNote.optional(),
  messageToOwner: messageToOwner.optional(),
}).refine((v) => v.to !== "CHANGES_REQUIRED" || v.messageToOwner, { path: ["messageToOwner"], message: "A message to the owner is required" });
export type TransitionOrganizationRequest = z.infer<typeof transitionOrganizationRequestSchema>;

export const versionDecisionRequestSchema = z.strictObject({
  decision: z.enum(["approved", "changes_required", "rejected"]),
  internalNote: internalNote.optional(),
  messageToOwner: messageToOwner.optional(),
}).refine((v) => v.decision !== "changes_required" || v.messageToOwner, { path: ["messageToOwner"], message: "A message to the owner is required" });
export type VersionDecisionRequest = z.infer<typeof versionDecisionRequestSchema>;

export const payoutWalletDecisionRequestSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  internalNote: internalNote.optional(),
});
export type PayoutWalletDecisionRequest = z.infer<typeof payoutWalletDecisionRequestSchema>;

export const organizationNoteRequestSchema = z.strictObject({ internalNote });
export type OrganizationNoteRequest = z.infer<typeof organizationNoteRequestSchema>;

export const enterPayoutWalletRequestSchema = z.strictObject({ address: z.string().trim().min(1).max(128) });
export type EnterPayoutWalletRequest = z.infer<typeof enterPayoutWalletRequestSchema>;

export const verifyPayoutWalletRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  /** Base58 of the 64-byte ed25519 signature. */
  signature: z.string().min(1).max(20_000),
});
export type VerifyPayoutWalletRequest = z.infer<typeof verifyPayoutWalletRequestSchema>;

export const listOrganizationsQuerySchema = z.object({
  queue: z.enum(["organizations", "change_requests", "payout_changes"]).default("organizations"),
  status: organizationStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});
export type ListOrganizationsQuery = z.input<typeof listOrganizationsQuerySchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------

const isoTime = z.iso.datetime({ offset: true });

export const missingRequirementsSchema = z.object({
  fields: z.array(z.string()),
  documents: z.array(z.string()),
  payoutWallet: z.boolean(),
});
export type MissingRequirements = z.infer<typeof missingRequirementsSchema>;

/** Metadata only: the storage key is never exposed. */
export const documentViewSchema = z.object({
  id: z.uuid(),
  documentType: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["pending_upload", "uploaded", "rejected_file"]),
  uploadedAt: isoTime.nullable(),
});
export type DocumentView = z.infer<typeof documentViewSchema>;

export const versionViewSchema = z.object({
  id: z.uuid(),
  versionNumber: z.number(),
  status: versionStatusSchema,
  publicProfile: z.record(z.string(), z.unknown()),
  privateDetails: z.record(z.string(), z.unknown()),
  submittedAt: isoTime.nullable(),
  documents: z.array(documentViewSchema),
});
export type VersionView = z.infer<typeof versionViewSchema>;

export const payoutWalletViewSchema = z.object({
  id: z.uuid(),
  chain: chainSchema,
  address: z.string(),
  status: payoutWalletStatusSchema,
  verifiedAt: isoTime.nullable(),
  activatedAt: isoTime.nullable(),
  deactivatedAt: isoTime.nullable(),
  createdAt: isoTime,
});
export type PayoutWalletView = z.infer<typeof payoutWalletViewSchema>;

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  type: organizationTypeSchema,
  status: organizationStatusSchema,
  jurisdiction: z.string(),
  role: membershipRoleSchema,
  /** The membership this row comes from; `status` above is the organization's own status. */
  membershipId: z.uuid(),
  membershipStatus: z.enum(["PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "ACTIVE", "REMOVAL_REQUESTED"]),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const listMyOrganizationsResponseSchema = z.object({ organizations: z.array(organizationSummarySchema) });
export type ListMyOrganizationsResponse = z.infer<typeof listMyOrganizationsResponseSchema>;

/** Owner view. `openVersion` is the version in draft, in_review or changes_required (editable only in draft and changes_required); `missing` is computed for it. */
export const organizationDetailSchema = z.object({
  id: z.uuid(),
  type: organizationTypeSchema,
  status: organizationStatusSchema,
  jurisdiction: z.string(),
  submittedAt: isoTime.nullable(),
  verifiedAt: isoTime.nullable(),
  openVersion: versionViewSchema.nullable(),
  currentVersion: versionViewSchema.nullable(),
  payoutWallets: z.array(payoutWalletViewSchema),
  template: z.object({ requiredFields: z.array(z.string()), requiredDocuments: z.array(z.string()) }),
  missing: missingRequirementsSchema.nullable(),
  latestMessageToOwner: z.string().nullable(),
  /** The caller's active role and the permissions it grants (the server stays authoritative). */
  myRole: membershipRoleSchema,
  myPermissions: z.array(organizationPermissionSchema),
});
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

export const publicOrganizationSchema = z.object({
  id: z.uuid(),
  type: organizationTypeSchema,
  jurisdiction: z.string(),
  verifiedAt: isoTime,
  /** Public catalog fields of the current approved version. */
  profile: z.record(z.string(), z.unknown()),
  /** Members who opted in with a public name. Never ids, wallets or emails. */
  team: z.object({
    current: z.array(z.object({ displayName: z.string(), title: z.string().nullable(), role: membershipRoleSchema })),
    former: z.array(z.object({ displayName: z.string(), title: z.string().nullable(), role: membershipRoleSchema, from: isoTime, to: isoTime })),
  }),
});
export type PublicOrganization = z.infer<typeof publicOrganizationSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Ops review
// ---------------------------------------------------------------------------------------------------------------------

export const organizationReviewSummarySchema = z.object({
  id: z.uuid(),
  type: organizationTypeSchema,
  status: organizationStatusSchema,
  jurisdiction: z.string(),
  /** From the latest version. */
  displayName: z.string().nullable(),
  legalName: z.string().nullable(),
  submittedAt: isoTime.nullable(),
  updatedAt: isoTime,
});
export type OrganizationReviewSummary = z.infer<typeof organizationReviewSummarySchema>;

export const listOrganizationsResponseSchema = z.object({ items: z.array(organizationReviewSummarySchema), nextCursor: z.string().nullable() });
export type ListOrganizationsResponse = z.infer<typeof listOrganizationsResponseSchema>;

export const organizationEventViewSchema = z.object({
  id: z.uuid(),
  actorType: z.enum(["owner", "ops", "system"]),
  actorUserId: z.uuid().nullable(),
  kind: z.enum(["status_changed", "note", "version_submitted", "version_decided", "document_uploaded", "document_unlinked", "version_created", "payout_wallet_changed"]),
  fromStatus: organizationStatusSchema.nullable(),
  toStatus: organizationStatusSchema.nullable(),
  versionId: z.uuid().nullable(),
  payoutWalletId: z.uuid().nullable(),
  decision: z.string().nullable(),
  internalNote: z.string().nullable(),
  messageToOwner: z.string().nullable(),
  createdAt: isoTime,
});
export type OrganizationEventView = z.infer<typeof organizationEventViewSchema>;

/** Ops view: everything, including private details, internal notes and wallet history. Documents are metadata; downloads go through the ops download route. */
export const organizationReviewDetailSchema = z.object({
  id: z.uuid(),
  type: organizationTypeSchema,
  status: organizationStatusSchema,
  jurisdiction: z.string(),
  currentVersionId: z.uuid().nullable(),
  submittedAt: isoTime.nullable(),
  verifiedAt: isoTime.nullable(),
  decidedByUserId: z.uuid().nullable(),
  createdAt: isoTime,
  owner: z.object({ userId: z.uuid().nullable(), addresses: z.array(z.object({ chain: chainSchema, address: z.string() })) }),
  versions: z.array(versionViewSchema),
  documents: z.array(documentViewSchema.extend({ versionIds: z.array(z.uuid()) })),
  payoutWallets: z.array(payoutWalletViewSchema.extend({ requestedByUserId: z.uuid(), decidedByUserId: z.uuid().nullable() })),
  events: z.array(organizationEventViewSchema),
  template: z.object({ requiredFields: z.array(z.string()), requiredDocuments: z.array(z.string()) }),
});
export type OrganizationReviewDetail = z.infer<typeof organizationReviewDetailSchema>;
