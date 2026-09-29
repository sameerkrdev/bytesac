import { ApiError } from "@repo/api-client";
import { toDisplayError } from "@/lib/errors";

/** Inline failure for ops screens; a 403 means the role was revoked mid-session. */
export function OpsError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === "FORBIDDEN") {
    return <p role="alert" className="text-base text-ivory">You don&apos;t have access to this area. Your role may have been removed.</p>;
  }
  const e = toDisplayError(error);
  return <p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p>;
}
