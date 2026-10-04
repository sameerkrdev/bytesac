/** Ops console fixtures for the mock API (persona "ops" = ops_admin). Fictional. */
import { listApplicationsResponseSchema, opsAssetListResponseSchema } from "@repo/validator";
import { ASSETS } from "./catalog";
import type { Route } from "./server";

const T = (d: string) => `${d}T09:00:00.000Z`;
const uuid = (n: number) => `0192f1c2-7a4b-7c3d-8e9f-${n.toString(16).padStart(12, "0")}`;
const deny = { status: 403, body: { error: { code: "FORBIDDEN", message: "Ops only." } } };

const APPLICATIONS = [
  ["Priya Raman", "Northlight Digital Assets", "SCREENING_APPROVED"], ["Tomás Ferreira", null, "SCREENING"], ["Amara Nwosu", "Lattice Partners", "SUBMITTED"],
  ["Jonas Berg", null, "ADDITIONAL_INFORMATION_REQUIRED"], ["Mei Chen", "Harbor Quant", "CONTACTED"],
] as const;

export const opsRoutes: Route[] = [
  ["GET", /^\/v1\/ops\/applications$/, ({ persona }) => (persona !== "ops" ? deny : { schema: listApplicationsResponseSchema, body: {
    items: APPLICATIONS.map(([fullName, firmName, status], i) => ({
      id: uuid(0xc00 + i), status, applicantType: firmName ? "firm" : "individual", fullName, firmName, email: `applicant${i}@example.com`, country: ["GB", "PT", "NG", "SE", "SG"][i],
      walletChain: "ethereum", walletAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", walletProvenAt: i < 2 ? T("2026-09-20") : null, submittedAt: T(`2026-09-${20 + i}`),
    })), nextCursor: null,
  } })],
  ["GET", /^\/v1\/ops\/assets$/, ({ persona }) => (persona !== "ops" ? deny : { schema: opsAssetListResponseSchema, body: {
    items: Object.values(ASSETS).map((a, i) => ({ id: a.id, name: a.name, symbol: a.symbol, assetType: a.type, status: i === 7 ? "UNDER_REVIEW" : i === 12 ? "PAUSED" : "ACTIVE", chains: a.chains, updatedAt: T("2026-09-30") })),
    nextCursor: null,
  } })],
];
