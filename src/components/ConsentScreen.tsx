import { env } from "../config/env";

interface ConsentScreenProps {
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Shown once, before the first face enrollment.
 *
 * WHY it is not dismissible without a choice: face descriptors are biometric
 * data. Enrolling someone without telling them what is stored would be wrong.
 */
export function ConsentScreen({ onAccept, onDecline }: ConsentScreenProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold tracking-tight">Before you enroll anyone</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {env.appName} can learn faces so it can show a name on the live camera. That is
          useful, and it is also sensitive data, so here is exactly what happens.
        </p>

        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          <li>
            <span className="font-medium">Everything stays on this device.</span> Face
            descriptors and names are stored in this browser&apos;s IndexedDB. Nothing is
            uploaded.
          </li>
          <li>
            <span className="font-medium">A face becomes numbers.</span> Each enrollment photo
            is converted into a mathematical descriptor. The photos themselves are not saved
            by enrollment.
          </li>
          <li>
            <span className="font-medium">Only people you enroll get face data.</span> Faces
            that are not enrolled are never stored; they show as &quot;Unknown&quot;.
          </li>
          <li>
            <span className="font-medium">Later, photos you capture may include others.</span>{" "}
            Once capture exists, a saved moment can contain bystanders who never enrolled.
            Think about that before sharing a moment.
          </li>
          <li>
            <span className="font-medium">Get consent from the people you enroll.</span>{" "}
            Biometric data may be regulated where you live (for example India&apos;s DPDP Act
            or the GDPR in the EU). You are responsible for having a lawful reason.
          </li>
          <li>
            <span className="font-medium">You can delete it all.</span> Removing a person
            deletes every descriptor that belongs to them, immediately.
          </li>
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onAccept}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            I understand — continue
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Not now
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          If you decline, the app still works: detection and pet naming do not need face data.
          You can accept later from this page.
        </p>
      </div>
    </div>
  );
}
