import { formatRelative } from "@repo/app-core";
import { palette } from "@repo/design-tokens";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, RefreshControl, View } from "react-native";
import { EmptyState, ErrorState, ErrorText, LoadingState, StaleNotice } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { mobileRoute } from "@/lib/notification-route";

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ["notifications", "list"], queryFn: ({ pageParam }) => api.notifications({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const read = useMutation({ mutationFn: (b: { ids: string[] } | { all: true }) => api.markNotificationsRead(b), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unreadCount ?? 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={palette.mint} />}>
      <AppText variant="h1" accessibilityRole="header">Notifications</AppText>
      {unread > 0 && <Button variant="secondary" loading={read.isPending} onPress={() => read.mutate({ all: true })}>Mark all read</Button>}
      {q.isPending && <LoadingState />}
      {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && q.data && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      <ErrorText error={read.error} />
      {q.data && items.length === 0 && <EmptyState title="Nothing yet." />}
      {items.map((n) => (
        <Pressable key={n.id} accessibilityRole="link" accessibilityLabel={`${n.readAt ? "" : "Unread. "}${n.title}`} className="gap-1 border-b border-border-dark pb-3"
          onPress={() => { if (!n.readAt) read.mutate({ ids: [n.id] }); router.push(mobileRoute(n.link)); }}>
          <View className="flex-row items-center gap-2">
            {!n.readAt && <View accessibilityElementsHidden importantForAccessibility="no" className="size-2 rounded-full bg-mint" />}
            <AppText className="flex-1 font-sans-semibold">{n.title}</AppText>
          </View>
          <AppText tone="stone">{n.body}</AppText>
          <AppText variant="label" tone="stone">{formatRelative(n.createdAt)}</AppText>
        </Pressable>
      ))}
      {q.hasNextPage && <Button variant="secondary" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()}>Load more</Button>}
    </Screen>
  );
}
