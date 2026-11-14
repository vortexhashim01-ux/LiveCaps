import { useCallback, useEffect, useState } from "react";
import { ConsentScreen } from "../components/ConsentScreen";
import { SubjectForm } from "../components/SubjectForm";
import type { Subject, SubjectKind } from "../db/schema";
import { deleteSubject, listSubjects, renameSubject } from "../db/subjects";

const CONSENT_KEY = "moments.consent.v1";

type ConsentValue = "accepted" | "declined";

function readConsent(): ConsentValue | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function writeConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Private mode can block storage; the session still works.
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function describeSubject(subject: Subject): string {
  if (subject.kind === "person") {
    return `${subject.photoCount} face photo${subject.photoCount === 1 ? "" : "s"}`;
  }
  const animal =
    subject.petType === "dog" ? "Dog" : subject.petType === "cat" ? "Cat" : "Other animal";
  return `${animal} · ${subject.photoCount} photo${subject.photoCount === 1 ? "" : "s"}`;
}

export default function PeoplePets() {
  const [consent, setConsent] = useState<ConsentValue | null>(() => readConsent());
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formKind, setFormKind] = useState<SubjectKind | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSubjects(await listSubjects());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not read saved data: ${caught.message}`
          : "Could not read saved data from this browser.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const acceptConsent = () => {
    writeConsent("accepted");
    setConsent("accepted");
  };

  const declineConsent = () => {
    writeConsent("declined");
    setConsent("declined");
  };

  const startRename = (subject: Subject) => {
    if (subject.id === undefined) return;
    setRenamingId(subject.id);
    setRenameValue(subject.name);
    setConfirmDeleteId(null);
  };

  const saveRename = async (id: number) => {
    setBusyId(id);
    try {
      await renameSubject(id, renameValue);
      setRenamingId(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      await deleteSubject(id);
      setConfirmDeleteId(null);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete this subject.",
      );
    } finally {
      setBusyId(null);
    }
  };

  // First run: nothing is enrolled yet, so ask before any face data exists.
  if (consent === null) {
    return <ConsentScreen onAccept={acceptConsent} onDecline={declineConsent} />;
  }

  const people = subjects.filter((subject) => subject.kind === "person");
  const pets = subjects.filter((subject) => subject.kind === "pet");

  const renderRow = (subject: Subject) => {
    const id = subject.id;
    if (id === undefined) return null;
    const isRenaming = renamingId === id;
    const isConfirming = confirmDeleteId === id;
    const isBusy = busyId === id;

    return (
      <li
        key={id}
        className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-600/15 text-sm font-semibold text-emerald-700 dark:text-emerald-400"
          aria-hidden="true"
        >
          {initials(subject.name)}
        </span>

        {isRenaming ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label htmlFor={`rename-${id}`} className="sr-only">
              New name
            </label>
            <input
              id={`rename-${id}`}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={() => void saveRename(id)}
              disabled={isBusy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setRenamingId(null)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{subject.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {describeSubject(subject)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => startRename(subject)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Rename
              </button>

              {isConfirming ? (
                <>
                  <button
                    type="button"
                    onClick={() => void remove(id)}
                    disabled={isBusy}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {isBusy ? "Deleting…" : "Delete everything"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(id);
                    setRenamingId(null);
                  }}
                  className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </li>
    );
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">People &amp; Pets</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Enroll the faces and pets you want named on the live camera. People use face
        descriptors, pets use image embeddings. Everything stays in this browser.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : null}

      {/* People ------------------------------------------------------- */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">People</h2>
          {consent === "accepted" ? (
            <button
              type="button"
              onClick={() => {
                setFormKind("person");
                setRenamingId(null);
                setConfirmDeleteId(null);
              }}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Add person
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConsent(null)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Review privacy notice
            </button>
          )}
        </div>

        {consent !== "accepted" ? (
          <p className="mt-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
            Face enrollment is off because the privacy notice was not accepted. Pet naming
            still works. Open the notice above to turn face enrollment on.
          </p>
        ) : null}

        {formKind === "person" ? (
          <div className="mt-3">
            <SubjectForm
              kind="person"
              onSaved={() => {
                setFormKind(null);
                void reload();
              }}
              onCancel={() => setFormKind(null)}
            />
          </div>
        ) : null}

        {consent === "accepted" ? (
          people.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
              No people yet. Add 3–5 clear photos of one face to teach the app a name.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">{people.map(renderRow)}</ul>
          )
        ) : null}
      </div>

      {/* Pets --------------------------------------------------------- */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Pets</h2>
          <button
            type="button"
            onClick={() => {
              setFormKind("pet");
              setRenamingId(null);
              setConfirmDeleteId(null);
            }}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            Add pet
          </button>
        </div>

        {formKind === "pet" ? (
          <div className="mt-3">
            <SubjectForm
              kind="pet"
              onSaved={() => {
                setFormKind(null);
                void reload();
              }}
              onCancel={() => setFormKind(null)}
            />
          </div>
        ) : null}

        {pets.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            No pets yet. Add 5 or more photos of your dog or cat from different angles.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">{pets.map(renderRow)}</ul>
        )}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Deleting a person or pet removes every descriptor saved for them. Biometric data may be
        regulated where you live — only enroll people who agreed.
      </p>
    </section>
  );
}
