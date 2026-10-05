import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking } from "react-native";
import AssetScreen from "@/app/(app)/asset/[id]";
import ManagerScreen from "@/app/(app)/manager/[handle]";
import OrganizationScreen from "@/app/(app)/organization/[id]";
import PositionScreen from "@/app/(app)/position/[id]";
import { SetupChecklist } from "@/components/portfolio/setup-checklist";
import { HelpSection } from "@/components/profile/help-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { AllocationLegend, AllocationRing } from "@/components/ui/allocation-ring";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";
import { id, portfolio, position } from "./fixtures";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
jest.mock("@/lib/auth-context", () => ({ useAuth: () => ({ signOut: jest.fn() }) }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;

beforeEach(() => { jest.clearAllMocks(); resetApi(mockApi); jest.spyOn(Linking, "openURL").mockResolvedValue(true); });

const asset = (over: Record<string, unknown> = {}) => ({
  id: id(41), name: "Tokenized Treasury", symbol: "TBILL", assetType: "TOKENIZED_TREASURY", logoUrl: null, description: "Short-dated US Treasuries.",
  issuer: { name: "OpenEden", website: "https://openeden.com" }, riskNotes: "Issuer and liquidity risk.", links: [],
  deployments: [{ chain: "ethereum", tokenStandard: "erc20", address: "0xdd50C053C096CB04A3e3362E2b622529EC5f2e8a", decimals: 6 }],
  routes: [{ chain: "ethereum", method: "secondary_market", providerName: "LI.FI", settlementSymbol: "USDC", minimumAmount: null, processingModel: "async" }],
  prices: [{ instrumentId: id(41), kind: "market", status: "ok", value: "1.0123", currency: "USD", source: "coinmarketcap", observedAt: "2026-10-05T00:00:00.000Z", stale: true },
    { instrumentId: id(41), kind: "nav", status: "ok", value: "1.01", currency: "USD", source: "issuer", observedAt: null, stale: false }],
  ...over,
});

describe("Asset screen (mobile)", () => {
  it("shows price, NAV as display only, the tokenized-asset notice, deployments, routes and the issuer link", async () => {
    mockParams = { id: id(41) };
    mockApi.getAsset.mockResolvedValue(asset());
    await renderWithClient(<AssetScreen />);
    expect(await screen.findByText("Tokenized Treasury")).toBeOnTheScreen();
    expect(screen.getByText("$1.0123")).toBeOnTheScreen();
    expect(screen.getByText("Price may be out of date")).toBeOnTheScreen();
    expect(screen.getByText("Display only — trades use market prices.")).toBeOnTheScreen();
    expect(screen.getByText("Tokenized real-world asset")).toBeOnTheScreen();
    expect(screen.getByText(/^Secondary market · settles in USDC/)).toBeOnTheScreen();
    expect(screen.getByText("Asynchronous — settlement can take time")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "OpenEden website" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://openeden.com");
  });

  it("an asset without routes says it can't be traded", async () => {
    mockParams = { id: id(41) };
    mockApi.getAsset.mockResolvedValue(asset({ routes: [], assetType: "CRYPTO", issuer: null }));
    await renderWithClient(<AssetScreen />);
    expect(await screen.findByText("No active route — this asset can’t be traded through Bytesac right now.")).toBeOnTheScreen();
    expect(screen.queryByText("Tokenized real-world asset")).toBeNull();
  });
});

describe("Organization and manager screens (mobile)", () => {
  it("an organization shows only public fields, its baskets and team", async () => {
    mockParams = { id: id(5) };
    mockApi.getPublicOrganization.mockResolvedValue({
      id: id(5), type: "firm", jurisdiction: "GB", verifiedAt: "2026-06-01T00:00:00.000Z",
      profile: { displayName: "Alpha Capital", about: "We build long-horizon baskets.", investmentPhilosophy: "Diversify and rebalance.", legalName: "Hidden Legal Name Ltd" },
      team: { current: [{ displayName: "Jane Doe", title: "CIO", role: "OWNER" }], former: [] },
      baskets: [{ slug: "alpha", name: "Alpha Basket", status: "ACTIVE" }],
    });
    await renderWithClient(<OrganizationScreen />);
    expect(await screen.findByText("Alpha Capital")).toBeOnTheScreen();
    expect(screen.getByText("Diversify and rebalance.")).toBeOnTheScreen();
    expect(screen.queryByText("Hidden Legal Name Ltd")).toBeNull();
    expect(screen.getByText("CIO, Owner")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Alpha Basket" }));
    expect(router.push).toHaveBeenCalledWith("/basket/alpha");
  });

  it("a manager shows self-reported fields as such and links baskets and organizations", async () => {
    mockParams = { handle: "jane" };
    mockApi.getPublicManager.mockResolvedValue({
      handle: "jane", displayName: "Jane Doe", headline: "Multi-asset", bio: null, experienceYears: 12, background: null, qualifications: ["CFA"], links: [],
      selfReported: ["experienceYears", "qualifications"], verified: true,
      baskets: [{ slug: "alpha", name: "Alpha Basket", status: "ACTIVE", role: "lead", from: "2026-06-01T00:00:00.000Z", to: null }],
      organizations: [{ organizationId: id(5), organizationName: "Alpha Capital", role: "OWNER", title: "CIO", current: true, from: "2026-06-01T00:00:00.000Z", to: null }],
    });
    await renderWithClient(<ManagerScreen />);
    expect(await screen.findByText("Jane Doe")).toBeOnTheScreen();
    expect(screen.getByText("Experience · self-reported")).toBeOnTheScreen();
    expect(screen.getByText("Verified organization member")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Alpha Capital" }));
    expect(router.push).toHaveBeenCalledWith(`/organization/${id(5)}`);
  });
});

describe("Position layers (mobile)", () => {
  it("switches between target, allocation and verified views, and opens the asset", async () => {
    mockParams = { id: id(31) };
    const p = position();
    p.holdings = [{ ...p.holdings[0]!, reconciliation: "SHORT" }];
    mockApi.getPortfolio.mockResolvedValue(portfolio({ positions: [p] }));
    await renderWithClient(<PositionScreen />);
    expect(await screen.findByText("Wallet holds less than recorded")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Verified holdings" }));
    expect(screen.getByText("Less than recorded")).toBeOnTheScreen();
    expect(screen.queryByText("Wallet holds less than recorded")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Strategy target" }));
    expect(screen.queryByText(/2 SOL/)).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: /^SOL on Solana, asset details/ }));
    expect(router.push).toHaveBeenCalledWith(`/asset/${p.holdings[0]!.instrumentId}`);
  });
});

describe("Ring selection", () => {
  it("a legend row selects its slice and the centre names it; tapping again clears it", async () => {
    const slices = [{ key: "a", label: "BTC", bps: 6000 }, { key: "b", label: "ETH", bps: 4000 }];
    let pick: string | null = null;
    const ui = () => (
      <>
        <AllocationRing slices={slices} label="ring" selected={pick} onSelect={(k) => { pick = k; }} />
        <AllocationLegend slices={slices} selected={pick} onSelect={(k) => { pick = k; }} />
      </>
    );
    const view = await renderWithClient(ui());
    await fireEvent.press(screen.getByRole("button", { name: "ETH 40.0%" }));
    expect(pick).toBe("b");
    await view.rerender(ui());
    expect(screen.getAllByText("ETH").length).toBe(2);
    await fireEvent.press(screen.getByRole("button", { name: "ETH 40.0%" }));
    expect(pick).toBeNull();
  });
});

describe("Setup checklist, help and sessions (mobile)", () => {
  const me = (over: Record<string, unknown> = {}) => ({
    user: { id: id(70), status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
    wallet: { id: id(71), walletProvider: "Phantom", addresses: [{ chain: "solana", chainFamily: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active", verificationMethod: "ed25519", verifiedAt: "2026-09-29T00:00:00.000Z" }] },
    contacts: [{ id: id(80), type: "email", value: "a@example.com", status: "verified" }], permissions: [], platformRoles: [], organizations: [], ...over,
  }) as never;

  it("lists what is missing, counts what is done, and opens the fix", async () => {
    mockApi.getEligibility.mockResolvedValue({ declaration: null });
    await renderWithClient(<SetupChecklist me={me()} />);
    expect(await screen.findByText("1 of 4")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Verify your phone" }));
    expect(router.push).toHaveBeenCalledWith("/(auth)/contact");
    await fireEvent.press(screen.getByRole("button", { name: "Add an EVM account" }));
    expect(router.push).toHaveBeenCalledWith("/(app)/(tabs)/profile");
  });

  it("hides itself when everything is done", async () => {
    mockApi.getEligibility.mockResolvedValue({ declaration: { country: "IN", investorStatus: "retail", expired: false, expiresAt: "2027-01-01T00:00:00.000Z" } });
    const done = me({
      contacts: [{ id: id(80), type: "email", value: "a@example.com", status: "verified" }, { id: id(81), type: "phone", value: "+44", status: "verified" }],
      wallet: { id: id(71), walletProvider: "Phantom", addresses: [
        { chain: "solana", chainFamily: "solana", address: "4Nd1", status: "active", verificationMethod: "ed25519", verifiedAt: "2026-09-29T00:00:00.000Z" },
        { chain: "ethereum", chainFamily: "evm", address: "0xabc", status: "active", verificationMethod: "eoa_ecdsa", verifiedAt: "2026-09-29T00:00:00.000Z" },
      ] },
    });
    await renderWithClient(<SetupChecklist me={done} />);
    await waitFor(() => expect(mockApi.getEligibility).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); // let the query resolve: the card is also hidden while loading
    expect(screen.queryByText("Finish setting up")).toBeNull();
    expect(screen.queryByText(/of 4$/)).toBeNull();
  });

  it("help topics open in a sheet with the placeholder notice", async () => {
    await renderWithClient(<HelpSection />);
    await fireEvent.press(screen.getByRole("button", { name: "Self-custody" }));
    expect(await screen.findByText("What a signature means")).toBeOnTheScreen();
    expect(screen.getByText("Placeholder copy — pending legal review.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Close Self-custody" }));
    await waitFor(() => expect(screen.queryByText("What a signature means")).toBeNull());
  });

  it("another device can be revoked; this device cannot", async () => {
    mockApi.sessions.mockResolvedValue({ sessions: [
      { id: id(90), client: "mobile", createdAt: "2026-10-01T00:00:00.000Z", lastSeenAt: "2026-10-05T00:00:00.000Z", userAgent: "iOS", ipPrefix: null, current: true },
      { id: id(91), client: "web", createdAt: "2026-09-01T00:00:00.000Z", lastSeenAt: "2026-10-01T00:00:00.000Z", userAgent: "Chrome", ipPrefix: null, current: false },
    ] });
    mockApi.revokeSession.mockResolvedValue(undefined);
    await renderWithClient(<SessionsSection />);
    expect(await screen.findByText("Chrome")).toBeOnTheScreen();
    expect(screen.getByText("Swipe another device left to revoke it.")).toBeOnTheScreen();
    const revoke = screen.getAllByRole("button", { name: "Revoke" });
    expect(revoke).toHaveLength(1);
    await fireEvent.press(revoke[0]!);
    await waitFor(() => expect(mockApi.revokeSession).toHaveBeenCalledWith(id(91)));
  });
});
