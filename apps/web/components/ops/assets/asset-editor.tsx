"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_TYPE_LABEL, INSTRUMENT_STATUS_LABEL } from "@repo/app-core";
import type { OpsAssetDetail } from "@repo/validator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { OpsError } from "@/components/ops/ops-error";
import { AssetDeployments } from "./asset-deployments";
import { AssetClassification, AssetDetailsForm } from "./asset-form";
import { AssetPricing } from "./asset-pricing";
import { AssetReviewPanel } from "./asset-review-panel";
import { AssetRoutes } from "./asset-routes";
import { AssetRules } from "./asset-rules";

type Client = Pick<ApiClient,
  | "opsGetAsset" | "opsUpdateAsset" | "opsListAssetTags" | "opsListAssetIssuers" | "opsCreateAssetIssuer" | "opsCreateDeployment" | "opsUpdateDeployment" | "opsVerifyDeployment" | "opsAssetItemAction" | "opsSetFeeOnTransfer" | "opsSetPermissioned"
  | "opsCreateRoute" | "opsUpdateRoute" | "opsListAssetProviders" | "opsCreateAssetProvider" | "opsListAssets" | "opsCreateRule" | "opsUpdateRule"
  | "opsPutPriceReference" | "opsRecordNav" | "opsSubmitAsset" | "opsDecideAsset" | "opsAssetAction">;

export function AssetEditor({ id, client = api }: { id: string; client?: Client }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const key = ["ops", "asset", id];
  const query = useQuery({ queryKey: key, queryFn: () => client.opsGetAsset(id), retry: false });
  if (query.isError) return <OpsError error={query.error} />;
  const a = query.data;
  if (!a) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;

  const onChange = (d: OpsAssetDetail) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["ops", "assets"] }); };
  const isAdmin = me?.platformRoles.includes("ops_admin") ?? false;
  // Under review or retired: the API refuses every edit, so the controls are disabled.
  const locked = a.status === "UNDER_REVIEW" || a.status === "RETIRED";
  const p = { a, locked, isAdmin, onChange, client };

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory">{a.name} · {a.symbol}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge {...INSTRUMENT_STATUS_LABEL[a.status]} />
          <span className="text-sm text-stone">{ASSET_TYPE_LABEL[a.assetType]}</span>
        </div>
        {a.status === "RETIRED" && <p role="status" className="text-sm text-stone">This asset is retired and read-only.</p>}
        {a.status === "UNDER_REVIEW" && <p role="status" className="text-sm text-stone">This asset is under review and read-only until a decision is made.</p>}
      </div>
      {a.warnings.map((w) => <p key={w} role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm text-ivory">{w}</p>)}
      <AssetDetailsForm {...p} />
      <AssetClassification {...p} />
      <AssetDeployments {...p} />
      <AssetRoutes {...p} />
      <AssetRules {...p} />
      <AssetPricing {...p} />
      <AssetReviewPanel a={a} isAdmin={isAdmin} onChange={onChange} client={client} />

      <section aria-labelledby="events-h" className="space-y-3">
        <h2 id="events-h" className="font-display text-xl font-semibold text-ivory">History</h2>
        <ol className="space-y-3">
          {a.events.map((e) => (
            <li key={e.id} className={e.internalNote ? "rounded-xl border border-warning/40 bg-warning/5 p-3" : "rounded-xl border border-border-dark p-3"}>
              <p className="text-xs text-stone">
                {new Date(e.createdAt).toLocaleString()} · {e.entityType} · {e.kind.replaceAll("_", " ")}
                {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && ` · ${e.fromStatus} → ${e.toStatus}`}
              </p>
              {e.message && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory">{e.message}</p>}
              {e.internalNote && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="mr-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">Internal</span>{e.internalNote}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
