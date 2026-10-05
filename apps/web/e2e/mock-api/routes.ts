/** Signed-in and investor routes for the mock API, grouped by area. Extended milestone by milestone. */
import { eligibilityResponseSchema, notificationPreferencesSchema, sessionsResponseSchema, investabilitySchema, listInvitationsResponseSchema, notificationsPageSchema, operationSchema, portfolioSchema, type OperationView, publicAssetDetailSchema, publicAssetListResponseSchema } from "@repo/validator";
import { investPlan, portfolioFor } from "./portfolio";
import { ASSETS, BASKETS } from "./catalog";
import type { Route } from "./server";

const RWA = new Set(["TOKENIZED_TREASURY", "TOKENIZED_COMMODITY", "TOKENIZED_PRIVATE_CREDIT"]);
const basketId = (slug: string) => `0192f1c2-7a4b-7c3d-8e9f-${(0x200 + BASKETS.findIndex((b) => b.slug === slug)).toString(16).padStart(12, "0")}`;

const ADDR: Record<string, string> = { solana: "So11111111111111111111111111111111111111112", ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" };

const planned = new Map<string, OperationView>();

export const extraRoutes: Route[] = [
  // Profile hub: preferences, eligibility and sessions (read-only fixtures).
  ["GET", /^\/v1\/me\/notification-preferences$/, ({ persona }) => (persona ? { schema: notificationPreferencesSchema, body: { rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false } } : null)],
  ["GET", /^\/v1\/me\/eligibility$/, ({ persona }) => (persona ? { schema: eligibilityResponseSchema, body: { declaration: null } } : null)],
  ["GET", /^\/v1\/me\/sessions$/, ({ persona }) => (persona ? { schema: sessionsResponseSchema, body: { sessions: [
    { id: "0192f1c2-7a4b-7c3d-8e9f-000000000901", client: "mobile", createdAt: "2026-10-01T09:00:00.000Z", lastSeenAt: new Date().toISOString(), userAgent: "Bytesac iOS", ipPrefix: "203.0.113.0/24", current: true },
    { id: "0192f1c2-7a4b-7c3d-8e9f-000000000902", client: "web", createdAt: "2026-09-20T09:00:00.000Z", lastSeenAt: "2026-10-03T18:00:00.000Z", userAgent: "Chrome on macOS", ipPrefix: "198.51.100.0/24", current: false },
  ] } } : null)],
  ["POST", /^\/v1\/operations\/invest$/, ({ persona, body }) => {
    if (!persona) return null;
    const b = body as { basketId: string; amountUsdc: string; slippageBps: number };
    const seed = BASKETS.find((s) => basketId(s.slug) === b.basketId) ?? BASKETS[0]!;
    const op = investPlan(seed, b.amountUsdc, b.slippageBps);
    planned.set(op.id, op);
    return { schema: operationSchema, body: op };
  }],
  ["GET", /^\/v1\/operations\/([^/]+)$/, ({ persona }, [id]) => (persona && planned.has(id!) ? { schema: operationSchema, body: planned.get(id!) } : null)],
  ["POST", /^\/v1\/operations\/([^/]+)\/cancel$/, ({ persona }, [id]) => {
    const op = planned.get(id!);
    if (!persona || !op) return null;
    const cancelled = { ...op, status: "CANCELLED" as const };
    planned.set(op.id, cancelled);
    return { schema: operationSchema, body: cancelled };
  }],
  ["GET", /^\/v1\/portfolio$/, ({ persona }) => (persona ? { schema: portfolioSchema, body: portfolioFor(persona) } : { status: 401, body: { error: { code: "SESSION_EXPIRED", message: "Sign in to continue." } } })],
  ["GET", /^\/v1\/me\/invitations$/, ({ persona }) => (persona ? { schema: listInvitationsResponseSchema, body: { invitations: [] } } : null)],
  ["GET", /^\/v1\/assets$/, ({ persona, url }) => {
    if (!persona) return { status: 401, body: { error: { code: "SESSION_EXPIRED", message: "Sign in to continue." } } };
    const q = url.searchParams.get("q")?.toLowerCase();
    const type = url.searchParams.get("type");
    const items = Object.values(ASSETS).filter((a) => (!q || `${a.name} ${a.symbol}`.toLowerCase().includes(q)) && (!type || a.type === type))
      .map((a) => ({ id: a.id, name: a.name, symbol: a.symbol, assetType: a.type, chains: a.chains }));
    return { schema: publicAssetListResponseSchema, body: { items, nextCursor: null } };
  }],
  ["GET", /^\/v1\/assets\/([^/]+)$/, ({ persona }, [id]) => {
    if (!persona) return { status: 401, body: { error: { code: "SESSION_EXPIRED", message: "Sign in to continue." } } };
    const a = Object.values(ASSETS).find((x) => x.id === id);
    if (!a) return null;
    const rwa = RWA.has(a.type);
    return { schema: publicAssetDetailSchema, body: {
      id: a.id, name: a.name, symbol: a.symbol, assetType: a.type,
      description: rwa ? "A token representing shares in a fund that holds short-dated government debt. Holders are exposed to the issuer and its custodian as well as to the underlying assets." : `${a.name} is a digital asset approved in the Bytesac registry on the networks listed below.`,
      issuer: rwa ? { name: "Example Issuer Ltd (fictional)", website: "https://example.com/issuer" } : null,
      riskNotes: rwa ? "Transfers may be restricted by region or investor status. Bytesac buys and sells on secondary markets only; redemptions with the issuer are not offered." : "Prices can move sharply. Network outages can delay settlement.",
      links: [],
      deployments: a.chains.map((chain) => ({ chain, tokenStandard: chain === "bitcoin" ? "native" : chain === "solana" ? "spl" : a.symbol === "ETH" ? "native" : "erc20", address: chain === "bitcoin" || (a.symbol === "ETH") ? null : ADDR[chain] ?? null, decimals: chain === "bitcoin" ? 8 : a.symbol === "USDC" ? 6 : 18 })),
      routes: a.chains.map((chain) => ({ chain, method: rwa ? "secondary_market" : "swap", providerName: "LI.FI", settlementSymbol: "USDC", minimumAmount: rwa ? "100" : null, processingModel: "sync" })),
      prices: [{ instrumentId: a.id, kind: "market", status: "ok", value: a.price, currency: "USD", source: "coinmarketcap", observedAt: "2026-10-03T23:58:00.000Z", stale: false }, ...(rwa ? [{ instrumentId: a.id, kind: "nav" as const, status: "ok" as const, value: a.price, currency: "USD" as const, source: "issuer" as const, observedAt: "2026-10-02T00:00:00.000Z", stale: false }] : [])],
    } };
  }],
  ["GET", /^\/v1\/me\/notifications$/, ({ persona }) => (persona ? { schema: notificationsPageSchema, body: { unreadCount: 2, nextCursor: null, items: [
    { id: "0192f1c2-7a4b-7c3d-8e9f-000000000d01", kind: "rebalance_available", basketId: null, positionId: "0192f1c2-7a4b-7c3d-8e9f-000000000100", title: "Core Crypto Index: new version available", body: "A new basket version is available. Applying creates a plan you review and sign; skipping changes nothing.", link: "/portfolio/0192f1c2-7a4b-7c3d-8e9f-000000000100/rebalance", readAt: null, createdAt: "2026-10-03T08:00:00.000Z" },
    { id: "0192f1c2-7a4b-7c3d-8e9f-000000000d02", kind: "drifted", basketId: null, positionId: "0192f1c2-7a4b-7c3d-8e9f-000000000101", title: "Balanced Digital & Real-World has drifted", body: "Your basket has drifted from its target. You can review a rebalance plan or keep your allocation.", link: "/portfolio/0192f1c2-7a4b-7c3d-8e9f-000000000101/rebalance", readAt: null, createdAt: "2026-10-02T15:20:00.000Z" },
    { id: "0192f1c2-7a4b-7c3d-8e9f-000000000d03", kind: "basket_unpaused", basketId: null, positionId: null, title: "Solana Ecosystem is active again", body: "The basket is no longer paused.", link: "/baskets/solana-ecosystem", readAt: "2026-09-29T10:00:00.000Z", createdAt: "2026-09-28T10:00:00.000Z" },
  ] } } : null)],

  ["GET", /^\/v1\/baskets\/([^/]+)\/investability$/, ({ persona }, [slug]) => {
    const seed = BASKETS.find((b) => b.slug === slug);
    if (!seed) return null;
    const rwa = seed.weights.filter(([k]) => RWA.has(ASSETS[k]!.type));
    return {
      schema: investabilitySchema,
      body: {
        basketId: basketId(seed.slug), investable: true, reasons: [], requiredFamilies: [...new Set(seed.weights.flatMap(([k]) => ASSETS[k]!.chains.map((c) => (c === "solana" ? "solana" : c === "bitcoin" ? "bitcoin" : "evm"))))],
        minimumUsdc: seed.minimum,
        ...(persona ? {
          eligibility: rwa.length === 0 || persona === "manager"
            ? { eligible: true, reasons: [] }
            : { eligible: false, reasons: rwa.map(([k]) => ({ instrumentId: ASSETS[k]!.id, code: "DECLARATION_REQUIRED", message: "Confirm your country and investor status to buy tokenized assets.", outcome: "DECLARATION_REQUIRED" })) },
        } : {}),
      },
    };
  }],
];
