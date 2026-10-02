import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Adoption } from "@/components/baskets/adoption";
import { ID } from "./invest-fixtures";

const show = (versions: object[]) => render(<QueryClientProvider client={new QueryClient()}><Adoption bid={ID(3)} client={{ basketAdoption: vi.fn().mockResolvedValue({ versions }) }} /></QueryClientProvider>);

describe("Adoption", () => {
  it("shows counts per version and the masked '<5' verbatim", async () => {
    show([{ versionId: ID(50), versionNumber: 2, openPositions: 12, applied: "<5", skipped: 3, notResponded: 7, inProgress: 0 }]);
    const row = within(await screen.findByRole("row", { name: /Version 2/ }));
    expect(row.getByText("12")).toBeInTheDocument();
    expect(row.getByText("<5")).toBeInTheDocument();
    expect(row.getByText("7")).toBeInTheDocument();
  });

  it("says so when nothing is published", async () => {
    show([]);
    expect(await screen.findByText("No versions are published yet.")).toBeInTheDocument();
  });
});
