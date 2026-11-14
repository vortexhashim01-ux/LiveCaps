import { PageShell } from "../components/PageShell";

export default function Gallery() {
  return (
    <PageShell
      title="Gallery"
      stage="Stage 3"
      description="Captured moments will appear here as a timeline grouped by date, with a detail view, filters by name/type/date, and delete."
    >
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
        Nothing to show yet. The live camera can already detect people and animals and name
        the ones you enroll on the <strong>People &amp; Pets</strong> page, but saving photos
        starts in Stage 3.
      </div>
    </PageShell>
  );
}
