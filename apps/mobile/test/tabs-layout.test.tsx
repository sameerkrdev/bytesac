import { waitFor } from "@testing-library/react-native";
import TabsLayout from "@/app/(app)/(tabs)/_layout";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";

const mockScreens: { name: string; options: { tabBarBadge?: string | number; tabBarAccessibilityLabel?: string } }[] = [];
jest.mock("expo-router", () => {
  const Tabs = ({ children }: { children: unknown }) => children;
  Tabs.Screen = (p: { name: string; options: object }) => { mockScreens.push(p as never); return null; };
  return { Tabs };
});
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;
const latest = (name: string) => [...mockScreens].reverse().find((s) => s.name === name)!;

describe("Tabs (mobile)", () => {
  beforeEach(() => { resetApi(mockApi); mockScreens.length = 0; });

  it("has Discover, Portfolio, Notifications and Profile, with the unread count as the Notifications badge", async () => {
    mockApi.notifications.mockResolvedValue({ items: [], unreadCount: 3, nextCursor: null });
    await renderWithClient(<TabsLayout />);
    expect([...new Set(mockScreens.map((s) => s.name))]).toEqual(["discover", "portfolio", "notifications", "profile"]);
    await waitFor(() => expect(latest("notifications").options.tabBarBadge).toBe(3));
    expect(latest("notifications").options.tabBarAccessibilityLabel).toBe("Notifications, 3 unread");
  });

  it("no badge when everything is read", async () => {
    mockApi.notifications.mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });
    await renderWithClient(<TabsLayout />);
    await waitFor(() => expect(mockApi.notifications).toHaveBeenCalled());
    expect(latest("notifications").options.tabBarBadge).toBeUndefined();
  });
});
