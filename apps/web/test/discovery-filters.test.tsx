import { decodeDiscoveryFilters, encodeDiscoveryFilters } from "@repo/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchItem, withQuery } from "./discovery-fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import PublicBasketsPage from "@/app/baskets/page";

afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });
const serve = (body: unknown) => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const page = async (searchParams: { f?: string; cursor?: string } = {}) => withQuery(await PublicBasketsPage({ searchParams: Promise.resolve(searchParams) }));
const pushed = () => decodeDiscoveryFilters(new URL(push.mock.calls.at(-1)![0], "http://x").searchParams.get("f") ?? undefined);

describe("Discovery page", () => {
  it("shows cards: 1 y net or New, minimum, fee, top 3 assets and the status badge", async () => {
    serve({ items: [searchItem(), searchItem({ slug: "fresh", name: "Fresh", netReturn1y: null, available: false, status: "PAUSED" })], nextCursor: null });
    await page();
    expect(screen.getByRole("link", { name: "Core Crypto" })).toHaveAttribute("href", "/baskets/core-crypto");
    expect(screen.getAllByText("SOL 40% · ETH 30% · BTC 20%")).toHaveLength(2);
    expect(screen.getByText("+12.34%")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getAllByText("100 USDC")).toHaveLength(2);
    expect(screen.getAllByText("0.5%")).toHaveLength(2);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("sends the filters from the URL to the API and keeps them in Load more", async () => {
    const f = encodeDiscoveryFilters({ categories: ["index"], maxSingleWeightBps: 3000 });
    const fetchMock = serve({ items: [searchItem()], nextCursor: "abc" });
    await page({ f });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v1/public/discovery/baskets");
    expect(decodeDiscoveryFilters(url.searchParams.get("f") ?? undefined)).toEqual({ categories: ["index"], maxSingleWeightBps: 3000 });
    const more = screen.getByRole("link", { name: "Load more" }).getAttribute("href")!;
    expect(new URLSearchParams(more.split("?")[1]).get("cursor")).toBe("abc");
    expect(decodeDiscoveryFilters(new URLSearchParams(more.split("?")[1]).get("f") ?? undefined)).toEqual({ categories: ["index"], maxSingleWeightBps: 3000 });
  });

  it("ignores an invalid f param", async () => {
    const fetchMock = serve({ items: [], nextCursor: null });
    await page({ f: encodeDiscoveryFilters({ categories: ["bogus"] } as never) });
    expect(decodeDiscoveryFilters(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get("f") ?? undefined)).toEqual({});
    expect(screen.getByRole("status")).toHaveTextContent("No baskets match");
    await page({ f: "%%%not-base64" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("applies the filter form to the URL (percent inputs become bps and fractions) and round-trips back into the form", async () => {
    serve({ items: [], nextCursor: null });
    await page();
    await userEvent.click(screen.getByLabelText("Index"));
    await userEvent.click(screen.getByRole("button", { name: "Add to assets" }));
    await userEvent.type(screen.getByLabelText("Assets 1 symbol"), "sol");
    await userEvent.type(screen.getByLabelText("Assets 1 minimum %"), "10");
    await userEvent.type(screen.getByLabelText("Assets 1 maximum %"), "50");
    await userEvent.type(screen.getByLabelText("Largest single asset (max %)"), "35");
    await userEvent.type(screen.getByLabelText("Management fee"), "1.5");
    await userEvent.type(screen.getByLabelText("Minimum 1 y net return (%)"), "12");
    await userEvent.type(screen.getByLabelText("Tags (comma separated)"), "layer-1, defi");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    const filters = pushed();
    expect(filters).toEqual({
      categories: ["index"], assets: [{ symbol: "SOL", minBps: 1000, maxBps: 5000 }], maxSingleWeightBps: 3500, maxFeeBps: { management: 150 },
      performance: { minNetReturn1y: "0.120000" }, tags: ["layer-1", "defi"],
    });

    serve({ items: [], nextCursor: null });
    await page({ f: encodeDiscoveryFilters(filters) });
    expect(screen.getAllByLabelText("Assets 1 minimum %").at(-1)).toHaveValue(10);
    expect(screen.getAllByLabelText("Minimum 1 y net return (%)").at(-1)).toHaveValue(12);
  });

  it("does not push invalid numbers", async () => {
    serve({ items: [], nextCursor: null });
    await page();
    await userEvent.type(screen.getByLabelText("Tags (comma separated)"), "Not A Tag!");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Check the filters");
  });

  it("changing the sort pushes a new f, and the panel collapses at phone width", async () => {
    serve({ items: [], nextCursor: null });
    await page({ f: encodeDiscoveryFilters({ categories: ["index"] }) });
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "return_1y");
    expect(pushed()).toEqual({ categories: ["index"], sort: "return_1y" });
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
