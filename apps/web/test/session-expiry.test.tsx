import { ApiError } from "@repo/api-client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "@repo/app-core";

function Q({ id, fail }: { id: string; fail: boolean }) {
  useQuery({
    queryKey: [id],
    queryFn: async () => { if (fail) throw new ApiError("SESSION_EXPIRED", 401, "expired"); return "ok"; },
    retry: false,
  });
  return null;
}

describe("session expiry handling", () => {
  it("calls onSessionExpired once even if several queries fail", async () => {
    const onExpired = vi.fn();
    const qc = createAppQueryClient(onExpired);
    render(<QueryClientProvider client={qc}><Q id="a" fail /><Q id="b" fail /></QueryClientProvider>);
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
  });

  it("re-arms after a successful query and clears the cache on expiry", async () => {
    const onExpired = vi.fn();
    const qc = createAppQueryClient(onExpired);
    const ui = (fail: boolean, id: string) => <QueryClientProvider client={qc}><Q id={id} fail={fail} /></QueryClientProvider>;
    const r = render(ui(true, "a"));
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
    expect(qc.getQueryCache().getAll().every((q) => q.state.status !== "success")).toBe(true);
    r.rerender(ui(false, "ok"));
    await waitFor(() => expect(qc.getQueryData(["ok"])).toBe("ok"));
    r.rerender(ui(true, "c"));
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(2));
  });
});
