import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "@repo/validator";
import { adminSql } from "../helpers/db";

describe("seeded verification templates", () => {
  it("match DEFAULT_TEMPLATES in @repo/validator", async () => {
    const rows = await adminSql<{ subject: string; required_fields: string[]; required_documents: string[] }[]>`
      SELECT subject, required_fields, required_documents FROM app.verification_requirement_templates WHERE jurisdiction IS NULL AND retired_at IS NULL`;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const expected = DEFAULT_TEMPLATES[r.subject as keyof typeof DEFAULT_TEMPLATES];
      expect(r.required_fields).toEqual(expected.requiredFields);
      expect(r.required_documents).toEqual(expected.requiredDocuments);
    }
  });
});
