import { formatRelative } from "@repo/app-core";
import type { NotificationKind, NotificationView } from "@repo/validator";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Activity, Archive, Ban, Bell, ChevronRight, CircleDashed, type LucideIcon, Pause, Play, RefreshCw, UserRound, Wrench } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { PushBanner } from "@/components/profile/push-row";
import { EmptyState, ErrorState, ErrorText, LoadingState, StaleNotice } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { mobileRoute } from "@/lib/notification-route";
import { useTheme } from "@/lib/theme";

type Tone = "info" | "warning" | "danger" | "success" | "neutral";
const KIND: Record<NotificationKind, { Icon: LucideIcon; tone: Tone }> = {
  rebalance_available: { Icon: RefreshCw, tone: "info" },
  drifted: { Icon: Activity, tone: "warning" },
  repair_required: { Icon: Wrench, tone: "danger" },
  execution_incomplete: { Icon: CircleDashed, tone: "warning" },
  basket_paused: { Icon: Pause, tone: "warning" },
  basket_unpaused: { Icon: Play, tone: "success" },
  basket_retirement_pending: { Icon: Archive, tone: "neutral" },
  basket_retired: { Icon: Archive, tone: "neutral" },
  lead_changed: { Icon: UserRound, tone: "neutral" },
  instrument_not_investable: { Icon: Ban, tone: "warning" },
};
/** Kinds that ask the user to look at a position (review, fix or continue). */
const ACTION: NotificationKind[] = ["rebalance_available", "drifted", "repair_required", "execution_incomplete"];
const SOFT: Record<Tone, string> = { info: "bg-info-soft", warning: "bg-warning-soft", danger: "bg-danger-soft", success: "bg-success-soft", neutral: "bg-surface-muted" };

type Filter = "all" | "unread" | "action";
const DAY = 86_400_000;
function group(createdAt: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = Date.parse(createdAt);
  return t >= start.getTime() ? "Today" : t >= start.getTime() - 6 * DAY ? "This week" : "Earlier";
}

function Row({ n, onOpen }: { n: NotificationView; onOpen(): void }) {
  const { colors } = useTheme();
  const k = KIND[n.kind];
  const color = k.tone === "neutral" ? colors.inkMuted : colors[k.tone];
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${n.readAt ? "" : "Unread. "}${n.title}`} onPress={onOpen}
      className={`flex-row gap-3 rounded-card border p-4 active:opacity-80 ${n.readAt ? "border-line bg-surface" : "border-info/30 bg-surface"}`}>
      <View className={`size-10 items-center justify-center rounded-tile ${SOFT[k.tone]}`}><k.Icon size={18} color={color} /></View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-start gap-2">
          <AppText className={`flex-1 ${n.readAt ? "" : "font-medium"}`}>{n.title}</AppText>
          {!n.readAt && <View accessibilityElementsHidden importantForAccessibility="no" className="mt-2 size-2 rounded-full bg-info" />}
        </View>
        <AppText variant="label" tone="muted">{n.body}</AppText>
        <AppText variant="micro" tone="faint">{formatRelative(n.createdAt)}</AppText>
      </View>
      <ChevronRight size={16} color={colors.inkFaint} style={{ alignSelf: "center" }} />
    </Pressable>
  );
}

/** The inbox: what changed in your baskets, newest first, grouped by day; each opens the matching screen and is marked read. */
export default function NotificationsScreen() {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const q = useInfiniteQuery({
    queryKey: ["notifications", "list"], queryFn: ({ pageParam }) => api.notifications({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const read = useMutation({ mutationFn: (b: { ids: string[] } | { all: true }) => api.markNotificationsRead(b), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unreadCount ?? 0;
  const shown = items.filter((n) => filter === "all" || (filter === "unread" ? !n.readAt : ACTION.includes(n.kind)));
  const groups = ["Today", "This week", "Earlier"].map((g) => [g, shown.filter((n) => group(n.createdAt) === g)] as const).filter(([, l]) => l.length > 0);

  return (
    <Screen tabBarInset title="Alerts" description={unread > 0 ? `${unread} unread` : "Changes to your baskets and the steps you started."}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.ink} />}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} />
        <Chip label="Unread" selected={filter === "unread"} onPress={() => setFilter("unread")} />
        <Chip label="Needs action" selected={filter === "action"} onPress={() => setFilter("action")} />
        {unread > 0 && <Button variant="ghost" size="sm" className="ml-auto" loading={read.isPending} onPress={() => read.mutate({ all: true })}>Mark all read</Button>}
      </View>
      <PushBanner />
      {q.isPending && <LoadingState />}
      {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && q.data && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      <ErrorText error={read.error} />
      {q.data && items.length === 0 && (
        <View className="items-center gap-3 py-10">
          <View className="size-14 items-center justify-center rounded-pill bg-surface-muted"><Bell size={22} color={colors.inkFaint} /></View>
          <EmptyState title="Nothing yet." />
        </View>
      )}
      {q.data && items.length > 0 && shown.length === 0 && <AppText tone="muted">{filter === "unread" ? "You're all caught up." : "Nothing needs your action."}</AppText>}
      {groups.map(([g, list]) => (
        <View key={g} className="gap-2">
          <AppText variant="eyebrow" tone="faint" accessibilityRole="header">{g}</AppText>
          {list.map((n) => <Row key={n.id} n={n} onOpen={() => { if (!n.readAt) read.mutate({ ids: [n.id] }); router.push(mobileRoute(n.link)); }} />)}
        </View>
      ))}
      {q.hasNextPage && <Button variant="secondary" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()}>Load more</Button>}
    </Screen>
  );
}
