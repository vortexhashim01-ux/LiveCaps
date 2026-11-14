import { useRef, useState } from "react";
import { env } from "../config/env";
import { createSubject } from "../db/subjects";
import type { PetType, SubjectKind } from "../db/schema";
import { faceService } from "../ml/faceService";
import { fileToCanvas } from "../ml/imageUtils";
import { petService } from "../ml/petService";

interface SubjectFormProps {
  kind: SubjectKind;
  onSaved: () => void;
  onCancel: () => void;
}

interface AcceptedPhoto {
  id: string;
  fileName: string;
  /** Preview only: never written to the database. */
  previewUrl: string;
  vector: number[];
}

interface RejectedPhoto {
  fileName: string;
  reason: string;
}

/** People need 3-5 photos; pets need at least 5 from different angles. */
const LIMITS: Record<SubjectKind, { min: number; max: number }> = {
  person: { min: 3, max: 5 },
  pet: { min: 5, max: 10 },
};

const PET_TYPE_LABEL: Record<PetType, string> = {
  dog: "Dog",
  cat: "Cat",
  other: "Other animal",
};

/**
 * Enrollment form for one person or one pet.
 *
 * WHY validation happens per photo: one unusable photo (blurry, two faces, tiny)
 * would quietly poison the descriptor set and cause false matches later. It is
 * rejected with a reason instead of being saved.
 */
export function SubjectForm({ kind, onSaved, onCancel }: SubjectFormProps) {
  const [name, setName] = useState("");
  const [petType, setPetType] = useState<PetType>("dog");
  const [photos, setPhotos] = useState<AcceptedPhoto[]>([]);
  const [rejected, setRejected] = useState<RejectedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);

  const uploadRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const limits = LIMITS[kind];
  const noun = kind === "person" ? "person" : "pet";

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const capacity = limits.max - photos.length;
    if (capacity <= 0) {
      setError(`You already have the maximum of ${limits.max} photos.`);
      return;
    }

    const files = Array.from(fileList).slice(0, capacity);
    setBusy(true);
    setError(null);
    setRejected([]);
    setModelNote(
      kind === "person"
        ? "Loading face models (first time only)…"
        : "Loading pet model (first time only)…",
    );

    const accepted: AcceptedPhoto[] = [];
    const failures: RejectedPhoto[] = [];

    try {
      if (kind === "person") await faceService.init();
      else await petService.init();
      setModelNote(null);

      for (const file of files) {
        try {
          const canvas = await fileToCanvas(file);

          if (kind === "person") {
            const faces = await faceService.detect(canvas);

            if (faces.length === 0) {
              throw new Error("No face found. Use a clear, front-facing photo.");
            }
            if (faces.length > 1) {
              throw new Error("Two or more faces. Use a photo of just this person.");
            }

            const face = faces[0];
            if (face.box.width < env.minFaceSizePx) {
              throw new Error(
                `Face too small (${Math.round(face.box.width)}px, minimum ${env.minFaceSizePx}px). Move closer or use a larger photo.`,
              );
            }
            if (!face.embedding) {
              throw new Error("Could not read this face. Try a sharper photo.");
            }

            accepted.push({
              id: crypto.randomUUID(),
              fileName: file.name,
              previewUrl: canvas.toDataURL("image/jpeg", 0.6),
              vector: face.embedding,
            });
          } else {
            const vector = await petService.embed(canvas);
            if (vector.length === 0) {
              throw new Error("Could not analyze this photo. Try another one.");
            }

            accepted.push({
              id: crypto.randomUUID(),
              fileName: file.name,
              previewUrl: canvas.toDataURL("image/jpeg", 0.6),
              vector,
            });
          }
        } catch (caught) {
          failures.push({
            fileName: file.name,
            reason: caught instanceof Error ? caught.message : "Could not process this photo.",
          });
        }
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `The model could not load: ${caught.message}`
          : "The model could not load. Check your internet connection.",
      );
    } finally {
      setPhotos((current) => [...current, ...accepted]);
      setRejected(failures);
      setBusy(false);
      setModelNote(null);
      // Allow picking the same file again.
      if (uploadRef.current) uploadRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const save = async () => {
    if (name.trim() === "") {
      setError(`Give this ${noun} a name.`);
      return;
    }
    if (photos.length < limits.min) {
      setError(`Add at least ${limits.min} photos (you have ${photos.length}).`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createSubject({
        kind,
        name,
        petType: kind === "pet" ? petType : undefined,
        vectors: photos.map((photo) => photo.vector),
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold">New {noun}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="subject-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="subject-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === "person" ? "e.g. Rahul" : "e.g. Bruno"}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        {kind === "pet" ? (
          <div>
            <label htmlFor="pet-type" className="block text-sm font-medium">
              Animal
            </label>
            <select
              id="pet-type"
              value={petType}
              onChange={(event) => setPetType(event.target.value as PetType)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {(Object.keys(PET_TYPE_LABEL) as PetType[]).map((value) => (
                <option key={value} value={value}>
                  {PET_TYPE_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {kind === "pet" && petType === "other" ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Live naming only runs for dogs and cats. Other animals are detected and labelled, but
          not matched by name.
        </p>
      ) : null}

      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Choose photos
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Take photo
          </button>

          <span className="text-xs text-slate-500 dark:text-slate-400">
            {photos.length} of {limits.min}–{limits.max} · {noun === "person" ? "front-facing, one face per photo" : "different angles and lighting"}
          </span>
        </div>

        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void addFiles(event.target.files)}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture={kind === "person" ? "user" : "environment"}
          hidden
          onChange={(event) => void addFiles(event.target.files)}
        />
      </div>

      {modelNote ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{modelNote}</p>
      ) : null}

      {photos.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {photos.map((photo) => (
            <li key={photo.id} className="relative">
              <img
                src={photo.previewUrl}
                alt={photo.fileName}
                className="aspect-square w-full rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                aria-label={`Remove ${photo.fileName}`}
                className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-slate-900/85 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {rejected.length > 0 ? (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {rejected.map((item) => (
            <li key={`${item.fileName}-${item.reason}`}>
              <span className="font-medium">{item.fileName}:</span> {item.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || saving || photos.length < limits.min}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : `Save ${noun}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
