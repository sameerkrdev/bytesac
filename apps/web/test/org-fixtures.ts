import type { BasketAssetView, BasketAssignmentView, BasketDetail, BasketDiff, BasketVersionView, MemberView, MembershipRole, OpsBasketDetail, OrganizationDetail, VersionView } from "@repo/validator";
import { vi, type Mock } from "vitest";

export const ORG_ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
export const T = "2026-09-29T00:00:00.000Z";

export const version = (over: Partial<VersionView> = {}): VersionView => ({
  id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e62", versionNumber: 1, status: "draft", publicProfile: {}, privateDetails: {}, submittedAt: null, documents: [], ...over,
});

export const orgDetail = (over: Partial<OrganizationDetail> = {}): OrganizationDetail => ({
  id: ORG_ID, type: "individual", status: "DRAFT", jurisdiction: "GB", submittedAt: null, verifiedAt: null,
  openVersion: version(), currentVersion: null, payoutWallets: [],
  template: { requiredFields: ["displayName", "about", "experience", "legalName", "dateOfBirth", "residentialAddress", "professionalHistory"], requiredDocuments: ["government_id", "proof_of_address"] },
  missing: { fields: [], documents: [], payoutWallet: false }, latestMessageToOwner: null,
  myRole: "OWNER", myPermissions: ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage"], ...over,
});

export const wallet = (over: Partial<OrganizationDetail["payoutWallets"][number]> = {}): OrganizationDetail["payoutWallets"][number] => ({
  id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e63", chain: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "UNVERIFIED", verifiedAt: null, activatedAt: null, deactivatedAt: null, createdAt: T, ...over,
});

export const PERMISSIONS: Record<MembershipRole, OrganizationDetail["myPermissions"]> = {
  OWNER: ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage"],
  ADMIN: ["org.read", "members.manage", "analytics.read", "baskets.manage"],
  MANAGER: ["org.read", "analytics.read", "baskets.manage"],
  ANALYST: ["org.read", "analytics.read"],
  VIEWER: ["org.read"],
};

export const asRole = (role: MembershipRole, over: Partial<OrganizationDetail> = {}) => orgDetail({ myRole: role, myPermissions: PERMISSIONS[role], ...over });

let n = 0;
export const memberView = (over: Partial<MemberView> = {}): MemberView => ({
  id: `0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f${String(++n).padStart(2, "0")}`, role: "VIEWER", requestedRole: null, status: "ACTIVE", publicDisplayName: null, publicTitle: null, isSelf: false,
  activatedAt: T, inviteExpiresAt: null, invitedWallet: null, invitedEmail: null, verificationStatus: null, ...over,
});

// Baskets (Spec 6)
export const BID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5001";
export const VID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5002";
export const SOL = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5003";
export const ETH = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5004";
export const ALL_FLAGS: BasketDetail["myPermissions"] = ["edit", "submit", "publish", "lifecycle", "assign"];

export const basketAsset = (over: Partial<BasketAssetView> = {}): BasketAssetView => ({
  instrumentId: SOL, name: "Solana", symbol: "SOL", assetType: "CRYPTO", instrumentStatus: "ACTIVE", hasActiveDeployment: true, targetWeightBps: 6000, minWeightBps: null, maxWeightBps: null, rationale: null, ...over,
});

export const basketVersion = (over: Partial<BasketVersionView> = {}): BasketVersionView => ({
  id: VID, versionNumber: 1, status: "draft", name: "Core Crypto", shortDescription: "Two assets", longDescription: null, category: "multi_asset", tags: [], objective: null, thesis: "Thesis", methodology: "Method",
  intendedInvestor: null, horizon: null, keyAssumptions: null, knownLimitations: null, strategyRisks: "Prices move", liquidityNotes: null, conflictsOfInterest: null, constraints: {}, rebalance: { reviewFrequency: "none" },
  fees: { entry: { type: "percent", bps: 0 }, management: { type: "percent", bps: 50 }, rebalance: { type: "percent", bps: 0 }, subscription: null }, minimumInvestmentUsdc: "100", minimumIncrementUsdc: null,
  rationale: null, contentHash: null, submittedAt: null, approvedAt: null, publishedAt: null, createdAt: T, updatedAt: T,
  assets: [basketAsset(), basketAsset({ instrumentId: ETH, name: "Ether", symbol: "ETH", targetWeightBps: 4000 })], disclosures: [], ...over,
});

export const basketAssignment = (over: Partial<BasketAssignmentView> = {}): BasketAssignmentView => ({
  id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5010", membershipId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5011", displayName: "Olga Ivanova", role: "lead", permissions: ALL_FLAGS, status: "ACTIVE",
  startedAt: T, endedAt: null, endReason: null, isSelf: true, ...over,
});

export const basketDetail = (over: Partial<BasketDetail> = {}): BasketDetail => ({
  id: BID, organizationId: ORG_ID, slug: "core-crypto", status: "DRAFT", previousStatus: null, pauseKind: null, pauseReason: null, createdAt: T, updatedAt: T, myPermissions: ALL_FLAGS, canControlLead: true,
  openVersion: basketVersion(), publishedVersion: null, assignments: [basketAssignment()], reviews: [], events: [], validation: null, hasAssetWarning: false, ...over,
});

export const emptyDiff: BasketDiff = { added: [], removed: [], changed: [], bandChanged: [], constraints: false, rebalance: false, fees: false, minimums: false };

export const opsBasketDetail = (over: Partial<OpsBasketDetail> = {}): OpsBasketDetail => ({
  ...basketDetail({ status: "ACTIVE", openVersion: basketVersion({ status: "in_review" }) }),
  organization: { id: ORG_ID, displayName: "Ada Capital", status: "VERIFIED" }, versions: [], reviews: [], diff: null, ...over,
});

/** Every call the basket workspace makes, as mocks; pass overrides for the ones a test cares about. */
export const basketClient = (over: Record<string, Mock> = {}) => ({
  getBasket: vi.fn().mockResolvedValue(basketDetail()),
  saveBasketDraft: vi.fn().mockResolvedValue(basketDetail()),
  previewBasket: vi.fn().mockResolvedValue({ version: basketVersion(), validation: { issues: [], warnings: [] } }),
  listBasketVersions: vi.fn().mockResolvedValue({ versions: [] }),
  getBasketVersionDiff: vi.fn().mockResolvedValue(emptyDiff),
  submitBasket: vi.fn().mockResolvedValue(basketDetail()),
  withdrawBasket: vi.fn(), publishBasket: vi.fn(), createBasketVersion: vi.fn(), pauseBasket: vi.fn(), resumeBasket: vi.fn(), requestBasketRetirement: vi.fn(),
  listAssets: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listOrganizationMembers: vi.fn().mockResolvedValue({ members: [] }),
  addBasketAssignment: vi.fn(), updateBasketAssignment: vi.fn(), endBasketAssignment: vi.fn(),
  ...over,
});
