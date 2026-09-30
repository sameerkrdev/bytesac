import request from "supertest";
import type { Express } from "express";
import { signIn, webHeaders } from "../helpers/auth";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { newEvmWallet } from "../helpers/wallets";

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
  const s = await signIn(app, newEvmWallet(), "base");
  if (permitted) await adminSql`INSERT INTO app.user_permissions (id, user_id, permission) VALUES (gen_random_uuid(), ${s.userId}, 'create_manager_organization')`;
  return { userId: s.userId, h: webHeaders(s.cookie) };
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
