import { PERFORMANCE_LABEL, type PublicBasketDetail } from "@repo/validator";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PerformanceChart } from "@/components/baskets/performance-chart";

const NONE = { sinceLaunch: null, d30: null, d90: null, y1: null };
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const series = (n: number) => Array.from({ length: n }, (_, i) => ({ day: day(i), net: (100 + i * 0.5).toFixed(6), gross: (100 + i * 0.6).toFixed(6) }));
const view = (over: { n?: number; available?: boolean; metrics?: Partial<PublicBasketDetail["metrics"]> } = {}) => {
  const n = over.n ?? 120;
  const performance = { available: over.available ?? true, dataDays: n, series: series(n) };
  const metrics = { available: over.available ?? true, dataDays: n, net: { sinceLaunch: "0.595000", d30: "0.120000", d90: "0.300000", y1: null }, gross: { sinceLaunch: "0.714000", d30: "0.140000", d90: "0.350000", y1: null }, volatility: "0.450000", maxDrawdown: "0.080000", ...over.metrics };
  return render(<PerformanceChart performance={performance} metrics={metrics} label={PERFORMANCE_LABEL} />);
};

describe("Performance chart", () => {
  it("shows the exact simulated-performance label", () => {
    view();
    expect(screen.getByText(PERFORMANCE_LABEL)).toBeInTheDocument();
  });

  it("draws net (solid) and gross (dashed) lines in an image with a text summary and a y axis", () => {
    view();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("aria-label", expect.stringContaining("Net moved from 100.00 to 159.50; gross from 100.00 to 171.40"));
    const paths = img.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute("stroke-dasharray");
    expect(paths[1]).not.toHaveAttribute("stroke-dasharray");
    expect(within(img as unknown as HTMLElement).getAllByText(/^\d+\.\d$/)).toHaveLength(3);
    expect(screen.getByText("Net (solid)")).toBeInTheDocument();
    expect(screen.getByText("Gross (dashed)")).toBeInTheDocument();
  });

  it("offers every day in a data table and range tabs that narrow it", async () => {
    view();
    const table = screen.getByRole("table", { name: "Simulated index values by day", hidden: true });
    expect(within(table).getAllByRole("row")).toHaveLength(121);
    await userEvent.click(screen.getByRole("button", { name: "30 d" }));
    expect(screen.getByRole("button", { name: "30 d" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("table", { hidden: true })).getAllByRole("row")).toHaveLength(32);
    await userEvent.click(screen.getByRole("button", { name: "1 y" }));
    expect(within(screen.getByRole("table", { hidden: true })).getAllByRole("row")).toHaveLength(121);
  });

  it("shows net as the headline with gross beside it, and placeholders for windows not covered yet", () => {
    view();
    const since = screen.getByText("Since launch (net)").closest("div")!;
    expect(since).toHaveTextContent("+59.50%");
    expect(since).toHaveTextContent("Gross +71.40%");
    expect(screen.getByText("1 year (net)").closest("div")).toHaveTextContent("Available after 365 days of data");
    expect(screen.getByText("Max drawdown").closest("div")).toHaveTextContent("8.00%");
  });

  it("says volatility and drawdown need 30 days of data", () => {
    view({ n: 10, metrics: { net: { ...NONE, sinceLaunch: "0.045000" }, gross: { ...NONE, sinceLaunch: "0.054000" }, volatility: null, maxDrawdown: null } });
    expect(screen.getByText("Volatility (annualized)").closest("div")).toHaveTextContent("Available after 30 days of data");
    expect(screen.getByText("30 days (net)").closest("div")).toHaveTextContent("Available after 30 days of data");
  });

  it("shows Performance unavailable (no chart, no numbers) when the basket has a price gap", () => {
    view({ available: false });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Since launch (net)").closest("div")).toHaveTextContent("Performance unavailable");
    expect(screen.getAllByText("Performance unavailable").length).toBeGreaterThanOrEqual(7);
    expect(screen.getByText(PERFORMANCE_LABEL)).toBeInTheDocument();
  });

  it("does not crash with an empty or one-day series", () => {
    view({ n: 0, available: true, metrics: { dataDays: 0, net: NONE, gross: NONE, volatility: null, maxDrawdown: null } });
    expect(screen.getByText("The chart appears once there are two days of data.")).toBeInTheDocument();
  });
});
