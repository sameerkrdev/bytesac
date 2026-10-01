import { ApiError, decodeDiscoveryFilters } from "@repo/api-client";
import type { AiSearchResponse } from "@repo/validator";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSearchBox } from "@/components/discovery/ai-search-box";
import { searchItem, withQuery } from "./discovery-fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => push.mockReset());

const respond = (over: Partial<AiSearchResponse> = {}) => ({ aiSearchBaskets: vi.fn().mockResolvedValue({ mode: "tool", filters: null, results: [searchItem()], ...over }) });
const ask = async (client: ReturnType<typeof respond>, text = "low fee stablecoin baskets") => {
  withQuery(<AiSearchBox client={client} />);
  await userEvent.type(screen.getByLabelText("Search in your own words"), text);
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
};

describe("AI search box", () => {
  it("shows the Gemini notice before searching, then the mode label, results and no free text", async () => {
    const client = respond();
    await ask(client);
    expect(client.aiSearchBaskets).toHaveBeenCalledWith("low fee stablecoin baskets");
    expect(await screen.findByText("Matched by filters")).toBeInTheDocument();
    expect(screen.getByText("Queries are processed by Google Gemini.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Core Crypto" })).toBeInTheDocument();
  });

  it.each([["semantic", "Closest in meaning"], ["keyword", "Keyword match"]] as const)("labels %s results", async (mode, text) => {
    await ask(respond({ mode, filters: null }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Filters used" })).not.toBeInTheDocument();
  });

  it("shows the filters used as chips; removing one runs the structured search with the rest via f", async () => {
    await ask(respond({ filters: { categories: ["stablecoin"], maxFeeBps: { management: 50 }, sort: "management_fee_asc" } }));
    const chips = await screen.findByRole("list", { name: "Filters used" });
    expect(chips).toHaveTextContent("Category: Stablecoin");
    expect(chips).toHaveTextContent("Fees up to management 0.5%");
    await userEvent.click(screen.getByRole("button", { name: "Remove filter: Category: Stablecoin" }));
    const url = new URL(push.mock.calls[0]![0], "http://x");
    expect(url.pathname).toBe("/baskets");
    expect(decodeDiscoveryFilters(url.searchParams.get("f") ?? undefined)).toEqual({ maxFeeBps: { management: 50 }, sort: "management_fee_asc" });
    // the AI result is dismissed once the structured search takes over
    expect(screen.queryByText("Matched by filters")).not.toBeInTheDocument();
  });

  it("shows the rate-limit message on 429", async () => {
    await ask({ aiSearchBaskets: vi.fn().mockRejectedValue(new ApiError("RATE_LIMITED", 429, "slow down", 30)) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many searches. Try again later.");
  });

  it("does not submit an empty query", () => {
    withQuery(<AiSearchBox client={respond()} />);
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  });
});
