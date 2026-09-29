import request from "supertest";
import type { Express } from "express";
import { webHeaders } from "../helpers/auth";
import { fakes } from "../helpers/fakes";
import { newEvmWallet } from "../helpers/wallets";

const text = "Relevant professional detail, long enough to pass validation.";

export function applicationBody(over: Record<string, unknown> = {}) {
  return {
    applicantType: "individual", fullName: "Ada Lovelace", email: `ada${Math.random().toString(36).slice(2)}@example.com`, country: "GB",
    professionalBackground: text, investmentExperience: text, reason: text, intendedBaskets: text,
    walletChain: "base", walletAddress: newEvmWallet().address, ...over,
  } as Record<string, string>;
}

export const lastCode = () => fakes.email.application.filter((m) => m.kind === "code").at(-1)!.data.code!;

/** Creates and confirms an application; returns its id and status token. */
export async function submitApplication(app: Express, over: Record<string, unknown> = {}) {
  const body = applicationBody(over);
  const created = await request(app).post("/v1/manager-applications").set(webHeaders()).send(body);
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const id = created.body.applicationId as string;
  const confirmed = await request(app).post(`/v1/manager-applications/${id}/confirm-email`).set(webHeaders()).send({ code: lastCode() });
  if (confirmed.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(confirmed.body)}`);
  return { id, token: confirmed.body.statusToken as string, body };
}
