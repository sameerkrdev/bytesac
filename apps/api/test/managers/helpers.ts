import request from "supertest";
import type { Express } from "express";
import { grantRole } from "@/services/platform-roles";
import { signIn, webHeaders } from "../helpers/auth";
import { adminSql } from "../helpers/db";
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

/** A signed-in user holding a platform role. */
export async function opsUser(app: Express, role: "ops_reviewer" | "ops_admin") {
  const s = await signIn(app, newEvmWallet(), "base");
  await grantRole({ operator: "test", requestId: "test-grant" }, s.userId, role);
  return { userId: s.userId, h: webHeaders(s.cookie) };
}

/** Inserts an application directly (bypasses the public flow and its rate limits). */
export async function seedApplication(over: { status?: string; walletChain?: string; walletAddress?: string; email?: string } = {}): Promise<string> {
  const chain = over.walletChain ?? "base";
  const [row] = await adminSql<{ id: string }[]>`
    INSERT INTO app.manager_applications (id, applicant_type, full_name, email, country, professional_background, investment_experience, reason, intended_baskets,
      wallet_chain, wallet_family, wallet_address, status, submitted_at)
    VALUES (gen_random_uuid(), 'individual', 'Ada Lovelace', ${over.email ?? `seed${Math.random().toString(36).slice(2)}@example.com`}, 'GB', 'bg', 'exp', 'why', 'baskets',
      ${chain}, ${chain === "solana" ? "solana" : "evm"}, ${over.walletAddress ?? newEvmWallet().address.toLowerCase()}, ${over.status ?? "SUBMITTED"}, now())
    RETURNING id`;
  return row!.id;
}
