import type { PublicManager } from "@repo/validator";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
import PublicManagerPage from "@/app/managers/[handle]/page";

afterEach(() => vi.unstubAllGlobals());
const T = "2026-09-01T00:00:00.000Z";
const serve = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
const manager = (over: Partial<PublicManager> = {}): PublicManager => ({
  handle: "ada-l", displayName: "Ada <b>Lovelace</b>", headline: "Crypto index builder", bio: "Writes about indexes", experienceYears: 7, background: "Ex-quant", qualifications: ["CFA"],
  links: [{ label: "Site", url: "https://ada.dev" }, { label: "Bad", url: "javascript:alert(1)" }], selfReported: ["experienceYears", "qualifications"], verified: true,
  baskets: [{ slug: "core", name: "Core", status: "ACTIVE", role: "lead", from: T, to: null }, { slug: "old", name: "Old", status: "RETIRED", role: "co_manager", from: T, to: "2026-09-20T00:00:00.000Z" }],
  organizations: [{ organizationId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61", organizationName: "Ada Capital", role: "OWNER", title: "Founder", current: true, from: T, to: null }],
  ...over,
});
const page = async (handle = "ada-l") => render(await PublicManagerPage({ params: Promise.resolve({ handle }) }));

describe("Public manager page", () => {
  it("renders the profile as plain text with Self-reported labels and the verified badge", async () => {
    serve(manager());
    await page();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ada <b>Lovelace</b>");
    expect(screen.getByText("Verified by Bytesac")).toBeInTheDocument();
    expect(screen.getAllByText("Self-reported")).toHaveLength(2);
    expect(screen.getByText("7 years")).toBeInTheDocument();
    expect(screen.getByText("CFA")).toBeInTheDocument();
  });

  it("omits the badge and labels when there is nothing to claim", async () => {
    serve(manager({ verified: false, selfReported: [], experienceYears: null, qualifications: [] }));
    await page();
    expect(screen.queryByText("Verified by Bytesac")).not.toBeInTheDocument();
    expect(screen.queryByText("Self-reported")).not.toBeInTheDocument();
  });

  it("links https URLs safely and never links other schemes", async () => {
    serve(manager());
    await page();
    const link = screen.getByRole("link", { name: "Site" });
    expect(link).toHaveAttribute("href", "https://ada.dev");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.queryByRole("link", { name: "Bad" })).not.toBeInTheDocument();
    expect(screen.getByText("Bad")).toBeInTheDocument();
  });

  it("lists current and previous baskets and organizations with links", async () => {
    serve(manager());
    await page();
    expect(screen.getByRole("region", { name: "Current baskets" })).toHaveTextContent("Core");
    expect(screen.getByRole("region", { name: "Previous baskets" })).toHaveTextContent("Old");
    expect(screen.getByRole("link", { name: "Core" })).toHaveAttribute("href", "/baskets/core");
    expect(screen.getByRole("link", { name: "Ada Capital" })).toHaveAttribute("href", "/organizations/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e61");
  });

  it("is not found for an unknown, draft or hidden profile (the API answers 404)", async () => {
    serve({}, 404);
    await expect(page("nobody")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
