"use client";

import type { ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL, PERMISSION_INFO } from "@repo/app-core/membership-status";
import {
  ORGANIZATION_PERMISSIONS, allowedCustomPermissions, customRoleProblems,
  type CustomRoleView, type ListRolesResponse, type MembershipRole, type OrganizationDetail, type OrganizationPermission,
} from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Eye, KeyRound, Minus, PencilLine, Plus, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChoiceCard, Field, StepForm } from "@/components/ui/step-form";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Client = Pick<ApiClient, "listOrganizationRoles" | "createOrganizationRole" | "updateOrganizationRole" | "archiveOrganizationRole">;
type Base = Exclude<MembershipRole, "OWNER">;
const BASES: Base[] = ["ADMIN", "MANAGER", "ANALYST", "VIEWER"];
const GROUPS: { kind: "see" | "change" | "owner"; title: string; icon: typeof Eye }[] = [
  { kind: "see", title: "Can see", icon: Eye }, { kind: "change", title: "Can change", icon: PencilLine }, { kind: "owner", title: "Owner only", icon: ShieldCheck },
];
const BASE_NOTE: Record<Base, string> = {
  ADMIN: "Can be given team management and basket work. Needs Bytesac verification.",
  MANAGER: "Can be given basket work. Needs Bytesac verification.",
  ANALYST: "Read-only, plus optional earnings. No verification needed.",
  VIEWER: "Read-only. No verification needed.",
};
const byPermissionOrder = (a: OrganizationPermission, b: OrganizationPermission) => ORGANIZATION_PERMISSIONS.indexOf(a) - ORGANIZATION_PERMISSIONS.indexOf(b);

