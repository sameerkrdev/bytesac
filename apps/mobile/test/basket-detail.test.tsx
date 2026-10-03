import { fireEvent, screen } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import BasketScreen from "@/app/(app)/basket/[slug]";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";
import { id, publicBasket } from "./fixtures";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: jest.fn(), Redirect: () => null }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;

describe("Basket detail (mobile)", () => {
  beforeEach(() => {
    jest.clearAllMocks(); resetApi(mockApi);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ slug: "alpha" });
    mockApi.getPublicBasket.mockResolvedValue(publicBasket());
    mockApi.getInvestability.mockResolvedValue({ basketId: id(2), investable: true, reasons: [], requiredFamilies: ["solana"], minimumUsdc: "50", eligibility: { eligible: true, reasons: [] } });
  });

  it("shows allocation, fees, eligibility notice, manager and performance from server values; Invest opens the wizard", async () => {
    await renderWithClient(<BasketScreen />);
    expect(await screen.findByText("Alpha Basket")).toBeOnTheScreen();
    expect(screen.getByText("Solana SOL")).toBeOnTheScreen();
    expect(screen.getByText("50%")).toBeOnTheScreen();
    expect(screen.getByText(/Management fee \(per year\)/)).toBeOnTheScreen();
    expect(screen.getByText("Solana (SOL): Not available in your region / for your investor status")).toBeOnTheScreen();
    expect(screen.getByText(/Jane Doe/)).toBeOnTheScreen();
    expect(screen.getByText("Simulated model performance")).toBeOnTheScreen();
    expect(screen.getByText("+1.50%")).toBeOnTheScreen();
    expect(screen.getByLabelText(/Simulated index, base 100/)).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole("button", { name: "Invest" }));
    expect(router.push).toHaveBeenCalledWith("/invest/alpha");
  });

  it("a not-investable basket gives the server reasons and no Invest action", async () => {
    mockApi.getInvestability.mockResolvedValue({ basketId: id(2), investable: false, reasons: [{ code: "BASKET_PAUSED", message: "The basket is paused." }], requiredFamilies: [], minimumUsdc: null });
    await renderWithClient(<BasketScreen />);
    expect(await screen.findByText("The basket is paused.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Not investable yet" })).toBeDisabled();
  });

  it("an ineligible user is sent to the profile to fix it", async () => {
    mockApi.getInvestability.mockResolvedValue({
      basketId: id(2), investable: true, reasons: [], requiredFamilies: [],  minimumUsdc: "50",
      eligibility: { eligible: false, reasons: [{ code: "EMAIL_NOT_VERIFIED", message: "Verify your email." }] },
    });
    await renderWithClient(<BasketScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Verify your email" }));
    expect(router.push).toHaveBeenCalledWith("/(app)/(tabs)/profile");
  });

  it("a missing declaration shows the declaration form inline", async () => {
    mockApi.getInvestability.mockResolvedValue({
      basketId: id(2), investable: true, reasons: [], requiredFamilies: [], minimumUsdc: "50",
      eligibility: { eligible: false, reasons: [{ code: "DECLARATION_REQUIRED", message: "Declare your country." }] },
    });
    await renderWithClient(<BasketScreen />);
    expect(await screen.findByText("Declare your country.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Save declaration" })).toBeDisabled();
  });
});
