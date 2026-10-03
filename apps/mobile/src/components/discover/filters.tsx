import { BASKET_CATEGORY_LABEL } from "@repo/app-core";
import { basketCategorySchema, discoveryFiltersSchema, type DiscoveryFilters, type DiscoverySort } from "@repo/validator";
import { useState } from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { TextField } from "@/components/ui/text-field";

const SORTS: Record<DiscoverySort, string> = { relevance: "Relevance", newest: "Newest", return_1y: "1 y net return", return_since_launch: "Since launch", minimum_asc: "Lowest minimum", management_fee_asc: "Lowest fee" };

/** Keyword, category, sort and highest-minimum filters. Applying validates with the shared schema; the server runs the search. */
export function Filters({ filters, onApply }: { filters: DiscoveryFilters; onApply(next: DiscoveryFilters): void }) {
  const [q, setQ] = useState(filters.q ?? "");
  const [categories, setCategories] = useState<string[]>(filters.categories ?? []);
  const [sort, setSort] = useState<DiscoverySort>(filters.sort ?? "relevance");
  const [maxMin, setMaxMin] = useState(filters.maxMinimumInvestmentUsdc ?? "");
  const [invalid, setInvalid] = useState(false);
  const toggle = (c: string) => setCategories((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));

  const apply = () => {
    const parsed = discoveryFiltersSchema.safeParse({
      q: q.trim() || undefined, sort, categories: categories.length ? categories : undefined, maxMinimumInvestmentUsdc: maxMin.trim() || undefined,
    });
    setInvalid(!parsed.success);
    if (parsed.success) onApply(parsed.data);
  };
  const clear = () => { setQ(""); setCategories([]); setSort("relevance"); setMaxMin(""); setInvalid(false); onApply({}); };

  return (
    <View className="gap-4">
      <TextField label="Keywords" value={q} onChangeText={setQ} autoCorrect={false} maxLength={200} returnKeyType="search" onSubmitEditing={apply} />
      <View className="gap-2">
        <AppText variant="label">Category</AppText>
        <View className="flex-row flex-wrap gap-2">
          {basketCategorySchema.options.map((c) => <Chip key={c} label={BASKET_CATEGORY_LABEL[c]} selected={categories.includes(c)} onPress={() => toggle(c)} />)}
        </View>
      </View>
      <View className="gap-2">
        <AppText variant="label">Sort by</AppText>
        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(SORTS) as DiscoverySort[]).map((k) => <Chip key={k} label={SORTS[k]} selected={sort === k} onPress={() => setSort(k)} />)}
        </View>
      </View>
      <TextField label="Highest minimum investment (USDC)" value={maxMin} onChangeText={setMaxMin} keyboardType="decimal-pad" />
      {invalid ? <AppText accessibilityRole="alert" tone="danger">Check the filters: use a valid amount.</AppText> : null}
      <Button onPress={apply}>Apply filters</Button>
      <Button variant="secondary" onPress={clear}>Clear all</Button>
    </View>
  );
}
