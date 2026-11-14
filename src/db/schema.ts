import Dexie from "dexie";
import type { Table } from "dexie";

export type SubjectKind = "person" | "pet";
export type PetType = "dog" | "cat" | "other";
/** "face" vectors come from Human, "image" vectors from MediaPipe's ImageEmbedder. */
export type EmbeddingKind = "face" | "image";

export interface Subject {
  id?: number;
  kind: SubjectKind;
  name: string;
  /** Only for pets: used to match a track against the right kind of animal. */
  petType?: PetType;
  createdAt: number;
  updatedAt: number;
  /** How many enrollment photos produced a usable descriptor. */
  photoCount: number;
}

export interface EmbeddingRecord {
  id?: number;
  subjectId: number;
  kind: EmbeddingKind;
  /** The raw vector. Face vectors come from Human, image vectors from MobileNetV3. */
  vector: number[];
  createdAt: number;
}

/**
 * LiveCaps tables.
 *
 * The database is still named "moments" (and a saved capture is still called a
 * "moment") so that enrollments made before the rename keep working.
 *
 * WHY one `subjects` table instead of separate people/pets tables: enrollment,
 * renaming and cascade-delete are identical for both, and one table means one
 * code path (and one place to get the "delete all their embeddings" rule right).
 * `kind` is the discriminator.
 *
 * `moments` and `detections` are declared now so a later Stage 3 does not need
 * a schema migration on an existing database.
 */
class MomentsDatabase extends Dexie {
  subjects!: Table<Subject, number>;
  embeddings!: Table<EmbeddingRecord, number>;
  moments!: Table<Record<string, unknown>, number>;
  detections!: Table<Record<string, unknown>, number>;

  constructor() {
    super("moments");

    this.version(1).stores({
      subjects: "++id, kind, name, createdAt",
      embeddings: "++id, subjectId, kind, [subjectId+kind], createdAt",
      moments: "++id, createdAt",
      detections: "++id, momentId, type, name",
    });
  }
}

export const db = new MomentsDatabase();
