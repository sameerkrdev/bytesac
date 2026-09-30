import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES, DOCUMENT_TYPE_KEYS, MAX_DOCUMENT_BYTES, ORGANIZATION_FIELDS, ORGANIZATION_STATUSES, ORGANIZATION_TRANSITIONS,
  presignDocumentRequestSchema, transitionOrganizationRequestSchema, updateDraftRequestSchema, versionDecisionRequestSchema,
} from "./index";

describe("organization catalog", () => {
  it("every default template key exists in the catalog with the right document types", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      for (const key of t.requiredFields) expect(ORGANIZATION_FIELDS[key], key).toBeDefined();
      for (const doc of t.requiredDocuments) expect(DOCUMENT_TYPE_KEYS).toContain(doc);
    }
  });

  it("template-required fields are never optional-looking empties", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      for (const key of t.requiredFields) expect(ORGANIZATION_FIELDS[key].schema.safeParse("").success, key).toBe(false);
    }
  });
});

describe("updateDraftRequestSchema", () => {
  it("accepts valid public and private fields and trims values", () => {
    const parsed = updateDraftRequestSchema.parse({ publicProfile: { displayName: "  Ada Capital  " }, privateDetails: { dateOfBirth: "1990-05-01" } });
    expect(parsed.publicProfile).toEqual({ displayName: "Ada Capital" });
  });
  it("rejects an unknown key", () => {
    const r = updateDraftRequestSchema.safeParse({ publicProfile: { nope: "x" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["publicProfile", "nope"]);
  });
  it("rejects a prototype key and unknown top-level keys", () => {
    expect(updateDraftRequestSchema.safeParse({ publicProfile: { toString: "x" } }).success).toBe(false);
    expect(updateDraftRequestSchema.safeParse({ other: {} }).success).toBe(false);
  });
  it("rejects a private key under publicProfile and the reverse", () => {
    expect(updateDraftRequestSchema.safeParse({ publicProfile: { legalName: "Ada Lovelace" } }).success).toBe(false);
    expect(updateDraftRequestSchema.safeParse({ privateDetails: { displayName: "Ada" } }).success).toBe(false);
  });
  it("rejects an http website and accepts https", () => {
    expect(updateDraftRequestSchema.safeParse({ publicProfile: { website: "http://example.com" } }).success).toBe(false);
    expect(updateDraftRequestSchema.safeParse({ publicProfile: { website: "https://example.com" } }).success).toBe(true);
  });
  it("requires 18+ for dateOfBirth", () => {
    const year = new Date().getUTCFullYear();
    expect(updateDraftRequestSchema.safeParse({ privateDetails: { dateOfBirth: `${year - 10}-01-01` } }).success).toBe(false);
    expect(updateDraftRequestSchema.safeParse({ privateDetails: { dateOfBirth: "not-a-date" } }).success).toBe(false);
    expect(updateDraftRequestSchema.safeParse({ privateDetails: { dateOfBirth: `${year - 30}-01-01` } }).success).toBe(true);
  });
});

describe("presignDocumentRequestSchema", () => {
  const ok = { documentType: "government_id", contentType: "application/pdf", sizeBytes: 1000 };
  it("accepts allowed types and rejects others or oversize", () => {
    expect(presignDocumentRequestSchema.safeParse(ok).success).toBe(true);
    expect(presignDocumentRequestSchema.safeParse({ ...ok, contentType: "application/x-msdownload" }).success).toBe(false);
    expect(presignDocumentRequestSchema.safeParse({ ...ok, sizeBytes: MAX_DOCUMENT_BYTES + 1 }).success).toBe(false);
    expect(presignDocumentRequestSchema.safeParse({ ...ok, documentType: "passport" }).success).toBe(false);
  });
});

describe("state machines", () => {
  it("transitions have no self-loops and terminal states are empty", () => {
    for (const s of ORGANIZATION_STATUSES) expect(ORGANIZATION_TRANSITIONS[s]).not.toContain(s);
    for (const s of ["VERIFIED", "REJECTED", "DRAFT", "CHANGES_REQUIRED"] as const) expect(ORGANIZATION_TRANSITIONS[s]).toEqual([]);
    expect(ORGANIZATION_TRANSITIONS.UNDER_REVIEW).toEqual(["CHANGES_REQUIRED", "VERIFIED", "REJECTED"]);
  });
  it("CHANGES_REQUIRED needs a message to the owner", () => {
    expect(transitionOrganizationRequestSchema.safeParse({ to: "CHANGES_REQUIRED" }).success).toBe(false);
    expect(transitionOrganizationRequestSchema.safeParse({ to: "CHANGES_REQUIRED", messageToOwner: "Fix the address" }).success).toBe(true);
    expect(transitionOrganizationRequestSchema.safeParse({ to: "VERIFIED" }).success).toBe(true);
    expect(versionDecisionRequestSchema.safeParse({ decision: "changes_required" }).success).toBe(false);
    expect(versionDecisionRequestSchema.safeParse({ decision: "approved" }).success).toBe(true);
  });
});
