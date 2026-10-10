/** Fetch CMC UCID from currency pages. Usage: node scripts/fetch-cmc-ucids.mjs */
const PAGES = [
  ["NVDAON", "nvidia-tokenized-stock-ondo"],
  ["NVDAX", "nvidia-tokenized-stock-xstock"],
  ["AAPLON", "apple-tokenized-stock-ondo"],
  ["AAPLX", "apple-tokenized-stock-xstock"],
  ["TSLAON", "tesla-tokenized-stock-ondo"],
  ["TSLAX", "tesla-tokenized-stock-xstock"],
  ["MSFTON", "microsoft-tokenized-stock-ondo"],
  ["MSFTX", "microsoft-tokenized-stock-xstock"],
  ["GOOGLON", "alphabet-class-a-tokenized-stock-ondo"],
  ["GOOGLX", "alphabet-tokenized-stock-xstock"],
  ["METAON", "meta-platforms-tokenized-stock-ondo"],
  ["METAX", "meta-tokenized-stock-xstock"],
  ["AMZNON", "amazon-tokenized-stock-ondo"],
  ["AMZNX", "amazon-tokenized-stock-xstock"],
  ["SPYON", "spdr-sp-500-etf-tokenized-stock-ondo"],
  ["SPYX", "sp500-tokenized-stock-xstock"],
  ["QQQON", "invesco-qqq-tokenized-stock-ondo"],
  ["QQQX", "nasdaq-tokenized-stock-xstock"],
  ["AVGOON", "broadcom-tokenized-stock-ondo"],
  ["AVGOX", "broadcom-tokenized-stock-xstock"],
  ["AMDON", "amd-tokenized-stock-ondo"],
  ["PLTRON", "palantir-tokenized-stock-ondo"],
  ["PLTRX", "palantir-tokenized-stock-xstock"],
  ["HOODON", "robinhood-markets-tokenized-stock-ondo"],
  ["CRCLON", "circle-internet-group-tokenized-stock-ondo"],
  ["MSTRON", "microstrategy-tokenized-stock-ondo"],
  ["NFLXX", "netflix-tokenized-stock-xstock"],
  ["LLYX", "eli-lilly-tokenized-stock-xstock"],
  ["BRK.BX", "berkshire-hathaway-tokenized-stock-xstock"],
  ["COINX", "coinbase-tokenized-stock-xstock"],
];

const out = {};
for (const [sym, slug] of PAGES) {
  const url = `https://coinmarketcap.com/currencies/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BytesacCmcLookup/1.0)" },
    });
    const html = await res.text();
    const ucid =
      html.match(/UCID[\s\S]{0,80}?(\d{4,6})/i)?.[1] ||
      html.match(/"id":(\d{4,6}),"name":/)?.[1] ||
      html.match(/coinId\\?":\s*(\d{4,6})/)?.[1];
    out[sym] = ucid ?? null;
    console.log(sym.padEnd(10), ucid ?? `FAIL ${res.status}`, slug);
  } catch (e) {
    out[sym] = null;
    console.log(sym.padEnd(10), "ERR", e.message);
  }
}
console.log(JSON.stringify(out, null, 2));
