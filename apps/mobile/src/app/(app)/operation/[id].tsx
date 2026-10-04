import { useLocalSearchParams } from "expo-router";
import { LegFlow } from "@/components/operation/leg-flow";
import { OPERATION_KIND } from "@/components/portfolio/operation-card";
import { useQuery } from "@tanstack/react-query";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";

/** One operation with its legs and explorer links; an open one can be continued (sign the next leg) or stopped. */
export default function OperationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const op = useQuery({ queryKey: ["operation", id], queryFn: () => api.getOperation(id) });
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">{op.data ? OPERATION_KIND[op.data.kind] : "Operation"}</AppText>
      <AppText tone="faint">You sign every step in your own wallets.</AppText>
      <LegFlow operationId={id} />
    </Screen>
  );
}
