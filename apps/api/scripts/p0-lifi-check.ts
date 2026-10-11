/**
 * Spec 22 P0, read-only: never signs or sends. Asks LI.FI (real key) for user-fee-payer Solana quotes, direct routes and parallel estimates,
 * then prints what came back. Exits 0 even when a check fails (each failure is printed).
 *
 *   pnpm --filter api exec tsx --env-file-if-exists=.env scripts/p0-lifi-check.ts <solanaAddress> <evmAddress>
 *
 * `lifi.quote` refuses a Solana source without `svmSponsor`, so the user-fee-payer quote goes straight through `lifiCall("/quote")` with the same parameters minus `svmSponsor`.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { VersionedTransaction } from "@solana/web3.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, instrumentDeployments, instruments } from "@repo/db";
import { USDC_SOLANA_MINT } from "@repo/validator";
import { env } from "@/config/dotenv";
import { connection } from "@/providers/solana-tx";
import { CHAIN_IDS, lifi, lifiCall } from "@/providers/routes/lifi";
import type { LegEstimateInput } from "@/providers/routes/types";

const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
/** Documented example address: estimates need a well-formed destination, nothing is ever sent to it. */
const BTC_PLACEHOLDER = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SLIPPAGE_BPS = 100;

const [solana, evm] = process.argv.slice(2);
if (!solana || !evm) {
  console.log("Usage: p0-lifi-check.ts <solanaAddress> <evmAddress>");
  process.exit(0);
}
if (!env.LIFI_API_KEY) {
  console.log("LIFI_API_KEY is empty: set it in apps/api/.env.");
  process.exit(0);
}

const fail = (label: string, err: unknown) => {
  const e = err as { code?: string; lifiCode?: number; message?: string };
  console.log(`  ${label}: FAILED ${e.code ?? ""}${e.lifiCode ? ` (LI.FI ${e.lifiCode})` : ""} ${e.message ?? String(err)}`);
};

/** Quote with the user as fee payer (no svmSponsor), decode the transaction and print its shape. Returns the blockhash and when it was received. */
async function userFeePayerQuote(label: string, toChain: "solana" | "ethereum", toToken: string, toAddress: string) {
  console.log(`\n[${label}] USDC (Solana) -> ${toChain} ${toToken}, 1 USDC, fromAddress = your Solana address, no svmSponsor`);
  try {
    const q = await lifiCall("/quote", { params: {
      fromChain: CHAIN_IDS.solana, toChain: CHAIN_IDS[toChain], fromToken: USDC_SOLANA_MINT, toToken, fromAmount: "1000000",
      fromAddress: solana!, toAddress, slippage: SLIPPAGE_BPS / 10_000, integrator: env.LIFI_INTEGRATOR, maxPriceImpact: 0.05, // as production
    } }) as { tool?: string; transactionRequest?: { data?: string } };
    const receivedAt = Date.now();
    const data = q.transactionRequest?.data;
    if (!data) throw new Error("the quote has no transactionRequest.data");
    const tx = VersionedTransaction.deserialize(Buffer.from(data, "base64"));
    const m = tx.message;
    const budget = m.compiledInstructions.filter((ix) => m.staticAccountKeys[ix.programIdIndex]!.toBase58() === COMPUTE_BUDGET).map((ix) => Buffer.from(ix.data));
    console.log(`  tool: ${q.tool}`);
    console.log(`  fee payer is fromAddress: ${m.staticAccountKeys[0]!.toBase58() === solana}`);
    console.log(`  numRequiredSignatures: ${m.header.numRequiredSignatures}; serialized length: ${tx.serialize().length} bytes`);
    console.log(`  pre-signed by LI.FI (a signature slot other than 0 is filled): ${tx.signatures.slice(1).some((s) => s.some((b) => b !== 0))}`);
    console.log(`  ComputeBudget limit: ${budget.find((d) => d[0] === 2)?.readUInt32LE(1) ?? "none"}; price (micro-lamports): ${budget.find((d) => d[0] === 3)?.readBigUInt64LE(1) ?? "none"}`);
    console.log(`  recentBlockhash: ${m.recentBlockhash}`);
    return { label, blockhash: m.recentBlockhash, receivedAt };
  } catch (err) {
    fail(label, err);
    if ((err as { code?: string }).code === "SOL_REQUIRED") console.log("  (1002 SOL_REQUIRED: the wallet needs SOL; continuing)");
    return null;
  }
}

