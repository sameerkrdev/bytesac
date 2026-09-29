import type { ApplicationStatus } from "@repo/validator";

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  EMAIL_PENDING: { label: "Confirm your email", tone: "warning" },
  SUBMITTED: { label: "Submitted", tone: "neutral" },
  SCREENING: { label: "In review", tone: "neutral" },
  CONTACTED: { label: "We've contacted you", tone: "neutral" },
  ADDITIONAL_INFORMATION_REQUIRED: { label: "More information needed", tone: "warning" },
  SCREENING_APPROVED: { label: "Approved", tone: "success" },
  SCREENING_REJECTED: { label: "Not approved", tone: "danger" },
};
