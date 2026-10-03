import { ApiError } from "@repo/api-client";
import type { DiscoveryFilters } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { ResultCard } from "./result-card";

const MODE_LABEL = { tool: "Matched by filters", semantic: "Closest in meaning", keyword: "Keyword match" } as const;

/** Search in your own words. The result is shown as is; "Use these filters" hands the AI structured filters to the filter search. */
export function AiSearch({ onUseFilters }: { onUseFilters(f: DiscoveryFilters): void }) {
  const [query, setQuery] = useState("");
  const search = useMutation({ mutationFn: (q: string) => api.aiSearchBaskets(q) });
  const rateLimited = search.error instanceof ApiError && (search.error.status === 429 || search.error.code === "RATE_LIMITED");
  return (
    <Card className="gap-3">
      <AppText variant="h4" accessibilityRole="header">Describe what you want</AppText>
      <TextField label="Search in your own words" value={query} onChangeText={setQuery} maxLength={500} multiline placeholder="Low-fee stablecoin baskets with a monthly review" />
      <Button disabled={!query.trim()} loading={search.isPending} onPress={() => search.mutate(query.trim())}>Search</Button>
      <AppText variant="label" tone="stone">Queries are processed by Google Gemini.</AppText>
      {rateLimited ? <AppText accessibilityRole="alert" tone="danger">Too many searches. Try again later.</AppText> : <ErrorText error={search.error} />}
      {search.data && (
        <View className="gap-3">
          <AppText accessibilityRole="header" className="font-sans-semibold">{MODE_LABEL[search.data.mode]}</AppText>
          {search.data.filters ? <Button variant="secondary" onPress={() => { onUseFilters(search.data.filters!); search.reset(); }}>Use these filters</Button> : null}
          {search.data.results.length === 0 ? <AppText tone="stone">No baskets match. Try different words.</AppText> : search.data.results.map((b) => <ResultCard key={b.slug} item={b} />)}
        </View>
      )}
    </Card>
  );
}
