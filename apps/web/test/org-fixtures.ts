import type { MemberView, MembershipRole, OrganizationDetail, VersionView } from "@repo/validator";

export const ORG_ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
const T = "2026-09-29T00:00:00.000Z";

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
