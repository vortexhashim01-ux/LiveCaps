import { useCallback, useEffect, useState } from "react";
import { listEmbeddings, listSubjects } from "../db/subjects";
import type { GallerySubject } from "../ml/recognizer";

export interface Gallery {
  people: GallerySubject[];
  pets: GallerySubject[];
}

const EMPTY: Gallery = { people: [], pets: [] };

/**
 * Loads every enrolled descriptor into memory, grouped by person/pet.
 *
 * WHY in memory: matching happens several times per second. A database round
 * trip per match would make the live view stutter. The dataset is small
 * (a few dozen vectors), so keeping it in RAM is cheap.
 */
export function useEmbeddingGallery() {
  const [gallery, setGallery] = useState<Gallery>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [subjects, embeddings] = await Promise.all([listSubjects(), listEmbeddings()]);

      const bySubject = new Map<number, number[][]>();
      for (const embedding of embeddings) {
        const vectors = bySubject.get(embedding.subjectId);
        if (vectors) vectors.push(embedding.vector);
        else bySubject.set(embedding.subjectId, [embedding.vector]);
      }

      const people: GallerySubject[] = [];
      const pets: GallerySubject[] = [];

      for (const subject of subjects) {
        if (subject.id === undefined) continue;
        const vectors = bySubject.get(subject.id);
        if (!vectors || vectors.length === 0) continue;

        const entry: GallerySubject = {
          subjectId: subject.id,
          name: subject.name,
          vectors,
          petType: subject.petType,
        };

        if (subject.kind === "person") people.push(entry);
        else pets.push(entry);
      }

      setGallery({ people, pets });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not read saved people and pets: ${caught.message}`
          : "Could not read saved people and pets from this browser.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { gallery, loading, error, reload };
}
