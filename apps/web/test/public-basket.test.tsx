import type { PublicBasketDetail } from "@repo/validator";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ETH, SOL, emptyDiff } from "./org-fixtures";

const permanentRedirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); });
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, permanentRedirect: (p: string) => permanentRedirect(p) }));
import PublicBasketsPage from "@/app/baskets/page";
import PublicBasketPage from "@/app/baskets/[slug]/page";

afterEach(() => vi.unstubAllGlobals());
const T = "2026-09-30T00:00:00.000Z";
const serve = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));

const price = { instrumentId: SOL, kind: "market", status: "ok", value: "150.25", currency: "USD", source: "cmc", observedAt: T, stale: false } as const;
const detail = (over: Partial<PublicBasketDetail> = {}): PublicBasketDetail => ({
  slug: "core-crypto", status: "ACTIVE", hasAssetWarning: false, organization: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", displayName: "Ada Capital" },
  version: {
    versionNumber: 2, publishedAt: T, name: "Core Crypto", shortDescription: "Two assets", longDescription: null, category: "multi_asset", tags: [], objective: null, thesis: "A <b>bold</b> thesis", methodology: null,
    intendedInvestor: null, horizon: null, keyAssumptions: null, knownLimitations: null, strategyRisks: "Prices move", liquidityNotes: null, conflictsOfInterest: null, constraints: {},
    rebalance: { reviewFrequency: "monthly" }, fees: { entry: { type: "percent", bps: 0 }, management: { type: "percent", bps: 50 }, rebalance: { type: "percent", bps: 0 }, subscription: null },
    minimumInvestmentUsdc: "100", minimumIncrementUsdc: null,
  },
  allocation: [
    { instrumentId: SOL, name: "Solana", symbol: "SOL", assetType: "CRYPTO", chains: ["solana"], targetWeightBps: 6000, minWeightBps: null, maxWeightBps: null, prices: [price] },
    { instrumentId: ETH, name: "Ether", symbol: "ETH", assetType: "CRYPTO", chains: ["ethereum"], targetWeightBps: 4000, minWeightBps: null, maxWeightBps: null, prices: [] },
  ],
  disclosures: [{ title: "No guarantee", body: "Nothing is guaranteed." }],
  versionHistory: [{ versionNumber: 2, publishedAt: T, rationale: "Rebalanced", diff: { ...emptyDiff, changed: [{ instrumentId: SOL, fromBps: 5000, toBps: 6000 }] } }, { versionNumber: 1, publishedAt: T, rationale: null, diff: emptyDiff }],
  managers: [{ displayName: "Olga Ivanova", role: "lead", from: T, to: null }, { displayName: "Max Former", role: "co_manager", from: T, to: "2026-09-30T12:00:00.000Z" }],
  ...over,
});
const page = async (slug = "core-crypto") => render(await PublicBasketPage({ params: Promise.resolve({ slug }) }));

describe("Public basket page", () => {
  it("renders the allocation with prices, unavailable prices, the disabled invest button and plain text", async () => {
    serve(detail());
    await page();
    expect(screen.getByRole("heading", { level: 1, name: "Core Crypto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investing opens soon" })).toBeDisabled();
    expect(screen.getByText("150.25 USD")).toBeInTheDocument();
    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
    expect(screen.getByText("A <b>bold</b> thesis")).toBeInTheDocument();
    expect(screen.getByText("Nothing is guaranteed.")).toBeInTheDocument();
    expect(screen.getByText(/explicit consent/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Capital" })).toHaveAttribute("href", "/organizations/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61");
  });

  it("badges a stale price", async () => {
    serve(detail({ allocation: [{ ...detail().allocation[0]!, prices: [{ ...price, stale: true }] }] }));
    await page();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("shows version history with diffs and rationale, and current and former managers", async () => {
    serve(detail());
    await page();
    const history = screen.getByRole("region", { name: "Version history" });
    expect(history).toHaveTextContent("Rebalanced");
    expect(history).toHaveTextContent("Solana (SOL): 50% to 60%");
    expect(screen.getByRole("region", { name: "Current managers" })).toHaveTextContent("Olga Ivanova · Lead");
    expect(screen.getByRole("region", { name: "Former managers" })).toHaveTextContent("Max Former · Co-manager");
  });

  it.each([
    ["PAUSED", /paused/],
    ["REASSIGNMENT_REQUIRED", /new lead needs approval/],
    ["RETIREMENT_PENDING", /has not decided/],
    ["RETIRED", /This basket is retired/],
  ] as const)("shows a notice for %s", async (status, text) => {
    serve(detail({ status }));
    await page();
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("warns when an asset was paused after publication", async () => {
    serve(detail({ hasAssetWarning: true }));
    await page();
    expect(screen.getByText(/paused or deprecated in the registry/)).toBeInTheDocument();
  });

  it("redirects a retired slug permanently to the current one", async () => {
    serve({ redirectTo: "new-slug" });
    await expect(page("old-slug")).rejects.toThrow("NEXT_REDIRECT /baskets/new-slug");
    expect(permanentRedirect).toHaveBeenCalledWith("/baskets/new-slug");
  });

  it("404s an unknown slug", async () => {
    serve({}, 404);
    await expect(page("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Public basket list", () => {
  it("shows cards and a Load more link when there is a next page", async () => {
    serve({ items: [{ slug: "core-crypto", name: "Core Crypto", shortDescription: "Two assets", organizationName: "Ada Capital", category: "multi_asset", assetCount: 2, minimumInvestmentUsdc: "100", status: "PAUSED", publishedAt: T }], nextCursor: "abc" });
    render(await PublicBasketsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Core Crypto" })).toHaveAttribute("href", "/baskets/core-crypto");
    expect(screen.getByText(/2 assets · minimum 100 USDC/)).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute("href", "/baskets?cursor=abc");
  });
});
