import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
import PublicOrganizationPage from "@/app/organizations/[id]/page";

const ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61";
afterEach(() => { vi.unstubAllGlobals(); notFound.mockClear(); });

describe("Public organization page", () => {
  it("renders public catalog fields only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: ID, type: "firm", jurisdiction: "GB", verifiedAt: "2026-09-29T00:00:00.000Z",
      profile: { displayName: "Ada Capital", about: "We manage baskets carefully for investors.", website: "https://ada.example", legalCompanyName: "SECRET LTD", registrationNumber: "12345678" },
    }), { status: 200 })));
    render(await PublicOrganizationPage({ params: Promise.resolve({ id: ID }) }));
    expect(screen.getByRole("heading", { name: "Ada Capital" })).toBeInTheDocument();
    expect(screen.getByText("Verified by Bytesac")).toBeInTheDocument();
    expect(screen.getByText("We manage baskets carefully for investors.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://ada.example" })).toBeInTheDocument();
    expect(screen.queryByText(/SECRET LTD/)).toBeNull();
    expect(screen.queryByText(/12345678/)).toBeNull();
  });

  it("404 from the API becomes notFound()", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(PublicOrganizationPage({ params: Promise.resolve({ id: ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("a malformed id never reaches the API", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(PublicOrganizationPage({ params: Promise.resolve({ id: "../x" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(f).not.toHaveBeenCalled();
  });
});
