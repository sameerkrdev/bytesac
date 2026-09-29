import type { z } from "zod";
import { DomainError } from "./errors.js";

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", "Request validation failed", {
      details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}
