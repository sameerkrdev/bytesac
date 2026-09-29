import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/api", () => ({
  api: { sessions: vi.fn(async () => ({ sessions: [] })), revokeSession: vi.fn(), logoutAll: vi.fn(async () => undefined) },
}));
import { SessionsSection } from "@/components/profile/sessions-section";

describe("SessionsSection", () => {
  it("logout-all clears the query cache and navigates to sign-in", async () => {
    const qc = new QueryClient();
    const clear = vi.spyOn(qc, "clear");
    render(<QueryClientProvider client={qc}><SessionsSection /></QueryClientProvider>);
    expect(await screen.findByText("No active sessions.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log out all devices" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log out everywhere" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(clear).toHaveBeenCalled();
  });
});
