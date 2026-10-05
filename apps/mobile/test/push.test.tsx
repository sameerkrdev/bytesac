import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { PushBanner, PushRow } from "@/components/profile/push-row";
import { api } from "@/lib/api";
import { disablePush, enablePush, pushBlocker, pushState, revokeStoredPushToken } from "@/lib/push";
import { usePush } from "@/lib/use-push";
import { apiMock, renderWithClient, resetApi } from "./helpers";

let mockProjectId: string | undefined = "proj-1";
jest.mock("expo-constants", () => ({ __esModule: true, default: { get expoConfig() { return { extra: { eas: { projectId: mockProjectId } } }; }, easConfig: null } }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;
const N = Notifications as jest.Mocked<typeof Notifications>;

beforeEach(async () => {
  jest.clearAllMocks(); resetApi(mockApi); mockProjectId = "proj-1";
  await AsyncStorage.clear();
  mockApi.registerPushToken.mockResolvedValue(undefined);
  mockApi.revokePushToken.mockResolvedValue(undefined);
  mockApi.markNotificationsRead.mockResolvedValue(undefined);
  N.getPermissionsAsync.mockResolvedValue({ status: "undetermined" } as never);
  N.requestPermissionsAsync.mockResolvedValue({ status: "granted" } as never);
  N.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[abc]", type: "expo" });
});

describe("push (mobile)", () => {
  it("is unavailable without an EAS project id (no permission prompt)", async () => {
    mockProjectId = undefined;
    expect(pushBlocker()).toBe("unconfigured");
    expect(await enablePush()).toBe("unconfigured");
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks only when turned on, registers the Expo token for this platform and remembers it", async () => {
    expect(await pushState()).toBe("off");
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await enablePush()).toBe("on");
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj-1" });
    expect(mockApi.registerPushToken).toHaveBeenCalledWith(expect.objectContaining({ token: "ExponentPushToken[abc]", platform: "ios", provider: "expo" }));
    N.getPermissionsAsync.mockResolvedValue({ status: "granted" } as never);
    expect(await pushState()).toBe("on");
  });

  it("a refusal registers nothing and reports denied", async () => {
    N.requestPermissionsAsync.mockResolvedValue({ status: "denied" } as never);
    expect(await enablePush()).toBe("denied");
    expect(mockApi.registerPushToken).not.toHaveBeenCalled();
  });

  it("turning off and signing out revoke the stored token", async () => {
    await enablePush();
    expect(await disablePush()).toBe("off");
    expect(mockApi.revokePushToken).toHaveBeenCalledWith("ExponentPushToken[abc]");
    await enablePush();
    mockApi.revokePushToken.mockClear();
    await revokeStoredPushToken();
    expect(mockApi.revokePushToken).toHaveBeenCalledWith("ExponentPushToken[abc]");
    expect(await AsyncStorage.getItem("bx_push_token")).toBeNull();
  });

  it("a tapped push opens the matching screen and marks its inbox row read, once", async () => {
    N.useLastNotificationResponse.mockReturnValue({
      actionIdentifier: N.DEFAULT_ACTION_IDENTIFIER,
      notification: { request: { identifier: "push-1", content: { data: { link: "/portfolio/p-1/rebalance", notificationId: "n-1" } } } },
    } as never);
    const { rerender } = await renderHook(() => usePush());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/rebalance/p-1"));
    expect(mockApi.markNotificationsRead).toHaveBeenCalledWith({ ids: ["n-1"] });
    await rerender({});
    expect(router.push).toHaveBeenCalledTimes(1);
    N.useLastNotificationResponse.mockReturnValue(null);
  });

  it("the Profile switch turns push on; the Alerts banner hides once it is on", async () => {
    await renderWithClient(<><PushRow /><PushBanner /></>);
    expect(await screen.findByText("Get alerts on this phone")).toBeOnTheScreen();
    await fireEvent(screen.getByLabelText("Push on this phone"), "valueChange", true);
    await waitFor(() => expect(mockApi.registerPushToken).toHaveBeenCalled());
  });

  it("explains why push is unavailable instead of showing a switch", async () => {
    mockProjectId = undefined;
    await renderWithClient(<PushRow />);
    expect(await screen.findByText("Push isn't set up in this build yet.")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Push on this phone")).toBeNull();
  });
});
