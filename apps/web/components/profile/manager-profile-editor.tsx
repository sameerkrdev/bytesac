"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { managerProfileRequestSchema, type ManagerProfileView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "getMyManagerProfile" | "saveMyManagerProfile" | "publishMyManagerProfile" | "unpublishMyManagerProfile">;

const HINT: Record<string, string> = {
  handle: "Use 3 to 30 lowercase letters, numbers or hyphens.", displayName: "Enter 2 to 80 characters.", headline: "Up to 120 characters.", bio: "Up to 2000 characters.",
  experienceYears: "Enter a whole number from 0 to 60.", background: "Up to 2000 characters.", qualifications: "Up to 10 lines, each up to 120 characters.",
  links: "Up to 5 lines in the form: label | https://url",
};
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function ProfileForm({ profile, client }: { profile: ManagerProfileView | null; client: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const [f, setF] = useState({
    handle: profile?.handle ?? "", displayName: profile?.displayName ?? "", headline: profile?.headline ?? "", bio: profile?.bio ?? "", experienceYears: profile?.experienceYears?.toString() ?? "",
    background: profile?.background ?? "", qualifications: (profile?.qualifications ?? []).join("\n"), links: (profile?.links ?? []).map((l) => `${l.label} | ${l.url}`).join("\n"),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = (r: { profile: ManagerProfileView | null }) => qc.setQueryData(["manager-profile"], r);
  const save = useMutation({ mutationFn: (b: Parameters<Client["saveMyManagerProfile"]>[0]) => client.saveMyManagerProfile(b), onSuccess: done });
  const publish = useMutation({ mutationFn: () => client.publishMyManagerProfile(), onSuccess: done });
  const unpublish = useMutation({ mutationFn: () => client.unpublishMyManagerProfile(), onSuccess: done });
  const handleTaken = save.error instanceof ApiError && save.error.code === "HANDLE_TAKEN";
  const other = [save, publish, unpublish].find((m) => m.isError && !(m === save && handleTaken));

  const field = (key: keyof typeof f, label: string, multiline = false) => {
    const err = errors[key] ?? (key === "handle" && handleTaken ? toDisplayError(save.error).message : undefined);
    const props = { id: `${id}-${key}`, value: f[key], "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-${key}-e` : undefined, onChange: (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value }) };
    return (
      <div className="space-y-2">
        <Label htmlFor={props.id} className="text-xs font-medium text-ivory">{label}</Label>
        {multiline ? <Textarea {...props} /> : <Input {...props} className="min-h-11 bg-space text-ivory" />}
        {err && <p id={`${id}-${key}-e`} role="alert" className="text-xs text-danger">{err}</p>}
      </div>
    );
  };

  const submit = () => {
    const parsed = managerProfileRequestSchema.safeParse({
      handle: f.handle.trim(), displayName: f.displayName.trim(), headline: f.headline.trim() || null, bio: f.bio.trim() || null,
      experienceYears: f.experienceYears.trim() ? Number(f.experienceYears) : null, background: f.background.trim() || null, qualifications: lines(f.qualifications),
      links: lines(f.links).map((l) => { const [label = "", ...url] = l.split("|"); return { label: label.trim(), url: url.join("|").trim() }; }),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message === "That handle is reserved." ? i.message : HINT[String(i.path[0])] ?? i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <>
      {profile?.status === "hidden" && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">
          Bytesac hid this profile. It is not public and you cannot publish it.{profile.hiddenReason && <> Reason: {profile.hiddenReason}</>}
        </p>
      )}
      {profile && profile.status !== "hidden" && <p role="status" className="text-sm text-stone">{profile.status === "published" ? `Published at /managers/${profile.handle}` : "Draft: not public yet."}</p>}
      <form noValidate className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {field("handle", "Handle (your public address)")}
        {field("displayName", "Display name")}
        {field("headline", "Headline")}
        {field("bio", "About you", true)}
        {field("experienceYears", "Years of experience (self-reported)")}
        {field("background", "Background", true)}
        {field("qualifications", "Qualifications, one per line (self-reported)", true)}
        {field("links", "Links, one per line: label | https://url", true)}
        <p className="text-xs text-stone">Experience and qualifications are shown as self-reported. Plain text only.</p>
        {other && <p role="alert" className="text-sm text-danger">{toDisplayError(other.error).title}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" className="min-h-11" disabled={save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save profile</Button>
          {profile?.status === "draft" && <Button type="button" variant="secondary" className="min-h-11" disabled={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}
          {profile?.status === "published" && <Button type="button" variant="secondary" className="min-h-11" disabled={unpublish.isPending} onClick={() => unpublish.mutate()}>Unpublish</Button>}
        </div>
      </form>
    </>
  );
}

export function ManagerProfileEditor({ client = api }: { client?: Client }) {
  const q = useQuery({ queryKey: ["manager-profile"], queryFn: () => client.getMyManagerProfile() });
  return (
    <section aria-labelledby="manager-profile-title" className="space-y-4 rounded-2xl border border-border-dark bg-slate p-6">
      <h2 id="manager-profile-title" className="font-display text-xl font-semibold text-ivory">Manager profile</h2>
      {q.isLoading && <p className="text-sm text-stone">Loading profile…</p>}
      {q.isError && <p role="alert" className="text-sm text-danger">Couldn&apos;t load your profile. Refresh to try again.</p>}
      {q.data && <ProfileForm key={q.data.profile?.updatedAt ?? "new"} profile={q.data.profile} client={client} />}
    </section>
  );
}
