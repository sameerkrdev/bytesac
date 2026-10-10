/**
 * In-place UPDATE of ACTIVE market price_references.external_id for seeded RWAs.
 * Does not delete or recreate rows.
 * Usage: pnpm --filter api ops:patch-rwa-cmc-ids
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, instruments, priceReferences } from "@repo/db";

/** CoinMarketCap UCIDs (numeric). Includes legacy BRKBX from older seeds. */
const CMC_BY_SYMBOL: Record<string, string> = {
  NVDAON: "38093",
  TSLAON: "38029",
  AAPLON: "38037",
  MSFTON: "38086",
  GOOGLON: "38001",
  METAON: "38065",
  AMZNON: "38083",
  SPYON: "38067",
  QQQON: "38094",
  AVGOON: "38062",
  AMDON: "38027",
  PLTRON: "38073",
  HOODON: "38004",
  CRCLON: "38056",
  MSTRON: "38092",
  NVDAX: "36992",
  TSLAX: "37004",
  AAPLX: "36994",
  MSFTX: "37056",
  GOOGLX: "37013",
  METAX: "37055",
  AMZNX: "37014",
  SPYX: "37006",
  QQQX: "37057",
  AVGOX: "37021",
  PLTRX: "37062",
  NFLXX: "37060",
  LLYX: "37038",
  "BRK.BX": "37020",
  BRKBX: "37020",
  COINX: "36989",
};

async function main(): Promise<void> {
  const symbols = Object.keys(CMC_BY_SYMBOL);
  const rows = await db
    .select({
      priceId: priceReferences.id,
      symbol: instruments.symbol,
      externalId: priceReferences.externalId,
    })
    .from(priceReferences)
    .innerJoin(instruments, eq(instruments.id, priceReferences.instrumentId))
    .where(and(
      eq(priceReferences.kind, "market"),
      eq(priceReferences.status, "ACTIVE"),
      eq(priceReferences.provider, "coinmarketcap"),
      inArray(instruments.symbol, symbols),
    ));

  let updated = 0;
  let already = 0;
  let missing = 0;

  for (const symbol of symbols) {
    const row = rows.find((r) => r.symbol === symbol);
    const want = CMC_BY_SYMBOL[symbol]!;
    if (!row) {
      missing += 1;
      console.log(`miss  ${symbol} (no ACTIVE market price_reference)`);
      continue;
    }
    if (row.externalId === want) {
      already += 1;
      console.log(`ok    ${symbol} already ${want}`);
      continue;
    }
    await db.update(priceReferences)
      .set({ externalId: want, updatedAt: sql`now()` })
      .where(eq(priceReferences.id, row.priceId));
    updated += 1;
    console.log(`upd   ${symbol} ${row.externalId ?? "null"} → ${want}`);
  }

  console.log(`done updated=${updated} already=${already} missing=${missing}`);
}

try {
  await main();
} finally {
  await db.$client.end({ timeout: 5 });
}
