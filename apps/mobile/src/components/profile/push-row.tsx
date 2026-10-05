import { BellRing } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Switch, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { useTheme } from "@/lib/theme";

const NOTE: Partial<Record<PushState, string>> = {
  unsupported: "Push works in the iOS and Android app.",
  simulator: "Push needs a physical phone.",
  unconfigured: "Push isn't set up in this build yet.",
  denied: "Notifications are off for Bytesac in your phone's settings.",
};

/** This device's push state, refreshed on mount; `toggle` asks the OS only when turning on. */
export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushState().then(setState).catch(() => setState("off")); }, []);
  const toggle = useCallback(async (on: boolean) => {
    setBusy(true);
    try { setState(await (on ? enablePush() : disablePush())); } catch { setState("off"); } finally { setBusy(false); }
  }, []);
  return { state, busy, toggle };
}

/** Profile → Notifications: a switch for push on this phone, or why it is unavailable. */
export function PushRow() {
  const { colors } = useTheme();
  const { state, busy, toggle } = usePushState();
  if (!state) return null;
  const available = state === "on" || state === "off";
  return (
    <View className="gap-2 border-b border-line pb-4">
      <View className="min-h-11 flex-row items-center justify-between gap-4">
        <View className="flex-1">
          <AppText>Push on this phone</AppText>
          <AppText variant="label" tone="faint">{NOTE[state] ?? "Alerts for the kinds you turn on below, with the same text as your inbox."}</AppText>
        </View>
        {available ? (
          <Switch accessibilityLabel="Push on this phone" value={state === "on"} disabled={busy} onValueChange={(v) => void toggle(v)}
            trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor={colors.surface} />
        ) : null}
      </View>
      {state === "denied" ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => void Linking.openSettings()} className="min-h-11 justify-center self-start">
          <AppText tone="accent">Open settings</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Alerts: a one-time nudge to turn push on, shown only where push can work and is off. */
export function PushBanner() {
  const { colors } = useTheme();
  const { state, busy, toggle } = usePushState();
  if (state !== "off") return null;
  return (
    <View className="flex-row items-center gap-3 rounded-card border border-info/30 bg-info-soft p-4">
      <BellRing size={18} color={colors.info} />
      <View className="flex-1 gap-0.5">
        <AppText className="font-medium">Get alerts on this phone</AppText>
        <AppText variant="label" tone="muted">New versions, drift and repairs, as they happen.</AppText>
      </View>
      <Button size="sm" loading={busy} onPress={() => void toggle(true)}>Turn on</Button>
    </View>
  );
}
