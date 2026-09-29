interface PgLikeError { code?: string; constraint_name?: string; constraint?: string; cause?: unknown }

function pgError(err: unknown): PgLikeError | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && typeof cur === "object" && cur !== null; i++) {
    const e = cur as PgLikeError;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    cur = e.cause;
  }
  return null;
}

/** Drizzle wraps driver errors (DrizzleQueryError.cause); walk the cause chain. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  if (!e || e.code !== "23505") return false;
  return constraint === undefined || (e.constraint_name ?? e.constraint) === constraint;
}
