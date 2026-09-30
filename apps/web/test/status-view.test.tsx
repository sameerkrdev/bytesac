import { ApiError } from "@repo/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusView } from "@/components/managers/status-view";

const base = { status: "ADDITIONAL_INFORMATION_REQUIRED" as const, submittedAt: "2026-09-29T00:00:00.000Z", applicantType: "individual" as const, fullName: "Ada", latestMessage: "Please share your track record.", canReply: true };
const view = (client: Parameters<typeof StatusView>[0]["client"]) =>
  render(<QueryClientProvider client={new QueryClient()}><StatusView client={client} /></QueryClientProvider>);

afterEach(() => { window.location.hash = ""; });

describe("StatusView", () => {
  it("missing token shows the invalid state without calling the API", async () => {
    const getApplicationStatus = vi.fn();
    view({ getApplicationStatus, replyToApplication: vi.fn() });
    expect(await screen.findByText("Status link not valid")).toBeInTheDocument();
    expect(getApplicationStatus).not.toHaveBeenCalled();
  });

  it("server-rejected token shows the invalid state", async () => {
    window.location.hash = "#bad";
    view({ getApplicationStatus: vi.fn().mockRejectedValue(new ApiError("APPLICATION_TOKEN_INVALID", 401, "x")), replyToApplication: vi.fn() });
    expect(await screen.findByText("Status link not valid")).toBeInTheDocument();
  });

  it("info required shows message and reply box; reply succeeds", async () => {
    window.location.hash = "#tok";
    const getApplicationStatus = vi.fn()
      .mockResolvedValueOnce(base)
      .mockResolvedValue({ ...base, status: "SCREENING", canReply: false });
    const replyToApplication = vi.fn(async () => undefined);
    view({ getApplicationStatus, replyToApplication });
    expect(await screen.findByText("More information needed")).toBeInTheDocument();
    expect(screen.getByText("Please share your track record.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your reply"), "Here it is");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(replyToApplication).toHaveBeenCalledWith("tok", "Here it is");
    expect(await screen.findByText(/Reply sent/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your reply")).toBeNull();
  });

  it("no reply box when canReply is false", async () => {
    window.location.hash = "#tok";
    view({ getApplicationStatus: vi.fn().mockResolvedValue({ ...base, status: "SCREENING", canReply: false }), replyToApplication: vi.fn() });
    expect(await screen.findByText("In review")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your reply")).toBeNull();
  });
});
