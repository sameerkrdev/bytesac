import type { AssignmentFlag, BasketCategory, BasketIssueCode, BasketSection, BasketStatus, BasketVersionStatus, BasketAssignmentView } from "@repo/validator";

type Tone = "success" | "warning" | "danger" | "neutral";
type Label = { label: string; tone: Tone };

export const BASKET_STATUS_LABEL: Record<BasketStatus, Label> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  REASSIGNMENT_REQUIRED: { label: "Manager change in progress", tone: "warning" },
  RETIREMENT_PENDING: { label: "Retirement pending", tone: "warning" },
  RETIRED: { label: "Retired", tone: "neutral" },
  REJECTED: { label: "Not approved", tone: "danger" },
};

export const BASKET_VERSION_STATUS_LABEL: Record<BasketVersionStatus, Label> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "neutral" },
  changes_required: { label: "Changes required", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  published: { label: "Published", tone: "success" },
  superseded: { label: "Superseded", tone: "neutral" },
  rejected: { label: "Not approved", tone: "danger" },
};

export const ASSIGNMENT_STATUS_LABEL: Record<BasketAssignmentView["status"], Label> = {
  PENDING_APPROVAL: { label: "Awaiting platform approval", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  ENDED: { label: "Ended", tone: "neutral" },
  REJECTED: { label: "Not approved", tone: "danger" },
};

export const BASKET_CATEGORY_LABEL: Record<BasketCategory, string> = {
  index: "Index", thematic: "Thematic", sector: "Sector", yield: "Yield", stablecoin: "Stablecoin", rwa: "Real-world assets", multi_asset: "Multi-asset",
};

export const ASSIGNMENT_FLAG_LABEL: Record<AssignmentFlag, string> = {
  edit: "Edit drafts", submit: "Submit for review", publish: "Publish", lifecycle: "Pause and retire", assign: "Manage managers",
};

export const BASKET_SECTION_LABEL: Record<BasketSection, string> = {
  basics: "Basics", thesis: "Thesis", assets: "Assets & allocation", constraints: "Constraints", rebalance: "Rebalance", managers: "Managers",
  fees: "Fees & minimum", risks: "Risks & disclosures", review: "Review & preview",
};

export const BASKET_ISSUE_LABEL: Record<BasketIssueCode, string> = {
  ORG_NOT_ELIGIBLE: "Organization not verified",
  BASKET_NAME_REQUIRED: "Name and short description needed",
  DISCLOSURE_MISSING: "Strategy risks needed",
  ASSET_UNSUPPORTED: "Asset not available",
  ASSET_COUNT_INVALID: "Between 1 and 20 assets",
  ALLOCATION_DUPLICATE: "Duplicate asset",
  ALLOCATION_WEIGHT_INVALID: "Weight not allowed",
  ALLOCATION_TOTAL_INVALID: "Weights must add up to 100%",
  CONSTRAINT_VIOLATION: "Constraint broken",
  FEE_CONFIGURATION_INVALID: "Fee not allowed",
  MINIMUM_INVESTMENT_INVALID: "Minimum investment not valid",
  MANAGER_ASSIGNMENT_REQUIRED: "Lead manager needed",
  REBALANCE_RATIONALE_REQUIRED: "Explain this version",
};
