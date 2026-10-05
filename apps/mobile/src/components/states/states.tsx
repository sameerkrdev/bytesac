import { ActivityIndicator, View } from "react-native";
import type { ReactNode } from "react";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { displayError } from "@/lib/errors";
import { useTheme } from "@/lib/theme";

export function LoadingState() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" className="items-center py-10"><ActivityIndicator color={colors.inkMuted} /></View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <Card className="items-center gap-3"><AppText className="text-center" tone="muted">{title}</AppText>{children}</Card>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?(): void }) {
  const e = displayError(error);
  return (
    <Card className="gap-3 border-danger/40">
      <AppText accessibilityRole="alert" className="font-semibold">{e.title}</AppText>
      {e.message ? <AppText tone="faint">{e.message}</AppText> : null}
      {onRetry ? <Button variant="secondary" onPress={onRetry}>Try again</Button> : null}
    </Card>
  );
}

/** Shown above data that loaded earlier when a refresh failed. */
export const StaleNotice = ({ children }: { children: string }) => <AppText accessibilityRole="alert" tone="faint" className="rounded-control border border-warning/40 p-3">{children}</AppText>;

/** An inline action error (mutations). */
export const ErrorText = ({ error }: { error: unknown }) => {
  if (!error) return null;
  const e = displayError(error);
  return <View accessible accessibilityRole="alert" className="gap-1 rounded-control border border-danger/40 p-3"><AppText className="font-semibold">{e.title}</AppText>{e.message ? <AppText tone="faint">{e.message}</AppText> : null}</View>;
};
