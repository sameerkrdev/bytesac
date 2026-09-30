import request from "supertest";
import type { Express } from "express";
import { signIn, webHeaders } from "../helpers/auth";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets";
import { opsUser } from "../managers/helpers";

export const PDF = Buffer.from("%PDF-1.7\n%test document body");
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const long = "A sufficiently long professional description for validation.";
export const FIELDS = {
  individual: {
    publicProfile: { displayName: "Ada Capital", about: long, experience: long },
    privateDetails: { legalName: "Ada Lovelace", dateOfBirth: "1990-05-01", residentialAddress: "1 Analytical St, London", professionalHistory: long },
  },
  firm: {
    publicProfile: { displayName: "Lovelace Capital", about: long, experience: long },
    privateDetails: {
      legalCompanyName: "Lovelace Capital Ltd", registrationNumber: "12345678", registeredAddress: "1 Analytical St, London",
      directors: "Ada Lovelace", beneficialOwners: "Ada Lovelace", authorizedRepresentatives: "Ada Lovelace",
    },
  },
} as const;
export const DOCS = {
  individual: ["government_id", "proof_of_address"],
  firm: ["company_registration", "ownership_structure", "director_id", "proof_of_address"],
} as const;

/** Clean slate for organization tests: default tables plus only the seeded (jurisdiction-less) templates. */
export async function resetOrgDb(): Promise<void> {
  await resetDb();
  await adminSql`DELETE FROM app.verification_requirement_templates WHERE jurisdiction IS NOT NULL`;
}

/** A signed-in user; `permitted` grants create_manager_organization directly (the grant itself is Spec 2's concern). */
export async function user(app: Express, permitted = true) {
  const wallet = newEvmWallet();
  const s = await signIn(app, wallet, "base");
  if (permitted) await adminSql`INSERT INTO app.user_permissions (id, user_id, permission) VALUES (gen_random_uuid(), ${s.userId}, 'create_manager_organization')`;
  return { userId: s.userId, h: webHeaders(s.cookie), wallet };
}

export async function createOrg(app: Express, h: Record<string, string>, type: "individual" | "firm" = "individual", jurisdiction = "GB") {
  const res = await request(app).post("/v1/organizations").set(h).send({ type, jurisdiction });
  if (res.status !== 201) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/** Presigns, "uploads" the bytes into the fake bucket and confirms. */
export async function uploadDocument(app: Express, h: Record<string, string>, orgId: string, documentType: string, bytes = PDF, contentType = "application/pdf") {
  const presign = await request(app).post(`/v1/organizations/${orgId}/documents`).set(h).send({ documentType, contentType, sizeBytes: bytes.length });
  if (presign.status !== 201) throw new Error(`presign failed: ${JSON.stringify(presign.body)}`);
  const documentId = presign.body.documentId as string;
  fakes.r2.put(`incoming/${orgId}/${documentId}`, bytes, contentType);
  return { documentId, confirm: request(app).post(`/v1/organizations/${orgId}/documents/${documentId}/confirm`).set(h) };
}

export const fillAll = async (app: Express, h: Record<string, string>, orgId: string, type: "individual" | "firm" = "individual") => {
  const res = await request(app).patch(`/v1/organizations/${orgId}/draft`).set(h).send(FIELDS[type]);
  if (res.status !== 200) throw new Error(`fill failed: ${JSON.stringify(res.body)}`);
  for (const doc of DOCS[type]) {
    const up = await uploadDocument(app, h, orgId, doc);
    const confirmed = await up.confirm;
    if (confirmed.status !== 200) throw new Error(`confirm failed: ${JSON.stringify(confirmed.body)}`);
  }
};

export async function verifyEmail(userId: string, value = `owner-${userId.slice(0, 8)}@example.com`) {
  await adminSql`INSERT INTO app.contacts (id, user_id, type, value, status, verified_at) VALUES (gen_random_uuid(), ${userId}, 'email', ${value}, 'verified', now())`;
  return value;
}

/** Enters a payout address, gets the challenge, signs it with `wallet` and verifies. Returns the verify response and the wallet. */
export async function proveWallet(app: Express, h: Record<string, string>, orgId: string, wallet = newSolanaWallet()) {
  const entered = await request(app).post(`/v1/organizations/${orgId}/payout-wallet`).set(h).send({ address: wallet.address });
  if (entered.status !== 201) throw new Error(`enter failed: ${JSON.stringify(entered.body)}`);
  const ch = await request(app).post(`/v1/organizations/${orgId}/payout-wallet/challenge`).set(h);
  if (ch.status !== 200) throw new Error(`challenge failed: ${JSON.stringify(ch.body)}`);
  const verified = await request(app).post(`/v1/organizations/${orgId}/payout-wallet/verify`).set(h).send({ challengeId: ch.body.challengeId, signature: await wallet.sign(ch.body.message) });
  return { res: verified, wallet, challenge: ch.body as { challengeId: string; message: string } };
}

/** An owner with a verified email whose organization is complete: fields, documents and a proven payout wallet. */
export async function readyOrg(app: Express, type: "individual" | "firm" = "individual") {
  const u = await user(app);
  await verifyEmail(u.userId);
  const id = await createOrg(app, u.h, type);
  await fillAll(app, u.h, id, type);
  const proof = await proveWallet(app, u.h, id);
  if (proof.res.status !== 200) throw new Error(`prove failed: ${JSON.stringify(proof.res.body)}`);
  return { ...u, id, payoutWallet: proof.wallet };
}

export const ops = (app: Express) => opsUser(app, "ops_reviewer");
export const transition = (app: Express, h: Record<string, string>, id: string, body: object) => request(app).post(`/v1/ops/organizations/${id}/transition`).set(h).send(body);
export const submit = (app: Express, h: Record<string, string>, id: string) => request(app).post(`/v1/organizations/${id}/submit`).set(h);

/** Submitted and moved to VERIFIED through the API. */
export async function verifiedOrg(app: Express, reviewer: { h: Record<string, string> }, type: "individual" | "firm" = "individual") {
  const o = await readyOrg(app, type);
  expectOk(await submit(app, o.h, o.id));
  expectOk(await transition(app, reviewer.h, o.id, { to: "UNDER_REVIEW" }));
  expectOk(await transition(app, reviewer.h, o.id, { to: "VERIFIED" }));
  return o;
}

function expectOk(res: { status: number; body: unknown }) {
  if (res.status >= 300) throw new Error(`unexpected ${res.status}: ${JSON.stringify(res.body)}`);
}
