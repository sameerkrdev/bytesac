import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/how-it-works", useSearchParams: () => new URLSearchParams() }));
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { SurfaceProvider } from "@/components/layout/surface";

describe("marketing chrome", () => {
  it("swaps Sign in and Explore for Join the waitlist and links only apex pages", () => {
    render(<SurfaceProvider value="marketing"><SiteHeader /><SiteFooter /></SurfaceProvider>);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Explore baskets" })).toBeNull();
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "/#join");
    const primary = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(primary.queryByRole("link", { name: "Baskets" })).toBeNull();
    expect(primary.getByRole("link", { name: "How it works" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Apply" })).toBeNull();
  });

  it("keeps the app links outside the marketing surface", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Join the waitlist" })).toBeNull();
  });
});
