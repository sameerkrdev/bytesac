import { ApiError } from "@repo/api-client";
import { ErrorState } from "@/components/layout/states";

/** Inline failure for ops screens; a 403 means the role was revoked mid-session. */
export function OpsError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.code === "FORBIDDEN") {
    return <p role="alert" className="text-base text-ivory">You don&apos;t have access to this area. Your role may have been removed.</p>;
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}
