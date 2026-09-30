import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AllocationEditor } from "@/components/baskets/allocation-editor";
import { ETH, SOL, basketAsset } from "./org-fixtures";

const assets = [basketAsset({ targetWeightBps: 6000 }), basketAsset({ instrumentId: ETH, name: "Ether", symbol: "ETH", targetWeightBps: 3000 })];
const editor = (props: Partial<Parameters<typeof AllocationEditor>[0]> = {}) => {
  const onChange = vi.fn();
  const listAssets = vi.fn().mockResolvedValue({ items: [{ id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d5099", name: "Bitcoin", symbol: "BTC", assetType: "CRYPTO", chains: ["bitcoin"] }], nextCursor: null });
  render(<QueryClientProvider client={new QueryClient()}><AllocationEditor assets={assets} onChange={onChange} readOnly={false} client={{ listAssets }} {...props} /></QueryClientProvider>);
  return { onChange, listAssets };
};

describe("Allocation editor", () => {
  it("shows total, remaining, count and largest", () => {
    editor();
    const s = within(screen.getByLabelText("Allocation summary"));
    expect(s.getByText("Total").nextSibling).toHaveTextContent("90%");
    expect(s.getByText("Remaining").nextSibling).toHaveTextContent("10%");
    expect(s.getByText("Assets").nextSibling).toHaveTextContent("2");
    expect(s.getByText("Largest").nextSibling).toHaveTextContent("60%");
  });

  it("shows bps beside a weight and never normalizes the others", async () => {
    const { onChange } = editor();
    expect(screen.getByLabelText("Weight of SOL")).toHaveValue("60");
    const w = screen.getByLabelText("Weight of SOL");
    await userEvent.clear(w);
    await userEvent.type(w, "50");
    const last = onChange.mock.lastCall![0] as typeof assets;
    expect(last.map((a) => [a.instrumentId, a.targetWeightBps])).toEqual([[SOL, 5000], [ETH, 3000]]);
  });

  it("refuses more than two decimals instead of rounding", async () => {
    const { onChange } = editor();
    const w = screen.getByLabelText("Weight of SOL");
    await userEvent.clear(w);
    onChange.mockClear();
    await userEvent.type(w, "12.345");
    expect(screen.getByText("Use at most two decimals.")).toBeInTheDocument();
    expect(onChange.mock.calls.every(([a]) => (a as typeof assets)[0]!.targetWeightBps !== 1235)).toBe(true);
  });

  it("adds a registry asset at 0% and leaves the other weights alone", async () => {
    const { onChange, listAssets } = editor();
    await userEvent.type(screen.getByLabelText("Search the asset registry"), "bit");
    await userEvent.click(await screen.findByRole("button", { name: "Add Bitcoin" }));
    expect(listAssets).toHaveBeenCalledWith({ q: "bit" });
    const next = onChange.mock.lastCall![0] as typeof assets;
    expect(next.map((a) => a.targetWeightBps)).toEqual([6000, 3000, 0]);
  });

  it("removes a row without touching the rest", async () => {
    const { onChange } = editor();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ether" }));
    expect((onChange.mock.lastCall![0] as typeof assets).map((a) => a.targetWeightBps)).toEqual([6000]);
  });

  it("hides search and remove when read-only", () => {
    editor({ readOnly: true });
    expect(screen.queryByLabelText("Search the asset registry")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByLabelText("Weight of SOL")).toBeDisabled();
  });
});
