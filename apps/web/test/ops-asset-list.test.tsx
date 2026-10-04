import { ApiError } from "@repo/api-client";
import type { OpsAssetSummary } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }), useSearchParams: () => new URLSearchParams(search) }));
import { CreateAssetForm } from "@/components/ops/assets/asset-form";
import { AssetsTable } from "@/components/ops/assets/assets-table";
import { ASSET_ID, T, asset, lookups } from "./asset-fixtures";

const row = (over: Partial<OpsAssetSummary> = {}): OpsAssetSummary => ({ id: ASSET_ID, name: "USD Coin", symbol: "USDC", assetType: "STABLECOIN", status: "ACTIVE", chains: ["solana", "ethereum"], updatedAt: T, logoUrl: null, ...over });
const table = (opsListAssets: ReturnType<typeof vi.fn>) => render(<QueryClientProvider client={new QueryClient()}><AssetsTable client={{ opsListAssets } as never} /></QueryClientProvider>);

beforeEach(() => { search = ""; replace.mockReset(); push.mockReset(); });

describe("Ops assets list", () => {
  it("renders rows with type, chains and status text, linking to the editor", async () => {
    table(vi.fn().mockResolvedValue({ items: [row()], nextCursor: null }));
    expect((await screen.findAllByRole("link", { name: /USD Coin/ }))[0]).toHaveAttribute("href", `/ops/assets/${ASSET_ID}`);
    expect(screen.getAllByText("Stablecoin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Solana, Ethereum").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "New asset" })).toHaveAttribute("href", "/ops/assets/new");
  });

  it("reads filters from the URL and sends them to the API", async () => {
    search = "status=PAUSED&chain=base&q=usd";
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    table(list);
    expect(await screen.findByText("No assets found.")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ status: "PAUSED", chain: "base", q: "usd", cursor: undefined });
  });

  it("changing a filter updates the URL", async () => {
    search = "chain=base";
    table(vi.fn().mockResolvedValue({ items: [], nextCursor: null }));
    await userEvent.selectOptions(await screen.findByLabelText("Status"), "ACTIVE");
    expect(replace).toHaveBeenCalledWith("/ops/assets?chain=base&status=ACTIVE");
  });

  it("a revoked role shows the access-lost message", async () => {
    table(vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role may have been removed");
  });
});

describe("CreateAssetForm (stepped)", () => {
  const next = () => userEvent.click(screen.getByRole("button", { name: /Continue/ }));
  const form = (opsCreateAsset = vi.fn().mockResolvedValue(asset()), extra: Record<string, unknown> = {}) => {
    render(<QueryClientProvider client={new QueryClient()}><CreateAssetForm client={{ ...lookups(), opsCreateAsset, ...extra }} /></QueryClientProvider>);
    return opsCreateAsset;
  };

  it("requires a symbol before leaving the first step", async () => {
    const create = form();
    await userEvent.type(screen.getByLabelText("Name"), "USD Coin");
    await next();
    expect(screen.getByLabelText("Symbol")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/symbol of up to 20/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("uppercases the symbol, creates on the last step and opens the editor", async () => {
    const create = form();
    await userEvent.type(screen.getByLabelText("Name"), "USD Coin");
    await userEvent.type(screen.getByLabelText("Symbol"), "usdc");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "STABLECOIN");
    await next(); await next(); await next();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create asset" }));
    expect(create).toHaveBeenCalledWith({ name: "USD Coin", symbol: "USDC", assetType: "STABLECOIN", issuerId: null, description: undefined });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/ops/assets/${ASSET_ID}`));
  });

  it("uploads a chosen logo right after creating", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const presign = vi.fn().mockResolvedValue({ fileId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f99", uploadUrl: "https://r2.test/up", headers: { "Content-Type": "image/png" } });
    const confirm = vi.fn().mockResolvedValue(asset());
    const create = form(undefined, { opsPresignAssetLogo: presign, opsConfirmAssetLogo: confirm, opsRemoveAssetLogo: vi.fn() });
    await userEvent.type(screen.getByLabelText("Name"), "USD Coin");
    await userEvent.type(screen.getByLabelText("Symbol"), "usdc");
    await next(); await next();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "usdc.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Choose a logo image"), png);
    expect(screen.getByText("usdc.png")).toBeInTheDocument();
    await next();
    await userEvent.click(screen.getByRole("button", { name: "Create asset" }));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(ASSET_ID, "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f99"));
    expect(create).toHaveBeenCalled();
    expect(presign).toHaveBeenCalledWith(ASSET_ID, { contentType: "image/png", sizeBytes: 4 });
    expect(fetchMock).toHaveBeenCalledWith("https://r2.test/up", expect.objectContaining({ method: "PUT" }));
    vi.unstubAllGlobals();
  });

  it("rejects an SVG logo", async () => {
    form();
    await userEvent.type(screen.getByLabelText("Name"), "USD Coin");
    await userEvent.type(screen.getByLabelText("Symbol"), "usdc");
    await next(); await next();
    await userEvent.upload(screen.getByLabelText("Choose a logo image"), new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), { applyAccept: false });
    expect(screen.getByRole("alert")).toHaveTextContent("SVG isn't accepted");
  });

  it("creates an issuer inline and selects it", async () => {
    const created = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f12", name: "Ondo" };
    const client = { ...lookups(), opsCreateAssetIssuer: vi.fn().mockResolvedValue(created), opsCreateAsset: vi.fn() };
    client.opsListAssetIssuers.mockResolvedValueOnce([]).mockResolvedValue([created]);
    render(<QueryClientProvider client={new QueryClient()}><CreateAssetForm client={client} /></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText("Name"), "Ondo Fund");
    await userEvent.type(screen.getByLabelText("Symbol"), "ousg");
    await next();
    await userEvent.click(screen.getByRole("button", { name: "New issuer" }));
    await userEvent.type(screen.getByLabelText("Issuer name"), "Ondo");
    await userEvent.click(screen.getByRole("button", { name: "Create issuer" }));
    expect(client.opsCreateAssetIssuer).toHaveBeenCalledWith({ name: "Ondo" });
    expect(await screen.findByRole("option", { name: "Ondo" })).toBeInTheDocument();
  });
});
