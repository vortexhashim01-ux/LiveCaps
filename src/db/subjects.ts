import { db } from "./schema";
import type { EmbeddingKind, EmbeddingRecord, PetType, Subject, SubjectKind } from "./schema";

export interface NewSubjectInput {
  kind: SubjectKind;
  name: string;
  petType?: PetType;
  /** One vector per accepted enrollment photo. */
  vectors: number[][];
}

export function listSubjects(): Promise<Subject[]> {
  return db.subjects.orderBy("createdAt").reverse().toArray();
}

export function listEmbeddings(): Promise<EmbeddingRecord[]> {
  return db.embeddings.toArray();
}

/**
 * Create the person/pet and all of its descriptors in one transaction.
 * WHY a transaction: a half-saved subject (row without vectors) would show up in
 * the list and never match anything.
 */
export async function createSubject(input: NewSubjectInput): Promise<number> {
  const name = input.name.trim();
  if (name === "") throw new Error("A name is required.");
  if (input.vectors.length === 0) throw new Error("At least one photo is required.");

  const now = Date.now();
  const embeddingKind: EmbeddingKind = input.kind === "person" ? "face" : "image";

  return db.transaction("rw", db.subjects, db.embeddings, async () => {
    const subjectId = await db.subjects.add({
      kind: input.kind,
      name,
      petType: input.kind === "pet" ? (input.petType ?? "other") : undefined,
      createdAt: now,
      updatedAt: now,
      photoCount: input.vectors.length,
    });

    await db.embeddings.bulkAdd(
      input.vectors.map((vector) => ({
        subjectId,
        kind: embeddingKind,
        vector,
        createdAt: now,
      })),
    );

    return subjectId;
  });
}

export async function renameSubject(id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("A name is required.");
  await db.subjects.update(id, { name: trimmed, updatedAt: Date.now() });
}

/**
 * Delete the subject and every descriptor it owns.
 * WHY explicit: IndexedDB has no foreign keys, so nothing deletes the embeddings
 * for us. Leaving them behind would keep matching a person who no longer exists.
 */
export async function deleteSubject(id: number): Promise<void> {
  await db.transaction("rw", db.subjects, db.embeddings, async () => {
    await db.embeddings.where("subjectId").equals(id).delete();
    await db.subjects.delete(id);
  });
}

export async function countSubjects(): Promise<{ people: number; pets: number }> {
  const [people, pets] = await Promise.all([
    db.subjects.where("kind").equals("person").count(),
    db.subjects.where("kind").equals("pet").count(),
  ]);
  return { people, pets };
}
