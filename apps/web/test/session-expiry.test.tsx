import { ApiError } from "@repo/api-client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/components/providers";

function Failing({ id }: { id: string }) {
  useQuery({ queryKey: [id], queryFn: async () => { throw new ApiError("SESSION_EXPIRED", 401, "expired"); }, retry: false });
  return null;
}

describe("session expiry handling", () => {
  it("calls onSessionExpired once even if several queries fail", async () => {
    const onExpired = vi.fn();
    const qc = createAppQueryClient(onExpired);
    render(<QueryClientProvider client={qc}><Failing id="a" /><Failing id="b" /></QueryClientProvider>);
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
  });
});
