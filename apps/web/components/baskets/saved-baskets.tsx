"use client";

import { Bookmark } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/*
 * Saved ("bookmarked") baskets. v1 keeps the list in this browser only (a per-viewer convenience); a synced watchlist is
 * an open item (docs/OPEN-ITEMS.md). Storage can be unavailable (private mode, blocked storage): reads fall back to empty.
 */
const KEY = "bx_saved_baskets";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string").slice(0, 200) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: string[]) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
};
const EMPTY: string[] = [];

export function useSavedBaskets() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((slug: string) => write(read().includes(slug) ? read().filter((s) => s !== slug) : [slug, ...read()]), []);
  return { saved, isSaved: (slug: string) => saved.includes(slug), toggle };
}

/** A save toggle that sits above a card's full-card link (z-10), so it never triggers navigation. */
export function BookmarkButton({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const { isSaved, toggle } = useSavedBaskets();
  const on = isSaved(slug);
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `Remove ${name} from saved` : `Save ${name}`} title={on ? "Saved on this device" : "Save"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(slug); }}
      className={cn("relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink", on && "text-accent hover:text-accent", className)}>
      <Bookmark aria-hidden className={cn("size-[1.15rem] transition-transform duration-200 ease-calm", on && "scale-110 fill-current")} />
    </button>
  );
}
