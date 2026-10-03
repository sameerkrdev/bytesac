import { ApiError } from "@repo/api-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { position, renderApp } from "./invest-fixtures";

const getPortfolio = vi.fn();
const notifications = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getPortfolio: () => getPortfolio(), notifications: (q: unknown) => notifications(q), markNotificationsRead: vi.fn() } }));
vi.mock("@/lib/wallet/use-leg-signer", () => ({ useLegSigner: () => ({}) }));
import PortfolioPage from "@/app/(app)/portfolio/page";
import { PageLayout } from "@/components/layout/page-layout";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/layout/states";
import { Inbox } from "@/components/notifications/inbox";

beforeEach(() => vi.clearAllMocks());

describe("state components", () => {
  it("loading is a status", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
  it("empty says what is missing and offers the next step", () => {
    render(<EmptyState title="Nothing here"><a href="/x">Do it</a></EmptyState>);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing here");
    expect(screen.getByRole("link", { name: "Do it" })).toBeInTheDocument();
  });
  it("error words the failure and retries on request", async () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError("RATE_LIMITED", 429, "slow")} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("error without a retry shows no button", () => {
    render(<ErrorState error={new Error("x")} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("stale notice warns", () => {
    render(<StaleNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("out of date");
  });
  it("page layout gives the page one labelled heading, a breadcrumb and actions", () => {
    render(<PageLayout title="Asset" breadcrumb={[{ label: "Ops", href: "/ops" }, { label: "Assets" }]} actions={<button>Act</button>}><p>body</p></PageLayout>);
    expect(screen.getByRole("heading", { level: 1, name: "Asset" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Asset" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ops" })).toHaveAttribute("href", "/ops");
    expect(screen.getByText("Assets")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Act" })).toBeInTheDocument();
  });
});

describe("Portfolio page states", () => {
  it("loads, then is empty with a way to discover baskets", async () => {
    getPortfolio.mockResolvedValue({ positions: [], formerPositions: [], openOperations: [], history: [], repairs: [] });
    renderApp(<PortfolioPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByText(/no open positions/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Discover baskets" })).toHaveAttribute("href", "/baskets");
  });
  it("shows the error with a retry that loads again", async () => {
    getPortfolio.mockRejectedValueOnce(new ApiError("INTERNAL", 500, "x")).mockResolvedValue({ positions: [position()], formerPositions: [], openOperations: [], history: [], repairs: [] });
    renderApp(<PortfolioPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Core Crypto" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps showing loaded data with a stale notice when a refresh fails", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getPortfolio.mockResolvedValueOnce({ positions: [position()], formerPositions: [], openOperations: [], history: [], repairs: [] }).mockRejectedValue(new ApiError("INTERNAL", 500, "x"));
    render(<QueryClientProvider client={client}><PortfolioPage /></QueryClientProvider>);
    expect(await screen.findByRole("link", { name: "Core Crypto" })).toBeInTheDocument();
    await client.refetchQueries({ queryKey: ["portfolio"] });
    expect(await screen.findByText(/Could not refresh/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Core Crypto" })).toBeInTheDocument();
  });
});

describe("Notifications page states", () => {
  it("loading, empty, and error with retry", async () => {
    notifications.mockRejectedValueOnce(new ApiError("INTERNAL", 500, "x")).mockResolvedValue({ items: [], nextCursor: null, unreadCount: 0 });
    renderApp(<Inbox />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing yet.")).toBeInTheDocument();
  });
});
