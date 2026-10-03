import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-stone">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, n) => (
          <Fragment key={c.label}>
            {n > 0 && <li aria-hidden>/</li>}
            <li>{c.href ? <Link href={c.href} className="inline-flex min-h-11 items-center underline hover:text-ivory">{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** The page title with an optional breadcrumb above and an actions slot beside it. */
export function PageHeader({ title, id, breadcrumb, actions }: { title: ReactNode; id?: string; breadcrumb?: Crumb[]; actions?: ReactNode }) {
  return (
    <header className="space-y-1">
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={id} className="font-display text-3xl font-bold text-ivory md:text-4xl">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/** Every page: header, then content at a consistent rhythm. Content width is the shell's; `className` narrows it for reading pages. */
export function PageLayout({ title, id = "page-title", breadcrumb, actions, className, children }: { title: ReactNode; id?: string; breadcrumb?: Crumb[]; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("space-y-6", className)}>
      <PageHeader title={title} id={id} breadcrumb={breadcrumb} actions={actions} />
      {children}
    </section>
  );
}
