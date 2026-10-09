import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { addressOn } from "@/modules/auth/wallets.service";
import { seedPlatformWallets } from "@/modules/operations/gas.service";
import { adminSql, resetDb } from "../../helpers/db";
import { balanceKey, mockChains, solanaTestWallet } from "../../helpers/chain-mocks";
import { USDC_MINT, seedBasket, seedUser, type SeedAsset } from "../../helpers/execution";

describe("addressOn per chain (D-120)", () => {
  const a = { solana: "So1", base: "0xaaa", arbitrum: "0xccc" };
  it("reads the chain's own address", () => {
    expect(addressOn(a, "base")).toBe("0xaaa");
    expect(addressOn(a, "arbitrum")).toBe("0xccc");
  });
  it("a chain without an address is CHAIN_NOT_LINKED, Bitcoin is BTC_ADDRESS_REQUIRED", () => {
    expect(() => addressOn(a, "bnb")).toThrow(expect.objectContaining({ code: "CHAIN_NOT_LINKED", status: 409 }));
    expect(() => addressOn(a, "bitcoin")).toThrow(expect.objectContaining({ code: "BTC_ADDRESS_REQUIRED" }));
  });
});

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const BASE: SeedAsset = { symbol: "BASEX", chain: "base", tokenStandard: "native", bps: 3000 };
const ARB: SeedAsset = { symbol: "ARBX", chain: "arbitrum", tokenStandard: "native", bps: 2000 };
const invest = (h: Record<string, string>, basketId: string) => request(app).post("/v1/operations/invest").set(h).send({ basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa" });

async function arrange(evmByChain: Record<string, string>) {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets: [SOL, BASE, ARB] });
  const user = await seedUser({ wallet: solanaTestWallet(), evmByChain });
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
  return { chain, basket, user };
}

describe("execution uses each chain's own address (D-120)", () => {
  beforeEach(resetDb);
  const own = { base: "0x" + "a".repeat(40), arbitrum: "0x" + "c".repeat(40) };

  it("quotes deliver to the Base and Arbitrum addresses respectively", async () => {
    const { chain, basket, user } = await arrange(own);
    expect((await invest(user.h, basket.basketId)).status).toBe(201);
    const to = (c: string) => chain.quotes.find((q) => q.toChain === c)?.toAddress;
    expect(to("base")).toBe(own.base);
    expect(to("arbitrum")).toBe(own.arbitrum);
  });

  it("after the Base address changes, the plan delivers to the new one", async () => {
    const { chain, basket, user } = await arrange(own);
    const next = "0x" + "d".repeat(40);
    await adminSql`UPDATE app.wallet_addresses SET address = ${next} WHERE chain = 'base' AND address = ${own.base}`;
    expect((await invest(user.h, basket.basketId)).status).toBe(201);
    expect(chain.quotes.find((q) => q.toChain === "base")?.toAddress).toBe(next);
  });

  it("investability: Arbitrum asset without an Arbitrum link is CHAIN_NOT_LINKED and requiredChains lists it", async () => {
    const { basket, user } = await arrange({ base: own.base });
    const res = await request(app).get(`/v1/baskets/${basket.slug}/investability`).set(user.h);
    expect(res.body.requiredChains).toEqual(["solana", "base", "arbitrum"]);
    expect(res.body.eligibility.reasons.map((r: { code: string }) => r.code)).toEqual(["CHAIN_NOT_LINKED"]);
    expect((await invest(user.h, basket.basketId)).body.error.code).toBe("CHAIN_NOT_LINKED");
  });
});
