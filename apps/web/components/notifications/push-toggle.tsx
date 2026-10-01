"use client";

import { deleteToken, getToken } from "firebase/messaging";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { getPushMessaging, serviceWorkerUrl, vapidKey } from "@/lib/firebase";

type Messaging = NonNullable<Awaited<ReturnType<typeof getPushMessaging>>>;
const ON = "bytesac.push";
const remembered = () => { try { return localStorage.getItem(ON) === "1"; } catch { return false; } };
const remember = (on: boolean) => { try { if (on) localStorage.setItem(ON, "1"); else localStorage.removeItem(ON); } catch { /* the toggle still works for this visit */ } };

/** Browser push on this device. Hidden when the browser cannot do it or Firebase is not configured. */
export function PushToggle() {
  const [messaging, setMessaging] = useState<Messaging | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getPushMessaging().then((m) => { setMessaging(m); setOn(m !== null && Notification.permission === "granted" && remembered()); }).catch(() => undefined);
  }, []);
  if (!messaging) return null;

  async function toggle(next: boolean) {
    if (!messaging) return;
    setBusy(true);
    setError(null);
    try {
      if (next && (await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked in this browser. Allow them in the browser settings to turn this on.");
      const serviceWorkerRegistration = await navigator.serviceWorker.register(serviceWorkerUrl);
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration });
      if (next) await api.registerPushToken({ token, userAgent: navigator.userAgent.slice(0, 300) });
      else { await api.revokePushToken(token); await deleteToken(messaging); }
      remember(next);
      setOn(next);
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : toDisplayError(e).title);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <div>
          <Label htmlFor="push-toggle" className="text-sm text-ivory">Push notifications on this device</Label>
          <p className="text-xs text-stone">Basket updates and wallet alerts, even when Bytesac is closed</p>
        </div>
        <Switch id="push-toggle" aria-label="Push notifications on this device" checked={on} disabled={busy} onCheckedChange={(v) => void toggle(v)} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
