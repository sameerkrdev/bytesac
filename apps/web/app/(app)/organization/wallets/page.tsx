"use client";

import { Callout } from "@/components/ui/kit";
import { OrgPage } from "@/components/organization/org-page";
import { PayoutWallet } from "@/components/organization/payout-wallet";

/** Where manager fees are paid. Setting or replacing the payout wallet is owner-only and needs a wallet signature. */
export default function OrganizationWalletsPage() {
  return (
    <OrgPage id="wallets-title" title="Wallets" path="/organization/wallets" description="The Solana wallet your organization's manager fees are paid to.">
      {({ org, setOrg }) => (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0"><PayoutWallet org={org} onChange={setOrg} /></div>
          <Callout tone="info" title="How the payout wallet works">
            It is verified by a signature from that wallet. Replacing it needs a new signature and a review by Bytesac, and the history is kept. It never receives investors' assets.
          </Callout>
        </div>
      )}
    </OrgPage>
  );
}
