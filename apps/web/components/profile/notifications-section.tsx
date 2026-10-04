"use client";

import { ApiError } from "@repo/api-client";
import { describeError } from "@repo/app-core";
import type { NotificationPreferences } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PushToggle } from "@/components/notifications/push-toggle";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

const ITEMS: Array<{ key: keyof NotificationPreferences; label: string; hint: string }> = [
  { key: "rebalance", label: "Rebalances", hint: "New basket versions you can apply or skip" },
  { key: "portfolioUpdates", label: "Portfolio updates", hint: "Drift and execution status" },
  { key: "managerUpdates", label: "Manager updates", hint: "Strategy and commentary from managers" },
  { key: "offers", label: "Offers", hint: "Promotions and offers" },
  { key: "productUpdates", label: "Product updates", hint: "New Bytesac features" },
  { key: "marketing", label: "Marketing", hint: "News and campaigns" },
];

export function NotificationsSection() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["prefs"], queryFn: () => api.getPreferences() });
  const m = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => api.updatePreferences(patch),
    onSuccess: (next) => qc.setQueryData(["prefs"], next),
  });

  return (
    <section aria-labelledby="notif-title" className="space-y-4 rounded-card border border-line bg-surface p-6">
      <h2 id="notif-title" className="type-heading text-ink">Notifications</h2>
      {isLoading && <p className="text-sm text-ink-muted">Loading preferences…</p>}
      {isError && <p role="alert" className="text-sm text-danger">Couldn't load preferences. Refresh to try again.</p>}
      {data && (
        <ul className="space-y-3">
          {ITEMS.map((it) => (
            <li key={it.key} className="flex min-h-11 items-center justify-between gap-4">
              <div>
                <Label htmlFor={`pref-${it.key}`} className="text-sm text-ink">{it.label}</Label>
                <p className="text-xs text-ink-muted">{it.hint}</p>
              </div>
              <Switch id={`pref-${it.key}`} aria-label={it.label} checked={data[it.key]} disabled={m.isPending}
                onCheckedChange={(v) => m.mutate({ [it.key]: v })} />
            </li>
          ))}
        </ul>
      )}
      <PushToggle />
      {m.isError && <p role="alert" className="text-sm text-danger">{describeError(m.error instanceof ApiError ? m.error.code : "INTERNAL").title}</p>}
      <p className="text-xs text-ink-muted">Security and account notices are always sent.</p>
    </section>
  );
}
