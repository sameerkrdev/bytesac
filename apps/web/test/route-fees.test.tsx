import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buyLeg, renderApp } from "./invest-fixtures";
import { LegRow } from "@/components/invest/leg-progress";

const show = (o: object) => renderApp(<ol><LegRow leg={buyLeg(o)} buying /></ol>);

describe("route fees and price impact in previews", () => {
  it("sums the included route fees", () => {
    show({ routeFees: [{ name: "LI.FI fee", amountUsd: 0.25, included: true }, { name: "Bridge", amountUsd: 0.5, included: true }, { name: "Gas", amountUsd: 9, included: false }] });
    expect(screen.getByText("Route fees (LI.FI, DEX, bridge): $0.75 — included in the estimate")).toBeInTheDocument();
  });
  it("shows price impact plainly below 2% and as a warning from 2%", () => {
    const { unmount } = show({ priceImpact: 0.0199 });
    expect(screen.getByText("Price impact 1.99%")).toHaveClass("text-ink-muted");
    unmount();
    show({ priceImpact: 0.02 });
    expect(screen.getByText(/Price impact 2.00%/)).toHaveClass("text-warning");
  });
  it("notes a transfer tax on a flagged token", () => {
    show({ feeOnTransfer: true });
    expect(screen.getByText("This token charges a transfer tax; amounts are estimates.")).toBeInTheDocument();
  });
  it("shows nothing extra without fees, impact or a flag", () => {
    show({});
    expect(screen.queryByText(/Route fees|Price impact|transfer tax/)).toBeNull();
  });
});
