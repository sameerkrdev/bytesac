import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import DiscoverScreen from "@/app/(app)/(tabs)/discover";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;

const item = (slug: string, name: string) => ({
  slug, name, shortDescription: `${name} summary`, organizationName: "Alpha Capital", category: "multi_asset", status: "ACTIVE",
  topAssets: [{ symbol: "SOL", bps: 6000 }, { symbol: "ETH", bps: 4000 }], minimumInvestmentUsdc: "50", managementFeeBps: 100, netReturn1y: "0.1234", available: true, hasEligibilityRequirements: true,
});

describe("Discover (mobile)", () => {
  beforeEach(() => { jest.clearAllMocks(); resetApi(mockApi); mockApi.discoverBaskets.mockResolvedValue({ items: [item("alpha", "Alpha Basket")], nextCursor: null }); mockApi.getDiscoveryCollections.mockResolvedValue({ featured: [], trending: [] }); });

  it("lists baskets from the server and opens the detail", async () => {
    await renderWithClient(<DiscoverScreen />);
    expect(await screen.findByText("Alpha Basket")).toBeOnTheScreen();
    expect(screen.getByText("Eligibility requirements")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: /^Alpha Basket, by Alpha Capital..*Largest holdings SOL 60%, ETH 40%/ }));
    expect(router.push).toHaveBeenCalledWith("/basket/alpha");
  });

  it("applies keyword and category filters through the shared schema", async () => {
    await renderWithClient(<DiscoverScreen />);
    await screen.findByText("Alpha Basket");
    await fireEvent.press(screen.getByRole("button", { name: "Filters" }));
    await fireEvent.changeText(screen.getByLabelText("Keywords"), "stable");
    await fireEvent.press(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(mockApi.discoverBaskets).toHaveBeenLastCalledWith(expect.objectContaining({ q: "stable" })));
  });

  it("rejects an invalid highest-minimum amount without calling the API again", async () => {
    await renderWithClient(<DiscoverScreen />);
    await screen.findByText("Alpha Basket");
    await fireEvent.press(screen.getByRole("button", { name: "Filters" }));
    await fireEvent.changeText(screen.getByLabelText("Highest minimum investment (USDC)"), "abc");
    await fireEvent.press(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("Check the filters: use a valid amount.")).toBeOnTheScreen();
  });

  it("shows the empty state", async () => {
    mockApi.discoverBaskets.mockResolvedValue({ items: [], nextCursor: null });
    await renderWithClient(<DiscoverScreen />);
    expect(await screen.findByText("No baskets match. Try removing a filter.")).toBeOnTheScreen();
  });

  it("shows the error state with a retry", async () => {
    mockApi.discoverBaskets.mockRejectedValue(new Error("boom"));
    await renderWithClient(<DiscoverScreen />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeOnTheScreen();
  });

  it("AI search shows how it matched and hands its filters to the filter search", async () => {
    mockApi.aiSearchBaskets.mockResolvedValue({ mode: "tool", filters: { q: "low fee" }, results: [item("beta", "Beta Basket")] });
    await renderWithClient(<DiscoverScreen />);
    await screen.findByText("Alpha Basket");
    await fireEvent.changeText(screen.getByLabelText("Search in your own words"), "low fee baskets");
    await fireEvent.press(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Matched by filters")).toBeOnTheScreen();
    expect(screen.getByText("Beta Basket")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Use these filters" }));
    await waitFor(() => expect(mockApi.discoverBaskets).toHaveBeenLastCalledWith(expect.objectContaining({ q: "low fee" })));
  });

  it("shows Featured and Trending rails until a filter is set", async () => {
    mockApi.getDiscoveryCollections.mockResolvedValue({ featured: [item("feat", "Feat Basket")], trending: [item("hot", "Hot Basket")] });
    await renderWithClient(<DiscoverScreen />);
    expect(await screen.findByText("Feat Basket")).toBeOnTheScreen();
    expect(screen.getByText("Hot Basket")).toBeOnTheScreen();
    expect(screen.getByText("All baskets")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Stablecoin" }));
    await waitFor(() => expect(mockApi.discoverBaskets).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ["stablecoin"] })));
    expect(screen.queryByText("Feat Basket")).toBeNull();
    expect(screen.getByText("Results")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(mockApi.discoverBaskets).toHaveBeenLastCalledWith({ cursor: undefined }));
  });
});
