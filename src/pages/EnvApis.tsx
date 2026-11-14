import { PageShell } from "../components/PageShell";

export default function EnvApis() {
  return (
    <PageShell
      title="Environment & APIs"
      stage="Stage 2"
      description="A status table for every setting this app reads: what it does, whether it is filled, where to get it, and what stops working when it is missing."
    >
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
        This page is built in Stage 2. It will show masked values only, never the real keys.
      </div>
    </PageShell>
  );
}
