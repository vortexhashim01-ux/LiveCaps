import type { Track } from "./tracker";
import type { PetType } from "../db/schema";

/** One enrolled identity: a name plus every descriptor saved for it. */
export interface GallerySubject {
  subjectId: number;
  name: string;
  vectors: number[][];
  petType?: PetType;
}

export interface MatchOutcome {
  /** The subject's name, or "Unknown" when nothing passed the threshold. */
  name: string;
  subjectId: number | null;
  /** Best similarity found (0..1). */
  score: number;
  /** Best similarity of the second-closest identity (0..1). */
  runnerUp: number;
}

/** How many identical results in a row before a name is shown. */
export const VOTES_REQUIRED = 3;

/**
 * Cosine similarity between two vectors.
 * WHY: embeddings are direction-only, so the angle between them is what matters,
 * not their length. 1 = identical, 0 = unrelated, -1 = opposite.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Compare one descriptor against every enrolled identity.
 *
 * WHY best-of-descriptors: a person is enrolled with 3-5 photos. One of them may
 * match this angle and lighting; the others may not. Using the best score per
 * person is more forgiving than averaging, which drags every score down.
 */
export function matchSubject(
  query: number[],
  subjects: GallerySubject[],
  threshold: number,
): MatchOutcome {
  let bestScore = -1;
  let bestSubject: GallerySubject | null = null;
  let runnerUp = -1;

  for (const subject of subjects) {
    let subjectBest = -1;

    for (const vector of subject.vectors) {
      const score = cosineSimilarity(query, vector);
      if (score > subjectBest) subjectBest = score;
    }

    if (subjectBest > bestScore) {
      // The previous best becomes the runner-up.
      runnerUp = bestScore;
      bestScore = subjectBest;
      bestSubject = subject;
    } else if (subjectBest > runnerUp) {
      runnerUp = subjectBest;
    }
  }

  const safeScore = Math.max(0, bestScore);
  const safeRunnerUp = Math.max(0, runnerUp);

  if (!bestSubject || bestScore < threshold) {
    return { name: "Unknown", subjectId: null, score: safeScore, runnerUp: safeRunnerUp };
  }

  return {
    name: bestSubject.name,
    subjectId: bestSubject.subjectId,
    score: safeScore,
    runnerUp: safeRunnerUp,
  };
}

/**
 * The 3-in-a-row rule.
 *
 * WHY: a single frame can produce a false match (bad angle, motion blur). One
 * wrong name that flickers is worse than a name that appears a second later.
 * The counter resets as soon as a different name wins.
 */
export function applyVote(track: Track, outcome: MatchOutcome): void {
  if (track.voteName === outcome.name) {
    track.voteCount += 1;
  } else {
    track.voteName = outcome.name;
    track.voteCount = 1;
  }

  if (track.voteCount >= VOTES_REQUIRED && track.name === null) {
    track.name = outcome.name;
  }
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
