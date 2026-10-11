import request from "supertest";
import bs58 from "bs58";
import { expect, vi } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { app } from "@/app";
import { connection } from "@/providers/solana-tx";
import { adminSql } from "./db";
import { balanceKey, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, chargeEntryFee, seedBasket, seedUser, type SeedAsset } from "./execution";

// Shared by the signing-group and Continue tests: a planned Solana-only basket investment, its group, and a wallet that signs it.

export type H = Record<string, string>;
export type Wallet = ReturnType<typeof solanaTestWallet>;
export interface Tx { legId: string; kind: "fee" | "asset"; serializedBase64: string }
export interface LegRow { id: string; sequence: number; kind: string; status: string; amount_in: string; min_out: string | null; source_tx: string | null; built_message_hash: string | null; group_id: string | null; last_error: string | null; fee_covered_by: string | null; fee_share: Record<string, string> | null; retry_of: string | null; to_deployment_id: string | null; failure_reason: string | null; route_summary: { feeCharges?: Record<string, string>; covers?: string[] } | null; expected_tx: { preparedBase64?: string } | null }

export const spl = (n: number, bps: number): SeedAsset => ({ symbol: `T${n}`, chain: "solana", tokenStandard: "spl", bps });
export const sends = () => vi.mocked(connection.sendRawTransaction).mock.calls;
export const sentSignatures = () => sends().map(([raw]) => bs58.encode(VersionedTransaction.deserialize(raw as Uint8Array).signatures[0]!));
export const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
export const invest = (h: H, basketId: string) => post(h, "/v1/operations/invest", { basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa", tier: "sign_all" });
export const groupReq = (h: H, opId: string, over: object = {}) => post(h, `/v1/operations/${opId}/groups`, { chain: "solana", tier: "sign_all", walletName: "TestWallet", idempotencyKey: "grp-aaaaaaaa", ...over });
export const submit = (h: H, opId: string, groupId: string, signed: object[]) => post(h, `/v1/operations/${opId}/groups/${groupId}/submit`, { signed });
export const legs = (opId: string) => adminSql<LegRow[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;
export const groupRows = (opId: string) => adminSql<{ id: string; status: string; fee_leg_id: string | null; send_by: Date; quote_block_height: string; wallet_name: string; tier: string }[]>`SELECT * FROM app.operation_groups WHERE operation_id = ${opId} ORDER BY created_at`;
export const opRow = async (id: string) => (await adminSql<{ status: string; needs_action_since: Date | null }[]>`SELECT * FROM app.operations WHERE id = ${id}`)[0]!;

export const walletSign = (serializedBase64: string, wallet: Wallet) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64"));
  tx.sign([wallet.keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
};
export const signAll = (txs: Tx[], wallet: Wallet) => txs.map((t) => ({ legId: t.legId, signedTx: walletSign(t.serializedBase64, wallet) }));
export async function arrange(over: { legs?: number } = {}) {
  const chain = mockChains();
  const wallet = solanaTestWallet();
  const n = over.legs ?? 4;
  const bps = Math.floor(10_000 / n);
  const basket = await seedBasket({ assets: Array.from({ length: n }, (_, i) => spl(i, i === n - 1 ? 10_000 - bps * (n - 1) : bps)) });
  await chargeEntryFee(basket, 10);
  const user = await seedUser({ wallet });
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
  chain.balances.set(balanceKey(user.solanaAddress, null), 10n ** 9n);
  const op = (await invest(user.h, basket.basketId)).body;
  return { chain, wallet, basket, user, op };
}
/** A quoted group (200) for a fresh plan. */
export async function quoted(over: { legs?: number } = {}) {
  const ctx = await arrange(over);
  const res = await groupReq(ctx.user.h, ctx.op.id);
  expect(res.status).toBe(200);
  return { ...ctx, group: res.body as { groupId: string; transactions: Tx[]; legs: { legId: string; error: { code: string } | null }[]; approvalsEstimate: number; priceMoved: boolean; sendBy: string } };
}


/** Marks `origin` as a buy whose destination swap failed (its funds arrived as USDC) and appends the PLANNED recovery leg that swaps them; the operation is running. Returns the recovery leg's id. */
export async function addRecovery(opId: string, origin: LegRow): Promise<string> {
  await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${opId}`;
  await adminSql`UPDATE app.operation_legs SET status = 'FAILED', failure_reason = 'DESTINATION_SWAP_FAILED', group_id = NULL,
    recovery_token = ${adminSql.json({ chain: "solana", address: USDC_MINT, decimals: 6, symbol: "USDC", amount: "1000000" })} WHERE id = ${origin.id}`;
  const [recovery] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, to_deployment_id, amount_in, min_out, provider, gas_payer, recovery_of, route_summary, status)
    VALUES (gen_random_uuid(), ${opId}, 99, 'swap', 'solana', 'solana', ${origin.to_deployment_id}, 1000000, 900000, 'lifi', 'user_solana', ${origin.id},
      ${adminSql.json({ fromToken: USDC_MINT, fromSymbol: "USDC", fromDecimals: 6, symbol: "T0", decimals: 6 })}, 'PLANNED') RETURNING id`;
  return recovery!.id;
}
