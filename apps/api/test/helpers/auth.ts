import type { AssetChain, Chain } from "@repo/validator";
import type { Express } from "express";
import request, { type Response } from "supertest";

export const ORIGIN = "http://localhost:3000";

export interface TestWallet { address: string; sign(message: string): Promise<string> | string }

export function webHeaders(cookie?: string): Record<string, string> {
  return { Origin: ORIGIN, "X-Requested-With": "bytesac", ...(cookie ? { Cookie: cookie } : {}) };
}

export async function challengeFor(app: Express, body: { purpose: "sign_in" | "add_chain_account"; chain: Chain; address: string; chains?: AssetChain[] }, headers: Record<string, string> = webHeaders()): Promise<Response> {
  return request(app).post("/v1/auth/challenge").set(headers).send(body);
}

export async function signIn(app: Express, wallet: TestWallet, chain: Chain, client: "web" | "mobile" = "web"): Promise<{ res: Response; userId: string; cookie: string | undefined; token: string | undefined }> {
  const headers = client === "web" ? webHeaders() : { "X-Client": "mobile" };
  const ch = await challengeFor(app, { purpose: "sign_in", chain, address: wallet.address }, headers);
  if (ch.status !== 200) throw new Error(`challenge failed: ${JSON.stringify(ch.body)}`);
  const signature = await wallet.sign(ch.body.message);
  const res = await request(app).post("/v1/auth/verify").set(headers).send({ challengeId: ch.body.challengeId, signature, client, walletProvider: "Test" });
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = setCookie?.map((c) => c.split(";")[0]).find((c) => c?.startsWith("bx_session="));
  return { res, userId: res.body.userId as string, cookie, token: res.body.token as string | undefined };
}
