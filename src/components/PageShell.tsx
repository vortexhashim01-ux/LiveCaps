import type { ReactNode } from "react";

interface PageShellProps {
  title: string;
  description: string;
  /** Which stage will make this page real. Keeps the placeholder honest. */
  stage: string;
  children?: ReactNode;
}

/** Shared layout for the pages that are still placeholders in Stage 1. */
export function PageShell({ title, description, stage, children }: PageShellProps) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300">
          {stage}
        </span>
      </div>

      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {description}
      </p>

      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}
