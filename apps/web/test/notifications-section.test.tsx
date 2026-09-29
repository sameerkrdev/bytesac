import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const prefs = { rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false };
vi.mock("@/lib/api", () => ({
  api: { getPreferences: vi.fn(async () => prefs), updatePreferences: vi.fn(async (p: object) => ({ ...prefs, ...p })) },
}));
import { api } from "@/lib/api";
import { NotificationsSection } from "@/components/profile/notifications-section";

describe("NotificationsSection", () => {
  it("renders six labelled switches and patches one", async () => {
    render(<QueryClientProvider client={new QueryClient()}><NotificationsSection /></QueryClientProvider>);
    const marketing = await screen.findByRole("switch", { name: "Marketing" });
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    expect(screen.getByText("Security and account notices are always sent.")).toBeInTheDocument();
    await userEvent.click(marketing);
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith({ marketing: true }));
  });
});
