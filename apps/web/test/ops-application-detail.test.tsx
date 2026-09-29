import { ApiError } from "@repo/api-client";
import type { ApplicationDetail } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationDetailView } from "@/components/ops/application-detail";

const ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
const detail: ApplicationDetail = {
  id: ID, status: "SUBMITTED", applicantType: "individual", fullName: "Ada Lovelace", firmName: null, email: "ada@example.com", country: "GB",
  walletChain: "base", walletAddress: "0x1234567890abcdef1234567890abcdef12345678", walletProvenAt: null, submittedAt: "2026-09-29T00:00:00.000Z",
  phone: null, website: null, professionalBackground: "bg", investmentExperience: "exp", qualifications: null, reason: "why", intendedBaskets: "baskets",
  emailConfirmedAt: "2026-09-29T00:00:00.000Z", decidedAt: null, decidedByUserId: null, userId: null,
  events: [{ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e60", actorType: "ops", actorUserId: null, kind: "note", fromStatus: null, toStatus: null, internalNote: "Looks legit", messageToApplicant: null, applicantMessage: null, createdAt: "2026-09-29T01:00:00.000Z" }],
};
const view = (opsGetApplication: () => Promise<ApplicationDetail>) =>
  render(<QueryClientProvider client={new QueryClient()}><ApplicationDetailView id={ID} client={{ opsGetApplication, opsTransitionApplication: vi.fn(), opsAddApplicationNote: vi.fn() }} /></QueryClientProvider>);

describe("ApplicationDetailView", () => {
  it("shows wallet as not proven and marks internal notes", async () => {
    view(async () => detail);
    expect(await screen.findByText("Wallet not proven")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.getByText("Looks legit")).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Select a status", "In review", "Not approved"]);
  });

  it("shows the access-lost state on 403", async () => {
    view(async () => { throw new ApiError("FORBIDDEN", 403, "no"); });
    expect(await screen.findByText(/Your role may have been removed/)).toBeInTheDocument();
  });
});
