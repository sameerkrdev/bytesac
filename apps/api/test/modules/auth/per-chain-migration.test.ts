import { describe, expect, it } from "vitest";
import { adminSql } from "../../helpers/db";

describe("per-chain migration", () => {
  it("has one active row per wallet and chain, and accepts polygon", async () => {
    const idx = await adminSql`select indexdef from pg_indexes where indexname = 'wallet_addresses_active_chain_key'`;
    expect(idx[0]?.indexdef).toContain("WHERE (status = 'active'");
    const enumVals = await adminSql`select unnest(enum_range(null::app.chain))::text as v`;
    expect(enumVals.map((r) => r.v)).toContain("polygon");
  });
});
