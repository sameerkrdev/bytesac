import { ApiError } from "@repo/api-client";
import type { OpsAssetDetail } from "@repo/validator";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetEditor } from "@/components/ops/assets/asset-editor";
import { ASSET_ID, DEPLOYMENT_ID, asset, deployment, lookups, renderAs } from "./asset-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

type Mocks = Record<string, ReturnType<typeof vi.fn>>;
const editor = (detail: OpsAssetDetail, extra: Mocks = {}, roles: Parameters<typeof renderAs>[1] = ["ops_admin"]) => {
  const client: Mocks = { ...lookups(), opsGetAsset: vi.fn().mockResolvedValue(detail), ...extra };
  renderAs(<AssetEditor id={ASSET_ID} client={client as never} />, roles);
  return client;
};
const EXPECT = [
  ["Matches chain", {}],
  ["Decimals differ from chain", { observedDecimals: 18 }],
  ["Not a token", { observedDecimals: null, observedSymbol: null, observedName: null }],
  ["Manual — check source", { chain: "polygon", verification: "manual", observedDecimals: null, observedAt: null, sourceUrl: "https://polygonscan.com/token/x" }],
] as const;

describe("deployment verification display", () => {
  it.each(EXPECT)("shows %s", async (text, over) => {
    editor(asset({ deployments: [deployment(over)] }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("shows entered and observed values and offers Re-verify on an on-chain draft only", async () => {
    editor(asset({ deployments: [deployment({ observedDecimals: 18 }), deployment({ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f20", status: "ACTIVE" })] }));
    expect(await screen.findByText(/Decimals entered 6, on chain 18 · USDC · USD Coin/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Re-verify" })).toHaveLength(1);
  });

  it("shows VERIFIER_UNAVAILABLE as retry copy", async () => {
    editor(asset(), { opsVerifyDeployment: vi.fn().mockRejectedValue(new ApiError("VERIFIER_UNAVAILABLE", 503, "down")) });
    await userEvent.click(await screen.findByRole("button", { name: "Re-verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wallet verification is temporarily unavailable. Try again.");
  });

  it("re-verify calls the API for that deployment", async () => {
    const client = editor(asset(), { opsVerifyDeployment: vi.fn().mockResolvedValue(asset()) });
    await userEvent.click(await screen.findByRole("button", { name: "Re-verify" }));
    expect(client.opsVerifyDeployment).toHaveBeenCalledWith(ASSET_ID, DEPLOYMENT_ID);
  });
});

describe("adding a deployment", () => {
  const fill = async () => {
    await userEvent.type(await screen.findByLabelText("Address"), "0xdAC17F958D2ee523a2206206994597C13D831ec7");
    await userEvent.type(screen.getByLabelText("Decimals"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Add deployment" }));
  };

  it("shows DEPLOYMENT_EXISTS inline", async () => {
    editor(asset({ deployments: [] }), { opsCreateDeployment: vi.fn().mockRejectedValue(new ApiError("DEPLOYMENT_EXISTS", 409, "This token is already registered.")) });
    await fill();
    expect(await screen.findByRole("alert")).toHaveTextContent("This token is already registered.");
  });

  it("sends the deployment", async () => {
    const client = editor(asset({ deployments: [] }), { opsCreateDeployment: vi.fn().mockResolvedValue(asset()) });
    await fill();
    expect(client.opsCreateDeployment).toHaveBeenCalledWith(ASSET_ID, { chain: "ethereum", tokenStandard: "erc20", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, sourceUrl: undefined });
  });

  it("requires a source URL on a chain that cannot be checked, and hides the address for native", async () => {
    const client = editor(asset({ deployments: [] }), { opsCreateDeployment: vi.fn() });
    await userEvent.selectOptions(await screen.findByLabelText("Chain"), "bitcoin");
    await userEvent.selectOptions(screen.getByLabelText("Standard"), "native");
    expect(screen.queryByLabelText("Address")).toBeNull();
    await userEvent.type(screen.getByLabelText("Decimals"), "8");
    expect(screen.getByLabelText(/Source URL \(required/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add deployment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a source URL");
    expect(client.opsCreateDeployment).not.toHaveBeenCalled();
  });
});

describe("read-only states", () => {
  it.each(["UNDER_REVIEW", "RETIRED"] as const)("disables editing while %s", async (status) => {
    editor(asset({ status }));
    expect((await screen.findAllByText(/read-only/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add deployment" })).toBeNull();
    expect(screen.getByRole("button", { name: "Re-verify" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save details" })).toBeNull();
  });

  it("locks symbol and type after approval", async () => {
    editor(asset({ status: "ACTIVE" }));
    expect((await screen.findAllByText("Locked after approval")).length).toBe(2);
    expect(screen.queryByLabelText("Symbol")).toBeNull();
  });

  it("item buttons are for ops_admin only", async () => {
    editor(asset(), {}, ["ops_reviewer"]);
    await screen.findByText("Matches chain");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("an admin approves a deployment after confirming", async () => {
    const client = editor(asset(), { opsAssetItemAction: vi.fn().mockResolvedValue(asset()) });
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(client.opsAssetItemAction).toHaveBeenCalledWith(ASSET_ID, "deployments", DEPLOYMENT_ID, "approve");
  });
});

describe("pricing", () => {
  const price = (over = {}) => ({ instrumentId: ASSET_ID, kind: "market" as const, status: "ok" as const, value: "1.0001", currency: "USD" as const, source: "coinmarketcap" as const, observedAt: "2026-09-30T00:00:00.000Z", stale: false, ...over });

  it("shows the price with a Stale badge", async () => {
    editor(asset({ prices: [price({ stale: true })] }));
    expect(await screen.findByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/1\.0001 USD/)).toBeInTheDocument();
  });

  it("shows Price unavailable and the page still renders", async () => {
    editor(asset({ prices: [price({ status: "unavailable", value: null, observedAt: null })] }));
    expect(await screen.findByText("Price unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /USD Coin/ })).toBeInTheDocument();
  });

  it("saves the CoinMarketCap id", async () => {
    const client = editor(asset(), { opsPutPriceReference: vi.fn().mockResolvedValue(asset()) });
    await userEvent.type(await screen.findByLabelText("CoinMarketCap id"), "3408");
    await userEvent.click(screen.getByRole("button", { name: "Save reference" }));
    expect(client.opsPutPriceReference).toHaveBeenCalledWith(ASSET_ID, "market", { externalId: "3408" });
  });
});

describe("access", () => {
  it("shows the access-lost state on 403", async () => {
    editor(asset(), { opsGetAsset: vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role may have been removed");
  });
});

describe("correcting a draft", () => {
  const PROVIDER_ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f11";
  const route = (status = "DRAFT") => ({
    id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f30", instrumentId: ASSET_ID, deploymentId: DEPLOYMENT_ID, providerId: PROVIDER_ID, venue: "Jupiter", method: "swap", processingModel: "sync",
    settlementInstrumentId: null, minimumAmount: null, notes: null, status, approvedByUserId: null, createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z",
  }) as unknown as OpsAssetDetail["routes"][number];

  it("a reviewer edits a draft deployment's decimals", async () => {
    const client = editor(asset(), { opsUpdateDeployment: vi.fn().mockResolvedValue(asset()) }, ["ops_reviewer"]);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const decimals = screen.getAllByLabelText("Decimals")[0]!; // the edit form renders above the add form
    await userEvent.clear(decimals);
    await userEvent.type(decimals, "18");
    await userEvent.click(screen.getByRole("button", { name: "Save deployment" }));
    expect(client.opsUpdateDeployment).toHaveBeenCalledWith(ASSET_ID, DEPLOYMENT_ID, { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 18, sourceUrl: null });
  });

  it("a reviewer edits a draft route's venue", async () => {
    const client = editor(asset({ routes: [route()] }), { opsUpdateRoute: vi.fn().mockResolvedValue(asset()) }, ["ops_reviewer"]);
    const edit = await screen.findAllByRole("button", { name: "Edit" });
    await userEvent.click(edit.at(-1)!);
    const venue = await screen.findByLabelText("Venue", { selector: "input[id$='-e-venue']" });
    await userEvent.clear(venue);
    await userEvent.type(venue, "Orca");
    await userEvent.click(screen.getByRole("button", { name: "Save route" }));
    expect(client.opsUpdateRoute).toHaveBeenCalledWith(ASSET_ID, route().id, { providerId: PROVIDER_ID, deploymentId: DEPLOYMENT_ID, venue: "Orca", minimumAmount: null });
  });

  it("offers no edit once approved, or while the asset is under review", async () => {
    editor(asset({ deployments: [deployment({ status: "ACTIVE" })], routes: [route("ACTIVE")] }));
    await screen.findByText("Matches chain");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers no edit while the asset is under review", async () => {
    editor(asset({ status: "UNDER_REVIEW", routes: [route()] }));
    await screen.findByText("Matches chain");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("saves instrument links from the details form", async () => {
    const client = editor(asset(), { opsUpdateAsset: vi.fn().mockResolvedValue(asset()) });
    await userEvent.type(await screen.findByLabelText(/^Links/), "Site | https://circle.com");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(client.opsUpdateAsset).toHaveBeenCalledWith(ASSET_ID, expect.objectContaining({ links: [{ label: "Site", url: "https://circle.com" }] }));
  });
});
