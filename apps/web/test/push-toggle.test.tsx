import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./invest-fixtures";

const getPushMessaging = vi.fn();
const getToken = vi.fn();
const deleteToken = vi.fn();
const registerPushToken = vi.fn().mockResolvedValue(undefined);
const revokePushToken = vi.fn().mockResolvedValue(undefined);
vi.mock("firebase/messaging", () => ({ getToken: (...a: unknown[]) => getToken(...a), deleteToken: (...a: unknown[]) => deleteToken(...a) }));
vi.mock("@/lib/firebase", () => ({ getPushMessaging: () => getPushMessaging(), serviceWorkerUrl: "/firebase-messaging-sw.js?x=1", vapidKey: "vapid" }));
vi.mock("@/lib/api", () => ({ api: { registerPushToken: (b: unknown) => registerPushToken(b), revokePushToken: (t: string) => revokePushToken(t) } }));
import { PushToggle } from "@/components/notifications/push-toggle";

const messaging = { app: "m" };
const registration = { scope: "/" };
const requestPermission = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  requestPermission.mockResolvedValue("granted");
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: { permission: "default", requestPermission } });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn().mockResolvedValue(registration) } });
  getToken.mockResolvedValue("tok-1");
});

describe("PushToggle", () => {
  it("is hidden without Firebase config or browser support", async () => {
    getPushMessaging.mockResolvedValue(null);
    renderApp(<PushToggle />);
    await waitFor(() => expect(getPushMessaging).toHaveBeenCalled());
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("enabling asks permission, gets a token with the VAPID key and service worker, and registers it", async () => {
    getPushMessaging.mockResolvedValue(messaging);
    renderApp(<PushToggle />);
    await userEvent.click(await screen.findByRole("switch", { name: "Push notifications on this device" }));
    await waitFor(() => expect(registerPushToken).toHaveBeenCalledWith(expect.objectContaining({ token: "tok-1" })));
    expect(requestPermission).toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledWith(messaging, { vapidKey: "vapid", serviceWorkerRegistration: registration });
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  });

  it("a blocked permission registers nothing and explains", async () => {
    getPushMessaging.mockResolvedValue(messaging);
    requestPermission.mockResolvedValue("denied");
    renderApp(<PushToggle />);
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("blocked");
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it("disabling revokes the token on the server and deletes it in the browser", async () => {
    getPushMessaging.mockResolvedValue(messaging);
    (Notification as unknown as { permission: string }).permission = "granted";
    localStorage.setItem("bytesac.push", "1");
    renderApp(<PushToggle />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeChecked());
    await userEvent.click(toggle);
    await waitFor(() => expect(revokePushToken).toHaveBeenCalledWith("tok-1"));
    expect(deleteToken).toHaveBeenCalledWith(messaging);
  });
});
