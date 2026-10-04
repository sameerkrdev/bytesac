"use client";

import type { ApiClient } from "@repo/api-client";
import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core";
import { basketCategorySchema, createBasketRequestSchema, type BasketCategory, type BasketSummary, type OrganizationDetail } from "@repo/validator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/layout/states";

type Client = Pick<ApiClient, "listOrgBaskets" | "createBasket">;

const TABS: Array<{ id: string; label: string; match(b: BasketSummary): boolean }> = [
  { id: "drafts", label: "Drafts", match: (b) => b.openVersionStatus === "draft" },
  { id: "review", label: "In review", match: (b) => b.openVersionStatus === "in_review" || b.openVersionStatus === "approved" },
  { id: "changes", label: "Changes required", match: (b) => b.openVersionStatus === "changes_required" },
  { id: "active", label: "Active", match: (b) => b.status === "ACTIVE" },
  { id: "paused", label: "Paused", match: (b) => ["PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING"].includes(b.status) },
  { id: "retired", label: "Retired", match: (b) => b.status === "RETIRED" || b.status === "REJECTED" },
];

export function Baskets({ org, client = api }: { org: OrganizationDetail; client?: Client }) {
  const id = useId();
  const router = useRouter();
  const [tab, setTab] = useState(TABS[0]!);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<BasketCategory>("multi_asset");
  const list = useQuery({ queryKey: ["organization", org.id, "baskets"], queryFn: () => client.listOrgBaskets(org.id), retry: false });
  const create = useMutation({ mutationFn: () => client.createBasket(org.id, createBasketRequestSchema.parse({ name, category })), onSuccess: (b) => router.push(`/organization/baskets/${b.id}`) });
  const canCreate = org.myPermissions.includes("baskets.manage") && org.status === "VERIFIED";
  const items = list.data?.baskets.filter(tab.match) ?? [];

  return (
    <section id="baskets" aria-labelledby={`${id}-h`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-h`} className="sr-only">Baskets</h3>
        <div role="group" aria-label="Basket status" className="flex gap-1 overflow-x-auto rounded-pill border border-line bg-surface p-1 [scrollbar-width:none]">
          {TABS.map((t) => {
            const n = list.data?.baskets.filter(t.match).length ?? 0;
            return (
              <button key={t.id} type="button" aria-pressed={tab.id === t.id} onClick={() => setTab(t)} className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium whitespace-nowrap text-ink-muted hover:text-ink", tab.id === t.id && "bg-primary text-primary-ink hover:text-primary-ink")}>
                {t.label}{n > 0 && <span aria-hidden className={cn("font-mono text-[0.625rem]", tab.id === t.id ? "text-primary-ink/70" : "text-ink-faint")}>{n}</span>}
              </button>
            );
          })}
        </div>
        {canCreate && <Button size="sm" onClick={() => setOpen(true)}>Create basket</Button>}
      </div>
      {list.isError ? <p role="alert" className="text-sm text-danger">{toDisplayError(list.error).title}</p> : list.isPending ? <LoadingState /> : items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong px-5 py-8 text-sm text-ink-muted">No baskets here.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          <li aria-hidden className="hidden grid-cols-[minmax(0,1.6fr)_8rem_minmax(0,1fr)_7rem_3rem] gap-4 bg-surface-muted/60 px-5 py-2.5 text-[0.6875rem] text-ink-faint md:grid"><span>Basket</span><span>Category</span><span>Status</span><span>Updated</span><span /></li>
          {items.map((b) => (
            <li key={b.id} className="grid items-center gap-x-4 gap-y-1 px-5 py-4 md:grid-cols-[minmax(0,1.6fr)_8rem_minmax(0,1fr)_7rem_3rem]">
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{b.name}</span><span className="block text-xs text-ink-muted">{b.currentVersionNumber ? `Published version ${b.currentVersionNumber}` : "Not published"} · updated {new Date(b.updatedAt).toLocaleDateString()}</span></span>
              <span className="text-xs text-ink-muted">{BASKET_CATEGORY_LABEL[b.category]}</span>
              <span><StatusBadge {...BASKET_STATUS_LABEL[b.status]} /></span>
              <span className="font-mono text-xs text-ink-faint">{new Date(b.updatedAt).toLocaleDateString()}</span>
              <Link href={`/organization/baskets/${b.id}`} aria-label={`Open ${b.name}`} className="justify-self-start text-sm text-ink underline-offset-4 hover:underline md:justify-self-end">Open</Link>
            </li>
          ))}
        </ul>
      )}

      {!canCreate && <p className="text-xs text-ink-muted">{org.status !== "VERIFIED" ? "Your organization must be verified to create baskets." : "You need basket access to create baskets. Ask an owner or admin."}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-ink">Create basket</DialogTitle>
            <DialogDescription>You become its lead manager. Nothing is public until Bytesac approves and you publish.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="space-y-1">
              <Label htmlFor={`${id}-n`} className="text-xs font-medium text-ink">Name</Label>
              <Input id={`${id}-n`} value={name} minLength={3} maxLength={80} required onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-c`} className="text-xs font-medium text-ink">Category</Label>
              <Select id={`${id}-c`} value={category} onChange={(e) => setCategory(basketCategorySchema.parse(e.target.value))}>
                {basketCategorySchema.options.map((c) => <option key={c} value={c}>{BASKET_CATEGORY_LABEL[c]}</option>)}
              </Select>
            </div>
            {create.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(create.error).title}</span> {toDisplayError(create.error).message}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary"  onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit"  disabled={create.isPending || name.trim().length < 3}>{create.isPending && <Loader2 aria-hidden className="animate-spin" />}Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
