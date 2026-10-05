import { ApiError } from "@repo/api-client";
import type { DiscoveryFilters } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react-native";
import { Fragment, useState } from "react";
import { View } from "react-native";
import { BasketRow } from "@/components/basket/basket-card";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const MODE_LABEL = { tool: "Matched by filters", semantic: "Closest in meaning", keyword: "Keyword match" } as const;

/** Search in your own words. The result is shown as is; "Use these filters" hands the AI structured filters to the filter search. */
export function AiSearch({ onUseFilters }: { onUseFilters(f: DiscoveryFilters): void }) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const search = useMutation({ mutationFn: (q: string) => api.aiSearchBaskets(q) });
  const rateLimited = search.error instanceof ApiError && (search.error.status === 429 || search.error.code === "RATE_LIMITED");
  return (
    <View className="gap-3 rounded-card border border-glass-line bg-glass p-5">
      <View className="flex-row items-center gap-2">
        <Sparkles size={16} color={colors.accent} />
        <AppText variant="heading" accessibilityRole="header">Describe what you want</AppText>
      </View>
      <TextField label="Search in your own words" value={query} onChangeText={setQuery} maxLength={500} multiline placeholder="Low-fee stablecoin baskets with a monthly review" />
      <Button disabled={!query.trim()} loading={search.isPending} onPress={() => search.mutate(query.trim())}>Search</Button>
      <AppText variant="micro" tone="faint">Queries are processed by Google Gemini. Results are filters and baskets, not advice.</AppText>
      {rateLimited ? <AppText accessibilityRole="alert" tone="danger">Too many searches. Try again later.</AppText> : <ErrorText error={search.error} />}
      {search.data && (
        <View className="gap-2 border-t border-line pt-3">
          <View className="flex-row items-center justify-between gap-3">
            <AppText variant="eyebrow" tone="muted" accessibilityRole="header">{MODE_LABEL[search.data.mode]}</AppText>
            {search.data.filters ? <Button variant="secondary" size="sm" onPress={() => { onUseFilters(search.data.filters!); search.reset(); }}>Use these filters</Button> : null}
          </View>
          {search.data.results.length === 0 ? <AppText tone="faint">No baskets match. Try different words.</AppText>
            : search.data.results.map((b, i) => <Fragment key={b.slug}>{i > 0 ? <View className="h-px bg-line" /> : null}<BasketRow b={b} /></Fragment>)}
        </View>
      )}
    </View>
  );
}
