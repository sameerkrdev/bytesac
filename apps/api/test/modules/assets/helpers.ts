import request from "supertest";
import { app } from "@/app";
import { signIn, webHeaders } from "../../helpers/auth";
import { adminSql } from "../../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../../helpers/wallets";
import { opsUser } from "../manager-applications/helpers";

export type Headers = Record<string, string>;
export const reviewer = () => opsUser(app, "ops_reviewer");
export const admin = () => opsUser(app, "ops_admin");

/** A signed-in user without any platform role. */
export async function plainUser() {
  const s = await signIn(app, newEvmWallet(), "base");
  return { userId: s.userId, h: webHeaders(s.cookie) };
}

export const evmAddress = () => newEvmWallet().address;
export const solanaAddress = () => newSolanaWallet().address;

export function ok<T extends { status: number; body: unknown }>(res: T): T {
  if (res.status >= 300) throw new Error(`unexpected ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}

export const post = (h: Headers, path: string, body?: object) => request(app).post(path).set(h).send(body);
export const patch = (h: Headers, path: string, body: object) => request(app).patch(path).set(h).send(body);
export const get = (h: Headers, path: string) => request(app).get(path).set(h);

export async function mkAsset(h: Headers, over: Record<string, unknown> = {}): Promise<string> {
  return ok(await post(h, "/v1/ops/assets", { name: "Solana", symbol: "sol", assetType: "CRYPTO", ...over })).body.id as string;
}

export async function mkDeployment(h: Headers, id: string, over: Record<string, unknown> = {}): Promise<string> {
  const body = ok(await post(h, `/v1/ops/assets/${id}/deployments`, { chain: "ethereum", tokenStandard: "erc20", address: evmAddress(), decimals: 18, ...over })).body;
  return (body.deployments as Array<{ id: string }>).at(-1)!.id;
}

export async function mkProvider(h: Headers, name = `Jupiter ${Math.random()}`): Promise<string> {
  return ok(await post(h, "/v1/ops/asset-providers", { name, kind: "dex_aggregator" })).body.id as string;
}

export async function mkIssuer(h: Headers, name = `Issuer ${Math.random()}`): Promise<string> {
  return ok(await post(h, "/v1/ops/asset-issuers", { name })).body.id as string;
}

export async function mkRoute(h: Headers, id: string, deploymentId: string, providerId: string, over: Record<string, unknown> = {}) {
  const body = ok(await post(h, `/v1/ops/assets/${id}/routes`, { deploymentId, providerId, venue: "Jupiter", method: "swap", processingModel: "sync", ...over })).body;
  return (body.routes as Array<{ id: string }>).at(-1)!.id;
}

export const mkRule = async (h: Headers, id: string, over: Record<string, unknown> = {}) =>
  ok(await post(h, `/v1/ops/assets/${id}/rules`, { jurisdiction: "*", action: "acquire", outcome: "ALLOWED", ...over }));

export const putRef = (h: Headers, id: string, kind: "market" | "nav", body: object = {}) => request(app).put(`/v1/ops/assets/${id}/price-references/${kind}`).set(h).send(body);

/** A complete CRYPTO instrument (verified deployment + market reference), ready to submit. */
export async function readyCrypto(h: Headers, over: Record<string, unknown> = {}) {
  const id = await mkAsset(h, over);
  const deploymentId = await mkDeployment(h, id);
  ok(await putRef(h, id, "market", { externalId: "1027" }));
  return { id, deploymentId };
}

export const setStatus = (table: "instruments" | "instrument_deployments" | "execution_routes" | "eligibility_rules", id: string, status: string) =>
  adminSql`UPDATE ${adminSql(`app.${table}`)} SET status = ${status} WHERE id = ${id}`;


export const submit = (h: Headers, id: string) => post(h, `/v1/ops/assets/${id}/submit`);
export const decide = (h: Headers, id: string, body: object) => post(h, `/v1/ops/assets/${id}/decision`, body);
export const act = (h: Headers, id: string, action: string) => post(h, `/v1/ops/assets/${id}/${action}`);
export const itemAct = (h: Headers, id: string, kind: "deployments" | "routes", itemId: string, action: string) => post(h, `/v1/ops/assets/${id}/${kind}/${itemId}/${action}`);

/** A complete CRYPTO instrument driven through submit, approval by `admin` and activation, all through the API. */
export async function activeCrypto(r: { h: Headers }, a: { h: Headers }, over: Record<string, unknown> = {}) {
  const asset = await readyCrypto(r.h, over);
  ok(await submit(r.h, asset.id));
  ok(await decide(a.h, asset.id, { decision: "approved" }));
  ok(await act(a.h, asset.id, "activate"));
  return asset;
}
