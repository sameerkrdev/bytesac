"use client";

import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  title: string;
  /** One line under the step title. */
  description?: ReactNode;
  content: ReactNode;
  /** Runs on Continue (and on submit for the last step); return false to stay (the step shows its own field errors). */
  validate?: () => boolean;
}

/**
 * A long form split into short steps: a progress rail, one step at a time, Back / Continue, and the real submit on the
 * last step. Steps already passed can be revisited from the rail. Enter continues; focus moves to each new step's title.
 * Nothing is sent before the last step, so leaving half-way changes nothing.
 */
export function StepForm({ steps, label, submitLabel, onSubmit, pending = false, error, className, initial = 0, onStepChange }: {
  steps: Step[]; label: string; submitLabel: string; onSubmit(): void; pending?: boolean; error?: ReactNode; className?: string; initial?: number; onStepChange?(index: number): void;
}) {
  const id = useId();
  const [index, setIndex] = useState(initial);
  const [reached, setReached] = useState(initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const last = index === steps.length - 1;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus();
    onStepChange?.(index);
  }, [index, onStepChange]);

  const go = (to: number) => { setIndex(to); setReached((r) => Math.max(r, to)); };
  const next = () => {
    if (step.validate && !step.validate()) return;
    if (last) onSubmit(); else go(index + 1);
  };

  return (
    <form noValidate aria-label={label} className={cn("space-y-6", className)} onSubmit={(e) => { e.preventDefault(); next(); }}>
      <nav aria-label={`${label}: steps`}>
        <ol className="flex gap-1.5">
          {steps.map((s, i) => {
            const done = i < index;
            const current = i === index;
            const reachable = i <= reached && !pending;
            return (
              <li key={s.id} className="min-w-0 flex-1">
                <button type="button" disabled={!reachable || current} aria-current={current ? "step" : undefined} onClick={() => go(i)}
                  className="group w-full text-left disabled:cursor-default">
                  <span aria-hidden className={cn("block h-1 rounded-full transition-colors duration-300", done || current ? "bg-primary" : "bg-line-strong/60")} />
                  <span className={cn("mt-2 hidden items-center gap-1.5 truncate text-xs sm:flex", current ? "text-ink" : done ? "text-ink-muted group-enabled:group-hover:text-ink" : "text-ink-faint")}>
                    {done ? <Check aria-hidden className="size-3 shrink-0" /> : <span className="font-mono text-[0.625rem]">{i + 1}</span>}
                    {s.title}
                  </span>
                  <span className="sr-only">{`Step ${i + 1}: ${s.title}${done ? " (done)" : ""}`}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="space-y-1.5">
        <p className="font-mono text-[0.6875rem] tracking-wide text-ink-faint uppercase">Step {index + 1} of {steps.length}</p>
        <h3 ref={heading} tabIndex={-1} id={`${id}-title`} className="text-xl font-normal tracking-tight text-ink outline-none">{step.title}</h3>
        {step.description && <p className="text-sm text-ink-muted">{step.description}</p>}
      </div>

      <div key={step.id} className="animate-[bx-step-in_320ms_var(--ease-calm,ease-out)_both] space-y-5">{step.content}</div>

      {error}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        {index > 0
          ? <Button type="button" variant="ghost" onClick={() => go(index - 1)} disabled={pending}><ArrowLeft />Back</Button>
          : <span />}
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {last ? submitLabel : <>Continue<ArrowRight /></>}
        </Button>
      </div>
    </form>
  );
}

/** A labelled field with its error and hint, the building block inside steps. */
export function Field({ label, htmlFor, error, hint, children, className }: { label: ReactNode; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {error ? <p id={`${htmlFor}-error`} className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** A large selectable card for one-of-many choices (roles, kinds, networks). */
export function ChoiceCard({ name, value, checked, onChange, title, description, meta, disabled }: {
  name: string; value: string; checked: boolean; onChange(value: string): void; title: ReactNode; description?: ReactNode; meta?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cn("relative flex cursor-pointer gap-3 rounded-tile border bg-surface p-4 transition-[border-color,box-shadow] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
      checked ? "border-primary shadow-soft" : "border-line hover:border-line-strong", disabled && "cursor-not-allowed opacity-50")}>
      <input type="radio" className="sr-only" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} />
      <span aria-hidden className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", checked ? "border-primary bg-primary" : "border-line-strong")}>
        {checked && <span className="size-1.5 rounded-full bg-primary-ink" />}
      </span>
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description && <span className="block text-sm text-ink-muted">{description}</span>}
        {meta && <span className="block pt-1">{meta}</span>}
      </span>
    </label>
  );
}
