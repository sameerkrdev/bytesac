"use client";

import type { ApiClient } from "@repo/api-client";
import { BASKET_FILE_KINDS, MAX_BASKET_FILE_BYTES, MAX_BASKET_FILES, type BasketDetail, type BasketFileKind, type BasketFileView } from "@repo/validator";
import { Download, FileText, Trash2, UploadCloud, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/step-form";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Client = Pick<ApiClient, "presignBasketFile" | "confirmBasketFile" | "removeBasketFile">;

export const FILE_KIND_LABEL: Record<BasketFileKind, string> = { thesis: "Thesis", factsheet: "Factsheet", methodology: "Methodology", research: "Research", other: "Other" };
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const titleFrom = (name: string) => name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 120);

/** PUT with upload progress (fetch can't report it). The signed URL fixes type and length; anything else is rejected by R2. */
function put(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The upload failed. Try again.")));
    xhr.onerror = () => reject(new Error("The upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

/** A version's files as a list with download links (public page, review, read-only editor). */
export function FileList({ files, onRemove, busy }: { files: BasketFileView[]; onRemove?(f: BasketFileView): void; busy?: boolean }) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Files" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-4 p-4">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-tile bg-danger-soft text-danger"><FileText className="size-4.5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{f.title}</span>
            <span className="block truncate text-xs text-ink-muted">{FILE_KIND_LABEL[f.kind]} · PDF · {size(f.sizeBytes)}{f.fileName && ` · ${f.fileName}`}</span>
          </span>
          <a href={f.url} rel="noopener" className="inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink">
            <Download aria-hidden className="size-4" /><span className="hidden sm:inline">Download</span><span className="sr-only sm:hidden">Download {f.title}</span>
          </a>
          {onRemove && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(f)} aria-label={`Remove ${f.title}`}><Trash2 /></Button>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Files on the open draft (thesis, factsheet…). Drop or pick a PDF, name it, upload; the server checks the file before
 * it is attached. Files are frozen with the version once it is submitted.
 */
export function BasketFiles({ bid, files, editable, client, onDetail }: { bid: string; files: BasketFileView[]; editable: boolean; client: Client; onDetail(d: BasketDetail): void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<BasketFileKind>("thesis");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const full = files.length >= MAX_BASKET_FILES;

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.type !== "application/pdf") return setError("Only PDF files can be attached.");
    if (f.size > MAX_BASKET_FILE_BYTES) return setError(`That file is ${size(f.size)}. The limit is ${size(MAX_BASKET_FILE_BYTES)}.`);
    setFile(f);
    setTitle(titleFrom(f.name));
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (editable && !full) pick(e.dataTransfer.files[0]); };
  const reset = () => { setFile(null); setTitle(""); setProgress(null); if (input.current) input.current.value = ""; };

  async function upload() {
    if (!file) return;
    if (title.trim().length < 1) return setError("Give the file a title.");
    setError(null);
    setProgress(0);
    try {
      const pre = await client.presignBasketFile(bid, { fileName: file.name, contentType: "application/pdf", sizeBytes: file.size });
      await put(pre.uploadUrl, file, pre.headers, setProgress);
      onDetail(await client.confirmBasketFile(bid, pre.fileId, { kind, title: title.trim() }));
      reset();
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : (toDisplayError(e).message ?? "Something went wrong."));
      setProgress(null);
    }
  }
  async function remove(f: BasketFileView) {
    setError(null);
    try { onDetail(await client.removeBasketFile(bid, f.id)); } catch (e) { setError(toDisplayError(e).message ?? "Something went wrong."); }
  }

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4 border-t border-line pt-8">
      <div className="space-y-1">
        <h3 id={`${id}-h`} className="text-lg font-normal tracking-tight text-ink">Files</h3>
        <p className="text-sm text-ink-muted">PDFs investors can download with this version: thesis, factsheet, methodology. Reviewed with the version and frozen once it is submitted.</p>
      </div>
      <FileList files={files} onRemove={editable ? (f) => void remove(f) : undefined} busy={progress !== null} />
      {!editable && files.length === 0 && <p className="text-sm text-ink-muted">No files on this version.</p>}

      {editable && !file && (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          className={cn("grid place-items-center gap-2 rounded-card border border-dashed px-6 py-10 text-center transition-colors", drag ? "border-primary bg-surface" : "border-line-strong", full && "opacity-60")}>
          <UploadCloud aria-hidden className="size-6 text-ink-faint" />
          <p className="text-sm text-ink">{full ? `This version has the maximum of ${MAX_BASKET_FILES} files.` : "Drop a PDF here, or"}</p>
          {!full && <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>Choose a file</Button>}
          <p className="text-xs text-ink-faint">PDF up to {size(MAX_BASKET_FILE_BYTES)} · up to {MAX_BASKET_FILES} files</p>
          <input ref={input} type="file" accept="application/pdf" className="sr-only" tabIndex={-1} aria-label="Choose a PDF" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      )}

      {editable && file && (
        <div className="space-y-4 rounded-card border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            <FileText aria-hidden className="size-5 text-danger" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name} <span className="text-ink-muted">· {size(file.size)}</span></span>
            <Button type="button" size="sm" variant="ghost" disabled={progress !== null} onClick={reset} aria-label="Choose a different file"><X /></Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Title investors see" htmlFor={`${id}-title`}><Input id={`${id}-title`} value={title} maxLength={120} disabled={progress !== null} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Kind" htmlFor={`${id}-kind`}>
              <Select id={`${id}-kind`} value={kind} disabled={progress !== null} onChange={(e) => setKind(e.target.value as BasketFileKind)}>
                {BASKET_FILE_KINDS.map((k) => <option key={k} value={k}>{FILE_KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
          </div>
          {progress !== null && (
            <div role="progressbar" aria-label="Upload progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <Button type="button" disabled={progress !== null} onClick={() => void upload()}>{progress === null ? "Upload and attach" : progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Checking the file…"}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
