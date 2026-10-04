/** Manager-workspace fixtures for the mock API (persona "manager" = OWNER of Meridian Research Partners). Fictional. */
import { ORGANIZATION_PERMISSIONS, type Earnings, type ListBasketsResponse, type ListMembersResponse, type OrganizationDetail } from "@repo/validator";
import { BASKETS, ORGS } from "./catalog";
import type { Route } from "./server";
import { earningsSchema, listBasketsResponseSchema, listMembersResponseSchema, organizationDetailSchema } from "@repo/validator";

const T = (d: string) => `${d}T09:00:00.000Z`;
const uuid = (n: number) => `0192f1c2-7a4b-7c3d-8e9f-${n.toString(16).padStart(12, "0")}`;
const org = ORGS.meridian;

export const ORG_DETAIL: OrganizationDetail = {
  id: org.id, type: "firm", status: "VERIFIED", jurisdiction: "GB", submittedAt: T("2025-11-10"), verifiedAt: T("2025-12-01"),
  openVersion: null,
  currentVersion: {
    id: uuid(0x900), versionNumber: 2, status: "approved", submittedAt: T("2025-11-10"),
    publicProfile: { displayName: org.displayName, about: org.description, experience: "Index and multi-asset portfolio management since 2017, with a focus on transparent, rules-based methods.", investmentPhilosophy: "Diversify across durable networks, cap concentration, explain every change.", website: org.website },
    privateDetails: { legalCompanyName: "Meridian Research Partners Ltd (fictional)", registrationNumber: "00000000", registeredAddress: "1 Example Street, London" },
    documents: [{ id: uuid(0x901), documentType: "company_registration", contentType: "application/pdf", sizeBytes: 182_000, status: "uploaded", uploadedAt: T("2025-11-09") }],
  },
  payoutWallets: [{ id: uuid(0x902), chain: "solana", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", status: "VERIFIED", verifiedAt: T("2025-11-20"), activatedAt: T("2025-11-20"), deactivatedAt: null, createdAt: T("2025-11-18") }],
  template: { requiredFields: ["displayName", "about", "experience", "website", "legalCompanyName", "registrationNumber", "registeredAddress"], requiredDocuments: ["company_registration"] },
  missing: null, latestMessageToOwner: null, myRole: "OWNER", myPermissions: [...ORGANIZATION_PERMISSIONS],
} as unknown as OrganizationDetail;

const BASKET_LIST: ListBasketsResponse = {
  baskets: [
    ...BASKETS.filter((b) => b.org === "meridian").map((b, i) => ({ id: uuid(0xa00 + i), slug: b.slug, name: b.name, category: b.category, status: "ACTIVE" as const, currentVersionNumber: b.version, openVersionStatus: null, updatedAt: T("2026-09-12") })),
    { id: uuid(0xa10), slug: "stable-yield-draft", name: "Stable Yield", category: "stablecoin", status: "DRAFT", currentVersionNumber: null, openVersionStatus: "draft", updatedAt: T("2026-10-02") },
    { id: uuid(0xa11), slug: "defi-blue-chips", name: "DeFi Blue Chips", category: "sector", status: "DRAFT", currentVersionNumber: null, openVersionStatus: "in_review", updatedAt: T("2026-09-28") },
  ],
};

const member = (n: number, role: "OWNER" | "ADMIN" | "MANAGER" | "ANALYST" | "VIEWER", name: string | null, title: string | null, status = "ACTIVE", self = false) => ({
  id: uuid(0xb00 + n), role, requestedRole: null, status, publicDisplayName: name, publicTitle: title, isSelf: self, activatedAt: status === "ACTIVE" ? T("2025-12-02") : null,
  inviteExpiresAt: status === "INVITED" ? T("2026-10-14") : null, invitedWallet: status === "INVITED" ? { chain: "ethereum" as const, address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" } : null, invitedEmail: null,
  verificationStatus: role === "ADMIN" || role === "MANAGER" ? "approved" as const : null,
});

const MEMBERS = {
  members: [
    member(1, "OWNER", "Elena Marsh", "Founder", "ACTIVE", true), member(2, "MANAGER", "David Okafor", "Portfolio Manager"),
    member(3, "ANALYST", "Hana Sato", "Research Analyst"), member(4, "VIEWER", null, null, "INVITED"),
  ],
} as unknown as ListMembersResponse;

const EARNINGS: Earnings = {
  totalMicro: "1846200000", waivedCount: 3,
  groups: [
    { basketId: uuid(0xa00), basketName: "Core Crypto Index", versionNumber: 3, kind: "manager_entry", month: "2026-09", amountMicro: "912400000" },
    { basketId: uuid(0xa00), basketName: "Core Crypto Index", versionNumber: 2, kind: "manager_entry", month: "2026-08", amountMicro: "641800000" },
    { basketId: uuid(0xa00), basketName: "Core Crypto Index", versionNumber: 3, kind: "manager_rebalance", month: "2026-09", amountMicro: "292000000" },
  ],
  recent: [{ settledAt: T("2026-10-02"), basketId: uuid(0xa00), kind: "manager_entry", amountMicro: "500000", tx: "5h1xQmock", explorerUrl: "https://solscan.io/tx/5h1xQmock" }],
};

const deny = { status: 403, body: { error: { code: "FORBIDDEN", message: "Not a member." } } };

export const managerRoutes: Route[] = [
  ["GET", /^\/v1\/organizations\/([^/]+)$/, ({ persona }, [id]) => (persona === "manager" && id === org.id ? { schema: organizationDetailSchema, body: ORG_DETAIL } : deny)],
  ["GET", /^\/v1\/organizations\/([^/]+)\/baskets$/, ({ persona }) => (persona === "manager" ? { schema: listBasketsResponseSchema, body: BASKET_LIST } : deny)],
  ["GET", /^\/v1\/organizations\/([^/]+)\/members$/, ({ persona }) => (persona === "manager" ? { schema: listMembersResponseSchema, body: MEMBERS } : deny)],
  ["GET", /^\/v1\/organizations\/([^/]+)\/earnings$/, ({ persona }) => (persona === "manager" ? { schema: earningsSchema, body: EARNINGS } : deny)],
];
