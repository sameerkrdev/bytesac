import { shortAddress } from "@repo/app-core";
import type { MeResponse } from "@repo/validator";
import { Linking } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WEB_HANDOFF_TEXT, webUrl } from "@/lib/web-url";

/** Bitcoin is linked on the web: mobile signs no Bitcoin message or PSBT. */
export function BitcoinSection({ me }: { me: MeResponse }) {
  const profileUrl = webUrl("/profile");
  const linked = me.wallet.addresses.find((a) => a.chain === "bitcoin" && a.status === "active");
  return (
    <Card className="gap-3">
      <AppText variant="h3" accessibilityRole="header">Bitcoin wallet</AppText>
      <AppText tone="muted">Needed to invest in baskets that hold Bitcoin. Linking and signing Bitcoin steps happen on the web.</AppText>
      {linked
        ? <AppText>Linked {shortAddress(linked.address)}</AppText>
        : profileUrl
          ? <Button variant="secondary" onPress={() => void Linking.openURL(profileUrl)}>Link Bitcoin on web</Button>
          : <AppText tone="stone">{WEB_HANDOFF_TEXT}</AppText>}
    </Card>
  );
}

/** Managers and ops work on the web; the server stays the authority (this card is only a pointer). */
export function ManageOnWebCard({ me }: { me: MeResponse }) {
  const manager = me.organizations.some((o) => o.membershipStatus === "ACTIVE");
  const ops = me.platformRoles.length > 0;
  const url = webUrl(manager ? "/organization" : "/ops/applications");
  if (!manager && !ops) return null;
  return (
    <Card className="gap-3">
      <AppText variant="h3" accessibilityRole="header">Manage on web</AppText>
      <AppText tone="muted">{manager && ops ? "Your organization, baskets, earnings and the Bytesac operations areas" : manager ? "Your organization, baskets and earnings" : "The Bytesac operations areas"} are managed on the web.</AppText>
      {url ? <Button variant="secondary" onPress={() => void Linking.openURL(url)}>Open on web</Button> : <AppText tone="stone">{WEB_HANDOFF_TEXT}</AppText>}
    </Card>
  );
}
