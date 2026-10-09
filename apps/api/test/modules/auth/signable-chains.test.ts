import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { walletAddresses } from "@repo/db";
import type { Chain } from "@repo/validator";
import { app } from "@/app";
import { challengeFor, signIn, webHeaders, type TestWallet } from "../../helpers/auth";
import { resetDb, testDb } from "../../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

/** D-119: the client reports the chains its wallet approved; stored per address row, used only for warnings. */
async function verify(wallet: TestWallet, chain: Chain, extra: Record<string, unknown>, opts: { purpose?: "sign_in" | "add_chain_account"; cookie?: string } = {}) {
  const headers = webHeaders(opts.cookie);
  const ch = await challengeFor(app, { purpose: opts.purpose ?? "sign_in", chain, address: wallet.address }, headers);
  return request(app).post("/v1/auth/verify").set(headers)
    .send({ challengeId: ch.body.challengeId, signature: await wallet.sign(ch.body.message), client: "web", ...extra });
}
const cookieOf = (res: request.Response) =>
  (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="))!;
const rowsOf = async () => (await db.select().from(walletAddresses)).map((r) => ({ chain: r.chain, signable: r.signableChains }));

describe("signable chains (D-119)", () => {
  it("sign-in stores the reported chains of the signed family on every registered row and exposes them on /me", async () => {
    const res = await verify(newEvmWallet(), "base", { signableChains: ["ethereum", "base", "polygon", "solana"] });
    expect(res.status).toBe(200);
    for (const r of await rowsOf()) expect(r.signable).toEqual(["ethereum", "base", "polygon"]);
    const me = await request(app).get("/v1/me").set("Cookie", cookieOf(res));
    expect(me.body.wallet.addresses[0].signableChains).toEqual(["ethereum", "base", "polygon"]);
  });

  it("omitted means unknown: stored as null on sign-up, and a later report refreshes it", async () => {
    const w = newEvmWallet();
    await verify(w, "base", {});
    for (const r of await rowsOf()) expect(r.signable).toBeNull();
    await verify(w, "ethereum", { signableChains: ["ethereum", "arbitrum"] });
    for (const r of await rowsOf()) expect(r.signable).toEqual(["ethereum", "arbitrum"]);
    await verify(w, "ethereum", {});
    for (const r of await rowsOf()) expect(r.signable).toEqual(["ethereum", "arbitrum"]);
  });

  it("add chain account stores the list on the added family only", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await verify(newSolanaWallet(), "solana", { signableChains: ["solana", "ethereum"] }, { purpose: "add_chain_account", cookie: s.cookie });
    expect(res.status).toBe(200);
    const rows = await rowsOf();
    expect(rows.find((r) => r.chain === "solana")!.signable).toEqual(["solana"]);
    expect(rows.filter((r) => r.chain !== "solana").every((r) => r.signable === null)).toBe(true);
  });

  it("an unknown chain value is a 400", async () => {
    const res = await verify(newEvmWallet(), "base", { signableChains: ["ethereum", "moonbeam"] });
    expect(res.status).toBe(400);
  });
});
