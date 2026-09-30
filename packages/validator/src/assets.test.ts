import { describe, expect, it } from "vitest";
import {
  ASSET_CHAINS, ASSET_ITEM_STATUSES, ASSET_ITEM_TRANSITIONS, INSTRUMENT_STATUSES, INSTRUMENT_TRANSITIONS, assetChainSchema, assetDecisionRequestSchema,
  createDeploymentRequestSchema, createInstrumentRequestSchema,
} from "./assets";
import { CHAINS, chainSchema } from "./chains";

describe("transition maps", () => {
  it("have an entry for every status and RETIRED is terminal", () => {
    expect(Object.keys(INSTRUMENT_TRANSITIONS).sort()).toEqual([...INSTRUMENT_STATUSES].sort());
    expect(Object.keys(ASSET_ITEM_TRANSITIONS).sort()).toEqual([...ASSET_ITEM_STATUSES].sort());
    expect(INSTRUMENT_TRANSITIONS.RETIRED).toEqual([]);
    expect(ASSET_ITEM_TRANSITIONS.RETIRED).toEqual([]);
  });
  it("UNDER_REVIEW cannot go straight to ACTIVE", () => {
    expect(INSTRUMENT_TRANSITIONS.UNDER_REVIEW).not.toContain("ACTIVE");
  });
});

describe("ASSET_CHAINS", () => {
  it("covers exactly the asset chains and every auth chain with the same family", () => {
    expect(Object.keys(ASSET_CHAINS).sort()).toEqual([...assetChainSchema.options].sort());
    for (const c of chainSchema.options) {
      expect(assetChainSchema.options).toContain(c);
      expect(ASSET_CHAINS[c].family).toBe(CHAINS[c].family);
    }
  });
});

describe("request schemas", () => {
  it("uppercases the symbol", () => {
    expect(createInstrumentRequestSchema.parse({ name: "Solana", symbol: " sol ", assetType: "CRYPTO" }).symbol).toBe("SOL");
  });
  it("changes_required needs a message", () => {
    expect(assetDecisionRequestSchema.safeParse({ decision: "changes_required" }).success).toBe(false);
    expect(assetDecisionRequestSchema.safeParse({ decision: "changes_required", message: "fix" }).success).toBe(true);
    expect(assetDecisionRequestSchema.safeParse({ decision: "approved" }).success).toBe(true);
  });
  it("native <=> no address, and bitcoin is native only", () => {
    const base = { chain: "ethereum", decimals: 18 };
    expect(createDeploymentRequestSchema.safeParse({ ...base, tokenStandard: "native" }).success).toBe(true);
    expect(createDeploymentRequestSchema.safeParse({ ...base, tokenStandard: "native", address: "0x1" }).success).toBe(false);
    expect(createDeploymentRequestSchema.safeParse({ ...base, tokenStandard: "erc20" }).success).toBe(false);
    expect(createDeploymentRequestSchema.safeParse({ chain: "bitcoin", decimals: 8, tokenStandard: "other", address: "bc1q" }).success).toBe(false);
    expect(createDeploymentRequestSchema.safeParse({ chain: "bitcoin", decimals: 8, tokenStandard: "native" }).success).toBe(true);
  });
});
