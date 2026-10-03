import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking } from "react-native";
import NotificationsScreen from "@/app/(app)/(tabs)/notifications";
import ProfileScreen from "@/app/(app)/(tabs)/profile";
import { api } from "@/lib/api";
import { mobileRoute } from "@/lib/notification-route";
import { apiMock, renderWithClient, resetApi } from "./helpers";
import { id } from "./fixtures";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockSignOut = jest.fn();
jest.mock("@/lib/auth-context", () => ({ useAuth: () => ({ signOut: mockSignOut }) }));
jest.mock("@/components/auth/wallet-verification", () => ({ WalletVerification: () => null }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;

const note = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(60 + n), kind: "rebalance_available", basketId: null, positionId: id(31), title: `Update ${n}`, body: `Body ${n}`, link: `/portfolio/${id(31)}/rebalance`,
  readAt: null, createdAt: new Date().toISOString(), ...over,
});

beforeEach(() => { jest.clearAllMocks(); resetApi(mockApi); });

describe("Notifications (mobile)", () => {
  it("lists the inbox with unread marked in words, taps mark it read and open the matching screen", async () => {
    mockApi.notifications.mockResolvedValue({ items: [note(1), note(2, { readAt: new Date().toISOString(), link: "/baskets/alpha" })], unreadCount: 1, nextCursor: null });
    mockApi.markNotificationsRead.mockResolvedValue(undefined);
    await renderWithClient(<NotificationsScreen />);
    expect(await screen.findByLabelText("Unread. Update 1")).toBeOnTheScreen();
    expect(screen.getByLabelText("Update 2")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Unread. Update 1"));
    await waitFor(() => expect(mockApi.markNotificationsRead).toHaveBeenCalledWith({ ids: [id(61)] }));
    expect(router.push).toHaveBeenCalledWith(`/rebalance/${id(31)}`);
    await fireEvent.press(screen.getByLabelText("Update 2"));
    expect(router.push).toHaveBeenCalledWith("/basket/alpha");
    expect(mockApi.markNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it("Mark all read marks the whole inbox", async () => {
    mockApi.notifications.mockResolvedValueOnce({ items: [note(1)], unreadCount: 1, nextCursor: "c1" }).mockResolvedValue({ items: [note(3)], unreadCount: 1, nextCursor: null });
    mockApi.markNotificationsRead.mockResolvedValue(undefined);
    await renderWithClient(<NotificationsScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(mockApi.markNotificationsRead).toHaveBeenCalledWith({ all: true }));
  });

  it("empty inbox", async () => {
    mockApi.notifications.mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });
    await renderWithClient(<NotificationsScreen />);
    expect(await screen.findByText("Nothing yet.")).toBeOnTheScreen();
  });

  it("error state retries", async () => {
    mockApi.notifications.mockRejectedValue(new Error("boom"));
    await renderWithClient(<NotificationsScreen />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeOnTheScreen();
  });

  it("maps every web link the API sends to a mobile route", () => {
    expect(mobileRoute("/portfolio/repair/cash")).toBe("/repair/cash");
    expect(mobileRoute(`/portfolio/${id(31)}/rebalance`)).toBe(`/rebalance/${id(31)}`);
    expect(mobileRoute("/baskets/alpha")).toBe("/basket/alpha");
    expect(mobileRoute("/portfolio")).toBe("/(app)/(tabs)/portfolio");
    expect(mobileRoute("/something/else")).toBe("/(app)/(tabs)/portfolio");
  });
});

describe("Profile (mobile)", () => {
  const me = (over: Record<string, unknown> = {}) => ({
    user: { id: id(70), status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
    wallet: { id: id(71), walletProvider: "Phantom", addresses: [{ chain: "solana", chainFamily: "solana", address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "active", verificationMethod: "ed25519", verifiedAt: "2026-09-29T00:00:00.000Z" }] },
    contacts: [], permissions: [], platformRoles: [], organizations: [], ...over,
  });
  const setup = (m = me()) => {
    mockApi.me.mockResolvedValue(m);
    mockApi.getEligibility.mockResolvedValue({ declaration: null });
    mockApi.getPreferences.mockResolvedValue({ rebalance: true, portfolioUpdates: true, managerUpdates: false, offers: false, productUpdates: false, marketing: false });
    mockApi.sessions.mockResolvedValue({ sessions: [] });
    return renderWithClient(<ProfileScreen />);
  };

  it("shows contacts, preferences, eligibility, wallets and logs out remotely", async () => {
    await setup();
    expect(await screen.findByText("Investment wallet")).toBeOnTheScreen();
    expect(screen.getByText("Contacts")).toBeOnTheScreen();
    expect(screen.getByText("Eligibility")).toBeOnTheScreen();
    expect(await screen.findByText("You have not declared yet.")).toBeOnTheScreen();
    expect(await screen.findByLabelText("Rebalances")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Log out" }));
    expect(mockSignOut).toHaveBeenCalledWith({ remote: true });
  });

  it("Bitcoin is linked on the web", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await setup();
    await fireEvent.press(await screen.findByRole("button", { name: "Link Bitcoin on web" }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/profile$/));
  });

  it("a linked Bitcoin address is shown, not re-linked", async () => {
    const m = me();
    (m.wallet.addresses as unknown[]).push({ chain: "bitcoin", chainFamily: "bitcoin", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", status: "active", verificationMethod: "bip322", verifiedAt: "2026-09-29T00:00:00.000Z" });
    await setup(m);
    expect(await screen.findByText(/Linked bc1qxy/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Link Bitcoin on web" })).toBeNull();
  });

  it("managers and ops see Manage on web; plain investors do not", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await setup(me({ organizations: [{ membershipStatus: "ACTIVE" }] }));
    await fireEvent.press(await screen.findByRole("button", { name: "Open on web" }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/organization$/));
  });

  it("no Manage on web card for an investor", async () => {
    await setup();
    await screen.findByText("Investment wallet");
    expect(screen.queryByText("Manage on web")).toBeNull();
  });

  it("eligibility: country, status and attestation are all needed; Save sends the versioned declaration", async () => {
    mockApi.declareEligibility.mockResolvedValue({ declaration: null });
    await setup();
    const save = await screen.findByRole("button", { name: "Save declaration" });
    expect(save).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Country of residence"), "india");
    await fireEvent.press(await screen.findByRole("button", { name: "India" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Retail investor" }));
    expect(screen.getByRole("button", { name: "Save declaration" })).toBeDisabled();
    await fireEvent(screen.getByLabelText("I confirm the declaration is true"), "valueChange", true);
    expect(screen.getByRole("button", { name: "Save declaration" })).toBeEnabled();
    await fireEvent.press(screen.getByRole("button", { name: "Save declaration" }));
    await waitFor(() => expect(mockApi.declareEligibility).toHaveBeenCalledWith({ country: "IN", investorStatus: "retail", attestationVersion: "2026-10-03" }));
  });

  it("an existing declaration shows its validity", async () => {
    mockApi.me.mockResolvedValue(me());
    mockApi.getEligibility.mockResolvedValue({ declaration: { country: "IN", investorStatus: "accredited", attestationVersion: "2026-10-03", createdAt: "2026-10-03T00:00:00.000Z", expiresAt: "2027-10-03T00:00:00.000Z", expired: true } });
    mockApi.getPreferences.mockResolvedValue({ rebalance: true, portfolioUpdates: true, managerUpdates: false, offers: false, productUpdates: false, marketing: false });
    mockApi.sessions.mockResolvedValue({ sessions: [] });
    await renderWithClient(<ProfileScreen />);
    expect(await screen.findByText("Expired")).toBeOnTheScreen();
    expect(screen.getByText("India · Accredited investor")).toBeOnTheScreen();
  });
});
