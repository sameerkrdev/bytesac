import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchQuotes } = await vi.importActual<typeof import("@/providers/coinmarketcap")>("@/providers/coinmarketcap");

afterEach(() => vi.unstubAllGlobals());
const cmc = (body: unknown, status = 200) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const entry = (price: number, last_updated = "2026-09-30T10:00:00.000Z") => ({ id: 1, name: "X", symbol: "X", quote: { USD: { price, last_updated } } });

describe("fetchQuotes", () => {
  it("batches ids into one v2 quotes/latest request with the API key header", async () => {
    const fetchMock = cmc({ status: { error_code: 0 }, data: { "1": entry(60000.5), "1027": entry(2500) } });
    const quotes = await fetchQuotes(["1", "1027"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=1,1027&convert=USD&skip_invalid=true");
    expect(init.headers).toMatchObject({ "X-CMC_PRO_API_KEY": expect.any(String), Accept: "application/json" });
    expect(quotes).toEqual(new Map([["1", { value: "60000.5", observedAt: "2026-09-30T10:00:00.000Z" }], ["1027", { value: "2500", observedAt: "2026-09-30T10:00:00.000Z" }]]));
  });

  it("accepts an array per id and never emits exponent notation", async () => {
    cmc({ data: { "5": [entry(0.0000001234)] } });
    expect((await fetchQuotes(["5"])).get("5")!.value).toBe("0.0000001234");
  });

  it("ids missing from the response are missing from the map", async () => {
    cmc({ data: { "1": entry(1) } });
    expect([...(await fetchQuotes(["1", "2"])).keys()]).toEqual(["1"]);
  });

  it("an entry with a null, negative or non-numeric price only drops that id", async () => {
    cmc({ data: { "1": entry(1), "2": entry(null as unknown as number), "3": entry("x" as unknown as number), "4": entry(-5), "5": entry(1, "yesterday") } });
    expect([...(await fetchQuotes(["1", "2", "3", "4", "5"])).keys()]).toEqual(["1"]);
  });

  it("HTTP errors, malformed bodies and bad prices throw", async () => {
    cmc({ status: { error_code: 1001 } }, 401);
    await expect(fetchQuotes(["1"])).rejects.toThrow();
    cmc({ data: "nope" });
    await expect(fetchQuotes(["1"])).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(fetchQuotes(["1"])).rejects.toThrow();
  });
});
