import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublicFeesPage from "@/app/fees/page";

afterEach(() => vi.unstubAllGlobals());
const serve = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));

describe("Public fees page", () => {
  it("shows the active platform rates and says managers set their own fees", async () => {
    serve({ platform: [{ operationKind: "invest", bps: 50, minUsdc: null, maxUsdc: "50" }, { operationKind: "repair", bps: 25, minUsdc: "2", maxUsdc: null }] });
    render(await PublicFeesPage());
    expect(screen.getByRole("row", { name: "Investing 0.5% up to $50" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Repair 0.25% (at least $2)" })).toBeInTheDocument();
    expect(screen.getByText(/Fund managers set their own fees/)).toBeInTheDocument();
  });

  it("says so when there is no platform fee", async () => {
    serve({ platform: [] });
    render(await PublicFeesPage());
    expect(screen.getByText("Bytesac charges no platform fee right now.")).toBeInTheDocument();
  });
});
