import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { mobileRoute } from "@/lib/notification-route";
import { NATIVE, pushBlocker, register, stored } from "@/lib/push";

/** The tap hook exists on iOS and Android only; picked once so the hook order never changes. */
const useLastResponse = NATIVE ? Notifications.useLastNotificationResponse : () => null;

/**
 * While signed in: re-registers an enabled device (Expo tokens can rotate) and opens the matching screen when a push is
 * tapped, marking its inbox row read. Mount once inside the signed-in stack.
 */
export function usePush() {
  const handled = useRef<string | null>(null);
  const last = useLastResponse();
  useEffect(() => {
    if (!NATIVE || pushBlocker()) return;
    void (async () => {
      if ((await stored()) && (await Notifications.getPermissionsAsync()).status === "granted") await register().catch(() => undefined);
    })();
  }, []);
  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = last.notification.request.content.data as { link?: unknown; notificationId?: unknown } | undefined;
    if (typeof data?.notificationId === "string") void api.markNotificationsRead({ ids: [data.notificationId] }).catch(() => undefined);
    if (typeof data?.link === "string") router.push(mobileRoute(data.link));
  }, [last]);
}
