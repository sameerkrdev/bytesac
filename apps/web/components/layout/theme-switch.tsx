"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setChoice, useThemeChoice, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

/** Three-way theme switch (light / dark / system) as a small segmented control. */
export function ThemeSwitch({ className }: { className?: string }) {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("inline-flex items-center gap-0.5 rounded-pill border border-line bg-surface p-0.5", className)}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={choice === o.value} aria-label={o.label} title={o.label} onClick={() => setChoice(o.value)}
          className={cn("grid size-9 place-items-center rounded-pill text-ink-faint transition-colors hover:text-ink", choice === o.value && "bg-surface-muted text-ink")}>
          <o.icon aria-hidden className="size-4" />
        </button>
      ))}
    </div>
  );
}
