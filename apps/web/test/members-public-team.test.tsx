import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
import PublicOrganizationPage from "@/app/organizations/[id]/page";

const ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
afterEach(() => vi.unstubAllGlobals());

const render_ = async (team: object) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: ID, type: "firm", jurisdiction: "GB", verifiedAt: "2026-09-29T00:00:00.000Z", profile: { displayName: "Ada Capital" }, team,
  }), { status: 200 })));
  render(await PublicOrganizationPage({ params: Promise.resolve({ id: ID }) }));
};

describe("Public team", () => {
  it("lists current and former members with role and dates", async () => {
    await render_({
      current: [{ displayName: "Olga Ivanova", title: "Founder", role: "OWNER" }, { displayName: "Sam", title: null, role: "MANAGER" }],
      former: [{ displayName: "Max Former", title: null, role: "ADMIN", from: "2026-01-02T00:00:00.000Z", to: "2026-06-03T00:00:00.000Z" }],
    });
    const current = screen.getByRole("region", { name: "Current team" });
    expect(current).toHaveTextContent("Olga Ivanova");
    expect(current).toHaveTextContent("· Founder, Owner");
    expect(current).toHaveTextContent("Sam · Manager");
    const former = screen.getByRole("region", { name: "Former members" });
    expect(former).toHaveTextContent("Max Former");
    expect(former).toHaveTextContent("Admin");
    expect(former).toHaveTextContent(" to ");
  });

  it("hides empty sections", async () => {
    await render_({ current: [], former: [] });
    expect(screen.queryByRole("region", { name: "Current team" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Former members" })).toBeNull();
  });
});
