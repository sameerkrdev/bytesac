import { useLocalSearchParams } from "expo-router";
import { LegFlow } from "@/components/operation/leg-flow";
import { OPERATION_KIND } from "@/components/portfolio/operation-card";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";

/** One operation with its legs and explorer links; an open one can be continued (sign the next leg) or stopped. */
export default function OperationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const op = useQuery({ queryKey: ["operation", id], queryFn: () => api.getOperation(id) });
  const started = op.data ? new Date(op.data.createdAt).toLocaleString() : null;
  return (
    <Screen edges={["left", "right"]} eyebrow={started ?? "Operation"} title={op.data ? OPERATION_KIND[op.data.kind] : "Operation"}
      description="You sign every step in your own wallets.">
      <LegFlow operationId={id} />
    </Screen>
  );
}
