"use client";

import { uncoveredChains } from "@repo/app-core";
import { ASSET_CHAINS, type OperationView } from "@repo/validator";
import { useMe } from "@/components/me-context";
import { Callout } from "@/components/ui/kit";

/** D-119: chains in this plan the user's linked wallet cannot sign (from the list stored at sign-in; unknown lists never warn). */
export function useUncoveredChains(plan: OperationView | null): string[] {
  const { data: me } = useMe();
  if (!plan) return [];
  const chains = plan.legs.filter((l) => l.kind !== "network_fee").flatMap((l) => [l.fromChain, l.toChain]);
  return uncoveredChains(chains, me?.wallet?.addresses ?? []).map((c) => ASSET_CHAINS[c].label);
}

/**
 * Warns before signing. An investment still proceeds (only Solana signs and the assets arrive at the same address), so it asks for an
 * explicit acknowledgement; sells, rebalances and repairs only say which wallet the steps on those chains need.
 */
export function ChainCoverageNotice({ plan, acknowledged, onAcknowledge }: { plan: OperationView; acknowledged?: boolean; onAcknowledge?(v: boolean): void }) {
  const uncovered = useUncoveredChains(plan);
  if (uncovered.length === 0) return null;
  const names = uncovered.join(", ");
  return (
    <Callout tone="warning" title={`Your wallet can't sign on ${names}`}>
      <p>
        {plan.kind === "invest"
          ? `You will still receive these assets at your same address. To sell them later you need a wallet that signs on ${names}, for example by importing your recovery phrase into a wallet that supports it.`
          : `Steps on ${names} need a wallet that signs there. Connect one for the same address (for example by importing your recovery phrase into a wallet that supports it) before those steps.`}
      </p>
      {onAcknowledge && (
        <label className="mt-3 flex cursor-pointer gap-3 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--c-primary)]" checked={!!acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
          <span>{`I understand that selling assets on ${names} needs another wallet.`}</span>
        </label>
      )}
    </Callout>
  );
}
