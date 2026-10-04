"use client";

import type { ApiClient } from "@repo/api-client";
import { LOGO_CONTENT_TYPES, MAX_LOGO_BYTES, type OpsAssetDetail } from "@repo/validator";
import { ImageUp, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AssetMark } from "@/components/visual/chain-badge";
import { cryptoLogo } from "@/lib/crypto-logos";
import { toDisplayError } from "@/lib/errors";

export type LogoClient = Pick<ApiClient, "opsPresignAssetLogo" | "opsConfirmAssetLogo" | "opsRemoveAssetLogo">;

/** Checks a picked file against the logo rules; returns the problem or null. The server checks the bytes again. */
export function logoProblem(f: File): string | null {
  if (!(LOGO_CONTENT_TYPES as readonly string[]).includes(f.type)) return "Use a PNG, JPEG or WebP image (SVG isn't accepted).";
  if (f.size > MAX_LOGO_BYTES) return `That image is ${Math.round(f.size / 1024)} KB. The limit is ${MAX_LOGO_BYTES / 1024} KB.`;
  return null;
}

/** Presign → PUT → confirm. Returns the updated asset. */
export async function uploadAssetLogo(client: LogoClient, id: string, file: File): Promise<OpsAssetDetail> {
  const pre = await client.opsPresignAssetLogo(id, { contentType: file.type as (typeof LOGO_CONTENT_TYPES)[number], sizeBytes: file.size });
  const res = await fetch(pre.uploadUrl, { method: "PUT", body: file, headers: pre.headers });
  if (!res.ok) throw new Error("The upload failed. Try again.");
  return client.opsConfirmAssetLogo(id, pre.fileId);
}

/** A local preview URL for a picked file, released when it changes. */
function usePreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    let u: string | null = null;
    try { u = URL.createObjectURL(file); } catch { u = null; } // no preview where object URLs are unavailable
    setUrl(u);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [file]);
  return url;
}

/** Pick a logo before the asset exists (create flow): preview plus what is shown when none is uploaded. */
export function LogoPicker({ symbol, file, onFile }: { symbol: string; file: File | null; onFile(f: File | null): void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreview(file);
  const fallback = symbol ? cryptoLogo(symbol) : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5 rounded-card border border-line bg-surface p-5">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-surface-muted ring-1 ring-line">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the picked file */}
          {preview ? <img src={preview} alt="" className="size-16 rounded-full object-contain" /> : <AssetMark symbol={symbol || "?"} size={64} />}
        </span>
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-ink">{file ? file.name : fallback ? `No upload: the standard ${symbol.toUpperCase()} logo will show.` : "No logo: a monogram will show."}</p>
          <p className="text-xs text-ink-muted">PNG, JPEG or WebP, square, up to {MAX_LOGO_BYTES / 1024} KB. An uploaded logo always wins over the standard icon.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => input.current?.click()}><ImageUp />{file ? "Choose another" : "Choose an image"}</Button>
        {file && <Button type="button" variant="ghost" onClick={() => { onFile(null); if (input.current) input.current.value = ""; }}>Remove</Button>}
      </div>
      <input id={id} ref={input} type="file" accept={LOGO_CONTENT_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-label="Choose a logo image"
        onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const p = logoProblem(f); setError(p); onFile(p ? null : f); }} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** The editor's logo section: current logo, replace or remove. Presentation only, so it works in any status. */
export function AssetLogoSection({ a, onChange, client }: { a: OpsAssetDetail; onChange(d: OpsAssetDetail): void; client: LogoClient }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (job: () => Promise<OpsAssetDetail>) => {
    setBusy(true); setError(null);
    try { onChange(await job()); } catch (e) { setError(e instanceof Error && !("code" in e) ? e.message : (toDisplayError(e).message ?? "Something went wrong.")); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="type-heading text-ink">Logo</h2>
      <div className="flex flex-wrap items-center gap-5">
        <AssetMark symbol={a.symbol} logoUrl={a.logoUrl} size={64} className="ring-1 ring-line" />
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">{a.logoUrl ? "Uploaded logo." : cryptoLogo(a.symbol) ? `Standard ${a.symbol} icon (no upload).` : "Monogram (no logo)."}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}><ImageUp />{a.logoUrl ? "Replace" : "Upload"}</Button>
            {a.logoUrl && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => client.opsRemoveAssetLogo(a.id))}><Trash2 />Remove</Button>}
          </div>
        </div>
      </div>
      <input ref={input} type="file" accept={LOGO_CONTENT_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-label="Choose a logo image"
        onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const p = logoProblem(f); if (p) return setError(p); void run(() => uploadAssetLogo(client, a.id, f)); }} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