/** Who can see what and who can change what: the built-in matrix, the organization's custom roles, and (owner) their editor. */
export function Roles({ org, client = api }: { org: OrganizationDetail; client?: Client }) {
  const qc = useQueryClient();
  const key = ["organization", org.id, "roles"];
  const roles = useQuery({ queryKey: key, queryFn: () => client.listOrganizationRoles(org.id), retry: false });
  const owner = org.myPermissions.includes("members.manage_admins");
  const [editing, setEditing] = useState<CustomRoleView | "new" | null>(null);
  const [archiving, setArchiving] = useState<CustomRoleView | null>(null);
  const done = (d: ListRolesResponse) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["organization", org.id, "members"] }); setEditing(null); setArchiving(null); };
  const archive = useMutation({ mutationFn: (rid: string) => client.archiveOrganizationRole(org.id, rid), onSuccess: done });

  if (roles.isPending) return <LoadingState rows={4} />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />;
  const data = roles.data;

  return (
    <div className="space-y-12">
      <Matrix data={data} />

      <section aria-labelledby="custom-roles-title" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 id="custom-roles-title" className="type-heading text-ink">Custom roles</h2>
            <p className="max-w-2xl text-sm text-ink-muted">Start from a built-in role and keep only what someone needs, or add read access to earnings or adoption. Changing things always comes from the base role, so verification still applies.</p>
          </div>
          {owner && <Button onClick={() => setEditing("new")}><Plus />New role</Button>}
        </div>
        {!owner && <p className="text-sm text-ink-muted">Only the owner can create or change roles. Members who manage the team can give people a role on the <Link href={`/organization/members?org=${org.id}`} className="text-ink underline underline-offset-4">Team</Link> page.</p>}
        {data.custom.length === 0 ? (
          <EmptyState title="No custom roles yet" icon={<KeyRound className="size-5" />}>Everyone uses one of the five built-in roles.</EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {data.custom.map((r) => (
              <li key={r.id} className="flex flex-col rounded-card border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-medium text-ink">{r.name}</h3>
                    <p className="mt-0.5 text-xs text-ink-muted">Based on {MEMBERSHIP_ROLE_LABEL[r.baseRole]}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 text-xs text-ink-muted"><Users aria-hidden className="size-3.5" />{r.memberCount}</span>
                </div>
                {r.description && <p className="mt-3 text-sm text-ink-muted">{r.description}</p>}
                <ul aria-label={`${r.name} permissions`} className="mt-4 flex flex-wrap gap-1.5">
                  {[...r.permissions].sort(byPermissionOrder).map((p) => <li key={p} className="rounded-pill border border-line px-2.5 py-1 text-xs text-ink">{PERMISSION_INFO[p].label}</li>)}
                </ul>
                {owner && (
                  <div className="mt-auto flex gap-2 pt-5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}><PencilLine />Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setArchiving(r)}><Archive />Archive</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl border-line bg-canvas">
          {editing === "new" && <CreateRole org={org} client={client} onDone={done} />}
          {editing && editing !== "new" && <EditRole org={org} role={editing} client={client} onDone={done} />}
        </DialogContent>
      </Dialog>

      <Dialog open={archiving !== null} onOpenChange={(o) => { if (!o) setArchiving(null); }}>
        <DialogContent className="border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">Archive “{archiving?.name}”?</DialogTitle>
            <DialogDescription>{archiving?.memberCount ? `${archiving.memberCount} member${archiving.memberCount === 1 ? "" : "s"} will go back to the ${MEMBERSHIP_ROLE_LABEL[archiving.baseRole]} role's permissions.` : "No one holds this role."} The change history is kept.</DialogDescription>
          </DialogHeader>
          {archive.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(archive.error).message}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setArchiving(null)}>Keep</Button>
            <Button variant="destructive" disabled={archive.isPending} onClick={() => archiving && archive.mutate(archiving.id)}>Archive role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Rows: permissions grouped by see / change / owner-only. Columns: built-in roles, then custom ones. */
function Matrix({ data }: { data: ListRolesResponse }) {
  const columns: { key: string; title: string; sub?: string; has: Set<string> }[] = [
    ...data.builtIn.map((b) => ({ key: b.role, title: MEMBERSHIP_ROLE_LABEL[b.role], has: new Set<string>(b.permissions) })),
    ...data.custom.map((c) => ({ key: c.id, title: c.name, sub: `on ${MEMBERSHIP_ROLE_LABEL[c.baseRole]}`, has: new Set<string>(c.permissions) })),
  ];
  return (
    <section aria-labelledby="matrix-title" className="space-y-4">
      <div className="space-y-1">
        <h2 id="matrix-title" className="type-heading text-ink">Who can see and change what</h2>
        <p className="max-w-2xl text-sm text-ink-muted">Bytesac checks these on its servers for every request; hiding a button is only a convenience. Basket actions also depend on each basket's assignments.</p>
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">Permissions by role</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left text-xs font-normal text-ink-faint">Permission</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-3 text-center align-bottom">
                  <span className="block text-xs font-medium text-ink">{c.title}</span>
                  {c.sub && <span className="block text-[0.6875rem] font-normal text-ink-faint">{c.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g.kind}>
              <tr className="bg-surface-muted/60">
                <th scope="colgroup" colSpan={columns.length + 1} className="sticky left-0 px-4 py-2 text-left">
                  <span className="inline-flex items-center gap-2 type-eyebrow text-ink-muted"><g.icon aria-hidden className="size-3.5" />{g.title}</span>
                </th>
              </tr>
              {ORGANIZATION_PERMISSIONS.filter((p) => PERMISSION_INFO[p].kind === g.kind).map((p) => (
                <tr key={p} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 max-w-[16rem] bg-surface px-4 py-3 text-left font-normal">
                    <span className="block text-ink">{PERMISSION_INFO[p].label}</span>
                    <span className="block text-xs text-ink-muted">{PERMISSION_INFO[p].detail}</span>
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-3 text-center">
                      {c.has.has(p)
                        ? <span className="inline-grid size-6 place-items-center rounded-full bg-success-soft text-success"><Check aria-hidden className="size-3.5" /><span className="sr-only">Yes</span></span>
                        : <span className="inline-grid size-6 place-items-center text-ink-faint"><Minus aria-hidden className="size-3.5" /><span className="sr-only">No</span></span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

/** Toggle list of the permissions a role on `base` may hold; others are shown disabled with the reason. */
function PermissionPicker({ base, value, onChange, error }: { base: Base; value: OrganizationPermission[]; onChange(v: OrganizationPermission[]): void; error?: string }) {
  const allowed = new Set(allowedCustomPermissions(base));
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Permissions</legend>
      {ORGANIZATION_PERMISSIONS.map((p) => {
        const ok = allowed.has(p);
        const on = value.includes(p);
        const locked = p === "org.read";
        const reason = PERMISSION_INFO[p].kind === "owner" ? "Stays with the owner" : !ok ? `Needs a higher base role than ${MEMBERSHIP_ROLE_LABEL[base]}` : locked ? "Every role has this" : null;
        return (
          <label key={p} className={cn("flex items-start gap-3 rounded-tile border px-4 py-3 transition-colors", on ? "border-primary/60 bg-surface" : "border-line bg-surface", (!ok || locked) ? "cursor-not-allowed" : "cursor-pointer hover:border-line-strong")}>
            <input type="checkbox" className="mt-1 size-4 accent-[var(--c-primary)]" checked={on} disabled={!ok || locked}
              onChange={(e) => onChange(e.target.checked ? [...value, p].sort(byPermissionOrder) : value.filter((x) => x !== p))} />
            <span className={cn("min-w-0", !ok && "opacity-55")}>
              <span className="block text-sm text-ink">{PERMISSION_INFO[p].label}</span>
              <span className="block text-xs text-ink-muted">{PERMISSION_INFO[p].detail}</span>
              {reason && <span className="mt-1 block text-[0.6875rem] text-ink-faint">{reason}</span>}
            </span>
          </label>
        );
      })}
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

function CreateRole({ org, client, onDone }: { org: OrganizationDetail; client: Client; onDone(d: ListRolesResponse): void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [base, setBase] = useState<Base>("ANALYST");
  const [permissions, setPermissions] = useState<OrganizationPermission[]>(["org.read"]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({ mutationFn: () => client.createOrganizationRole(org.id, { name: name.trim(), description: description.trim() || null, baseRole: base, permissions }), onSuccess: onDone });
  const pickBase = (b: Base) => { setBase(b); setPermissions((p) => p.filter((x) => allowedCustomPermissions(b).includes(x))); };
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-ink">New role</DialogTitle>
        <DialogDescription>Applies only to members whose built-in role matches its base.</DialogDescription>
      </DialogHeader>
      <StepForm label="New role" submitLabel="Create role" pending={create.isPending} onSubmit={() => create.mutate()}
        error={create.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(create.error).title}</span> {toDisplayError(create.error).message}</p>}
        steps={[
          {
            id: "name", title: "Name and base role", description: "The base decides what this role can be allowed to change.",
            validate: () => { const e: Record<string, string> = name.trim().length < 2 ? { name: "Use at least 2 characters." } : {}; setErrors(e); return !e.name; },
            content: (
              <>
                <Field label="Name" htmlFor={`${id}-name`} error={errors.name}><Input id={`${id}-name`} value={name} maxLength={40} aria-invalid={Boolean(errors.name)} onChange={(e) => setName(e.target.value)} placeholder="Finance reader" /></Field>
                <Field label="Description (optional)" htmlFor={`${id}-desc`}><Textarea id={`${id}-desc`} rows={2} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
                <div role="radiogroup" aria-label="Base role" className="grid gap-2 sm:grid-cols-2">
                  {BASES.map((b) => <ChoiceCard key={b} name={`${id}-base`} value={b} checked={base === b} onChange={() => pickBase(b)} title={MEMBERSHIP_ROLE_LABEL[b]} description={BASE_NOTE[b]} />)}
                </div>
              </>
            ),
          },
          {
            id: "permissions", title: "What it can do", description: `Choose from what a ${MEMBERSHIP_ROLE_LABEL[base]} may hold.`,
            validate: () => { const p = customRoleProblems(base, permissions); setErrors(p.length ? { permissions: p.join(" ") } : {}); return p.length === 0; },
            content: <PermissionPicker base={base} value={permissions} onChange={setPermissions} error={errors.permissions} />,
          },
          {
            id: "review", title: "Review",
            content: (
              <Summary rows={[
                ["Name", name.trim()], ["Base role", MEMBERSHIP_ROLE_LABEL[base]],
                ["Can do", permissions.map((p) => PERMISSION_INFO[p].label).join(", ")],
              ]} />
            ),
          },
        ]} />
    </>
  );
}

function EditRole({ org, role, client, onDone }: { org: OrganizationDetail; role: CustomRoleView; client: Client; onDone(d: ListRolesResponse): void }) {
  const id = useId();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [permissions, setPermissions] = useState<OrganizationPermission[]>(role.permissions);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => client.updateOrganizationRole(org.id, role.id, { name: name.trim(), description: description.trim() || null, permissions }), onSuccess: onDone });
  return (
    <form noValidate className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      const p = [...(name.trim().length < 2 ? ["Use a name of at least 2 characters."] : []), ...customRoleProblems(role.baseRole, permissions)];
      setError(p.length ? p.join(" ") : null);
      if (!p.length) save.mutate();
    }}>
      <DialogHeader>
        <DialogTitle className="text-ink">Edit “{role.name}”</DialogTitle>
        <DialogDescription>Based on {MEMBERSHIP_ROLE_LABEL[role.baseRole]}. Changes apply at once to its {role.memberCount} member{role.memberCount === 1 ? "" : "s"}.</DialogDescription>
      </DialogHeader>
      <Field label="Name" htmlFor={`${id}-name`}><Input id={`${id}-name`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Description (optional)" htmlFor={`${id}-desc`}><Textarea id={`${id}-desc`} rows={2} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <PermissionPicker base={role.baseRole} value={permissions} onChange={setPermissions} />
      {(error || save.isError) && <p role="alert" className="text-sm text-danger">{error ?? toDisplayError(save.error).message}</p>}
      <DialogFooter><Button type="submit" disabled={save.isPending}>Save role</Button></DialogFooter>
    </form>
  );
}

export function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line rounded-tile border border-line bg-surface">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-ink-muted">{k}</dt><dd className="break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