/** isBlockhashValid returns only a boolean, so the lifetime is measured by polling every 2 s (at most 120 s). */
async function blockhashLifetime(q: { label: string; blockhash: string; receivedAt: number }) {
  while (Date.now() - q.receivedAt <= 120_000) {
    const valid = await connection.isBlockhashValid(q.blockhash, { commitment: "confirmed" }).then((r) => r.value, () => true);
    if (!valid) return console.log(`  [${q.label}] blockhash invalid after ${((Date.now() - q.receivedAt) / 1000).toFixed(1)} s`);
    await sleep(2000);
  }
  console.log(`  [${q.label}] blockhash still valid after 120 s`);
}

async function directRoute(label: string, i: LegEstimateInput) {
  try {
    const e = await lifi.estimate(i);
    console.log(`  ${label}: found; tool ${e.toolSummary}; toAmountMin ${e.minOut}`);
  } catch (err) {
    fail(`${label}: not found`, err);
  }
}

async function main() {
  const quotes = [
    await userFeePayerQuote("swap", "solana", JUP_MINT, solana!),
    await userFeePayerQuote("cross-chain", "ethereum", "0x0000000000000000000000000000000000000000", evm!),
  ].filter((q) => q !== null);
  console.log("\nBlockhash lifetime after the quote (polling every 2 s, at most 120 s):");
  await Promise.all(quotes.map(blockhashLifetime));

  console.log("\nDirect routes (estimates, no balance needed):");
  const [erc20] = await db.select({ address: instrumentDeployments.address, decimals: instrumentDeployments.decimals, symbol: instruments.symbol }).from(instrumentDeployments)
    .innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(and(eq(instrumentDeployments.chain, "ethereum"), eq(instrumentDeployments.tokenStandard, "erc20"), eq(instrumentDeployments.status, "ACTIVE")))
    .orderBy(instrumentDeployments.createdAt).limit(1);
  if (erc20) await directRoute(`Ethereum ${erc20.symbol} -> JUP (Solana)`, { fromChain: "ethereum", fromToken: erc20.address, toChain: "solana", toToken: JUP_MINT, fromAmount: 10n ** BigInt(erc20.decimals), toAddress: solana!, slippageBps: SLIPPAGE_BPS, toDecimals: 6 });
  else console.log("  no ACTIVE Ethereum ERC-20 deployment in the registry: skipped");
  await directRoute("JUP (Solana) -> BTC", { fromChain: "solana", fromToken: JUP_MINT, toChain: "bitcoin", toToken: null, fromAmount: 100_000_000n, toAddress: BTC_PLACEHOLDER, slippageBps: SLIPPAGE_BPS, toDecimals: 8 });

  const targets = await db.select({ address: instrumentDeployments.address, decimals: instrumentDeployments.decimals }).from(instrumentDeployments)
    .where(and(eq(instrumentDeployments.chain, "solana"), eq(instrumentDeployments.status, "ACTIVE"), isNotNull(instrumentDeployments.address)))
    .orderBy(instrumentDeployments.createdAt).limit(12);
  console.log(`\nParallel quoting: ${targets.length} simultaneous estimates from USDC (Solana):`);
  const started = Date.now();
  const settled = await Promise.allSettled(targets.map((t) => lifi.estimate({ fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: "solana", toToken: t.address, fromAmount: 1_000_000n, toAddress: solana!, slippageBps: SLIPPAGE_BPS, toDecimals: t.decimals })));
  const rejected = settled.flatMap((s) => (s.status === "rejected" ? [s.reason as { code?: string; lifiCode?: number; message?: string }] : []));
  // lifiCall maps every non-OK body to an error carrying only `lifiCode`; the HTTP status is in the message ("LI.FI responded 429").
  console.log(`  wall time ${Date.now() - started} ms; ok ${settled.length - rejected.length}/${settled.length}; HTTP 429: ${rejected.filter((r) => /\b429\b/.test(r.message ?? "")).length}`);
  for (const r of rejected) console.log(`  failed: ${r.code ?? ""} ${r.message ?? ""}`);
}

main()
  .catch((err) => fail("script", err))
  // The imported Redis and Postgres clients keep the process alive.
  .finally(() => process.exit(0));
