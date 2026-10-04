import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-ink-faint">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, n) => (
          <Fragment key={c.label}>
            {n > 0 && <li aria-hidden><ChevronRight className="size-3" /></li>}
            <li>{c.href ? <Link href={c.href} className="inline-flex min-h-8 items-center transition-colors hover:text-ink">{c.label}</Link> : <span aria-current="page" className="text-ink-muted">{c.label}</span>}</li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** The page title with an optional breadcrumb/eyebrow above, a description below and an actions slot beside it. */
export function PageHeader({ title, id, breadcrumb, actions, eyebrow, description }: { title: ReactNode; id?: string; breadcrumb?: Crumb[]; actions?: ReactNode; eyebrow?: ReactNode; description?: ReactNode }) {
  return (
    <header className="space-y-3">
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      {eyebrow && <p className="type-eyebrow text-ink-faint">{eyebrow}</p>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 space-y-2">
          <h1 id={id} className="type-title text-ink">{title}</h1>
          {description && <p className="max-w-2xl text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Every page: header, then content at a consistent rhythm. Content width is the shell's; `className` narrows it for reading pages. */
export function PageLayout({ title, id = "page-title", breadcrumb, actions, eyebrow, description, className, children }: { title: ReactNode; id?: string; breadcrumb?: Crumb[]; actions?: ReactNode; eyebrow?: ReactNode; description?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("space-y-8 md:space-y-10", className)}>
      <PageHeader title={title} id={id} breadcrumb={breadcrumb} actions={actions} eyebrow={eyebrow} description={description} />
      {children}
    </section>
  );
}

/** A titled block inside a page. */
export function PageSection({ title, id, description, actions, children, className }: { title: ReactNode; id: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id={id} className="type-heading text-ink">{title}</h2>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
