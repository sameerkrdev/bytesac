"use client";

import { shortAddress } from "@repo/app-core";
import { CHAINS, type AssetChain } from "@repo/validator";
import { useEffect, useState } from "react";

export type Choice = { chain: AssetChain; state: "available" | "linked-here" | "linked-elsewhere"; walletName: string | null; preselected: boolean };

/** D-120: which chains this wallet should serve. Linked chains are shown, not selectable; one signature links the ticked ones. */
export function ChainPicker({ walletName, address, choices, onChange }: { walletName: string | null; address: string; choices: Choice[]; onChange(chains: AssetChain[]): void }) {
  const [picked, setPicked] = useState<AssetChain[]>(() => choices.filter((c) => c.preselected).map((c) => c.chain));
  useEffect(() => { onChange(picked); }, [picked, onChange]);
  return (
    <fieldset className="space-y-1 rounded-tile border border-line bg-surface-muted p-4">
      <legend className="px-1 text-sm font-medium text-ink">{`Use ${walletName ?? "this wallet"} (${shortAddress(address)}) for:`}</legend>
      {choices.map((c) => (
        <label key={c.chain} className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--c-primary)]" disabled={c.state !== "available"}
            checked={c.state === "linked-here" || picked.includes(c.chain)}
            onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.chain] : p.filter((x) => x !== c.chain)))} aria-label={CHAINS[c.chain].label} />
          <span>{CHAINS[c.chain].label}</span>
          {c.state === "linked-elsewhere" && <span className="text-ink-faint">{`linked to ${c.walletName ?? "another wallet"}`}</span>}
          {c.state === "linked-here" && <span className="text-ink-faint">already linked</span>}
        </label>
      ))}
    </fieldset>
  );
}
