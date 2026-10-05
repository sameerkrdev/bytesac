import { useLocalSearchParams } from "expo-router";
import { RepairPanel } from "@/components/portfolio/repair-panel";
import { Screen } from "@/components/ui/screen";

export default function RepairScreen() {
  const { asset } = useLocalSearchParams<{ asset: string }>();
  return <Screen edges={["left", "right"]}><RepairPanel asset={asset} /></Screen>;
}
