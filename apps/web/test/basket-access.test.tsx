import { ApiError } from "@repo/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BasketWizard } from "@/components/baskets/basket-wizard";
import { Baskets } from "@/components/organization/baskets";
import { BID, T, asRole, basketClient, basketDetail, basketVersion } from "./org-fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const wizard = (detail: ReturnType<typeof basketDetail>) =>
  render(<QueryClientProvider client={new QueryClient()}><BasketWizard bid={BID} client={basketClient({ getBasket: vi.fn().mockResolvedValue(detail) })} /></QueryClientProvider>);
const button = (name: string) => screen.queryByRole("button", { name });

describe("Basket controls follow the caller's flags", () => {
  it("a co-manager without publish sees no Publish on an approved version", async () => {
    const approved = basketVersion({ status: "approved" });
    wizard(basketDetail({ myPermissions: ["edit", "submit"], openVersion: approved }));
    await screen.findByText("Core Crypto");
    expect(button("Publish")).toBeNull();
  });

  it("shows Publish to a holder of the publish flag", async () => {
    wizard(basketDetail({ status: "ACTIVE", myPermissions: ["publish"], openVersion: basketVersion({ status: "approved" }) }));
    expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("a default co-manager can submit but not pause, publish or retire", async () => {
    wizard(basketDetail({ status: "ACTIVE", myPermissions: ["edit", "submit"] }));
    expect(await screen.findByRole("button", { name: "Submit for review" })).toBeInTheDocument();
    for (const n of ["Pause", "Publish", "Request retirement", "Resume"]) expect(button(n)).toBeNull();
  });

  it("lifecycle controls appear only with the lifecycle flag and the right state", async () => {
    wizard(basketDetail({ status: "ACTIVE", myPermissions: ["lifecycle"], openVersion: null, publishedVersion: basketVersion({ status: "published" }) }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(button("Request retirement")).toBeInTheDocument();
    expect(button("Resume")).toBeNull();
    expect(button("New version")).toBeNull();
  });

  it("a platform pause cannot be resumed by the manager", async () => {
    wizard(basketDetail({ status: "PAUSED", pauseKind: "platform", pauseReason: "review", myPermissions: ["lifecycle"], openVersion: null, publishedVersion: basketVersion({ status: "published" }) }));
    expect(await screen.findByText(/Paused by Bytesac: review/)).toBeInTheDocument();
    expect(button("Resume")).toBeNull();
  });

  it("a read-only member sees disabled fields and no actions", async () => {
    wizard(basketDetail({ myPermissions: [] }));
    expect(await screen.findByLabelText("Name")).toBeDisabled();
    expect(screen.getByText("You have read-only access to this basket.")).toBeInTheDocument();
    for (const n of ["Save", "Submit for review", "Withdraw", "Publish", "Pause"]) expect(button(n)).toBeNull();
  });

  it("a version in review is frozen even for the lead", async () => {
    wizard(basketDetail({ openVersion: basketVersion({ status: "in_review" }) }));
    expect(await screen.findByLabelText("Name")).toBeDisabled();
    expect(button("Withdraw")).toBeInTheDocument();
    expect(button("Save")).toBeNull();
  });

  it("shows the access-lost state on 403", async () => {
    render(<QueryClientProvider client={new QueryClient()}><BasketWizard bid={BID} client={basketClient({ getBasket: vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", 403, "no")) })} /></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("You no longer have access to this basket.");
  });
});

describe("Baskets section", () => {
  const summary = (over: object) => ({ id: BID, slug: "x", name: "Core Crypto", category: "multi_asset", status: "DRAFT", currentVersionNumber: null, openVersionStatus: "draft", updatedAt: T, ...over });
  const section = (role: Parameters<typeof asRole>[0], over = {}, baskets: object[] = [summary({})]) =>
    render(<QueryClientProvider client={new QueryClient()}><Baskets org={asRole(role, { status: "VERIFIED", ...over })} client={{ listOrgBaskets: vi.fn().mockResolvedValue({ baskets }), createBasket: vi.fn().mockResolvedValue(basketDetail()) } as never} /></QueryClientProvider>);

  it("lists drafts first and filters by tab", async () => {
    section("MANAGER", {}, [summary({}), summary({ id: "2", name: "Live One", status: "ACTIVE", currentVersionNumber: 1, openVersionStatus: null })]);
    expect(await screen.findByText("Core Crypto")).toBeInTheDocument();
    expect(screen.queryByText("Live One")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByText("Live One")).toBeInTheDocument();
    expect(screen.getByText("Published version 1 · updated", { exact: false })).toBeInTheDocument();
  });

  it("offers Create basket with baskets.manage on a verified organization", async () => {
    section("MANAGER");
    await userEvent.click(await screen.findByRole("button", { name: "Create basket" }));
    await userEvent.type(screen.getByLabelText("Name"), "New Basket");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(push).toHaveBeenCalledWith(`/organization/baskets/${BID}`);
  });

  it("explains instead of offering Create without the permission", async () => {
    section("VIEWER");
    expect(await screen.findByText(/You need basket access/)).toBeInTheDocument();
    expect(button("Create basket")).toBeNull();
  });

  it("explains instead of offering Create while the organization is not verified", async () => {
    section("OWNER", { status: "DRAFT" });
    expect(await screen.findByText("Your organization must be verified to create baskets.")).toBeInTheDocument();
    expect(button("Create basket")).toBeNull();
  });
});
