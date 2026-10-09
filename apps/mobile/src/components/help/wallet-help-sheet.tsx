import { WALLET_HELP } from "@repo/app-core";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";

/** The wallet FAQ as a list of disclosures; `topic` is the question shown open first. */
export function WalletHelpSheet({ visible, onClose, topic }: { visible: boolean; onClose(): void; topic?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState<string | null>(topic ?? null);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOpen(topic ?? null);
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="How wallets work">
      {WALLET_HELP.map((h) => {
        const expanded = open === h.id;
        const Chevron = expanded ? ChevronDown : ChevronRight;
        return (
          <View key={h.id} className="gap-2 border-t border-line pt-3">
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : h.id)} className="min-h-11 flex-row items-center gap-3">
              <AppText variant="heading" className="flex-1">{h.question}</AppText>
              <Chevron size={18} color={colors.inkMuted} />
            </Pressable>
            {expanded && h.answer.map((p) => <AppText key={p} tone="muted">{p}</AppText>)}
          </View>
        );
      })}
    </Sheet>
  );
}

/** A "How wallets work" button that opens the help sheet on the given question. */
export function WalletHelpLink({ topic }: { topic: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onPress={() => setVisible(true)}>How wallets work</Button>
      <WalletHelpSheet visible={visible} onClose={() => setVisible(false)} topic={topic} />
    </>
  );
}
