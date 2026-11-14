import type { ReactNode } from "react";

export type PillTone = "ok" | "warn" | "error" | "muted";

const TONES: Record<PillTone, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-400",
  error: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-400",
  muted: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300",
};

interface PillProps {
  tone: PillTone;
  children: ReactNode;
  /** Optional dot before the text, useful for live/loading states. */
  dot?: boolean;
}

/** Small status label: model state, FPS, camera state. */
export function Pill({ tone, children, dot = false }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
