import type { DetectionKind, FrameDetection, VideoBox } from "./types";

/** Two boxes must overlap this much to be considered the same object. */
const IOU_THRESHOLD = 0.3;

/** How long a track survives without a matching detection (ms). */
const TRACK_TTL_MS = 1500;

/** Upper bound so a busy scene cannot create unbounded work. */
const MAX_TRACKS = 12;

export type RecognitionNote =
  | "none"
  | "ok"
  | "no-face"
  | "multiple-faces"
  | "small-face"
  | "no-embedding"
  | "error";

export interface Track {
  id: number;
  kind: DetectionKind;
  category: string;
  label: string;
  confidence: number;
  box: VideoBox;
  firstSeen: number;
  lastSeen: number;
  hits: number;

  /** Confirmed name, null until the voting rule is satisfied. */
  name: string | null;
  /** Latest best similarity score (null before the first attempt). */
  bestScore: number | null;
  /** Highest best-score seen on this track, used for automatic tuning. */
  peakScore: number | null;
  /** Best score of the runner-up identity, for threshold tuning. */
  runnerUpScore: number | null;
  /** Width of the detected face in video pixels (people only). */
  faceWidthPx: number | null;
  attempts: number;
  lastAttemptAt: number;
  voteName: string | null;
  voteCount: number;
  /** True once we stopped trying (out of attempts). */
  gaveUp: boolean;
  /** True once this track's score was added to the tuning samples. */
  scored: boolean;
  note: RecognitionNote;
}

function intersectionOverUnion(a: VideoBox, b: VideoBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  const overlapWidth = right - left;
  const overlapHeight = bottom - top;
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;

  const overlap = overlapWidth * overlapHeight;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union <= 0 ? 0 : overlap / union;
}

/**
 * Gives every detected object a stable id across frames.
 *
 * WHY this matters: recognition is expensive, so we run it once per object and
 * reuse the answer. Without a tracker every frame would be a "new" object and
 * the app would re-run face matching 8 times a second.
 *
 * Matching is greedy IoU: for each existing track, take the best overlapping
 * unused detection of the same kind. Simple, fast, and good enough for a
 * camera that moves slowly.
 */
export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;

  update(detections: FrameDetection[], now: number): Track[] {
    const claimed = new Set<number>();

    for (const track of this.tracks) {
      let bestIndex = -1;
      let bestIou = IOU_THRESHOLD;

      detections.forEach((detection, index) => {
        if (claimed.has(index) || detection.kind !== track.kind) return;
        const iou = intersectionOverUnion(track.box, detection.box);
        if (iou > bestIou) {
          bestIou = iou;
          bestIndex = index;
        }
      });

      if (bestIndex >= 0) {
        claimed.add(bestIndex);
        const detection = detections[bestIndex];
        track.box = detection.box;
        track.confidence = detection.confidence;
        track.label = detection.label;
        track.category = detection.category;
        track.lastSeen = now;
        track.hits += 1;
      }
    }

    detections.forEach((detection, index) => {
      if (claimed.has(index)) return;
      if (this.tracks.length >= MAX_TRACKS) return;

      this.tracks.push({
        id: this.nextId++,
        kind: detection.kind,
        category: detection.category,
        label: detection.label,
        confidence: detection.confidence,
        box: detection.box,
        firstSeen: now,
        lastSeen: now,
        hits: 1,
        name: null,
        bestScore: null,
        peakScore: null,
        runnerUpScore: null,
        faceWidthPx: null,
        attempts: 0,
        lastAttemptAt: 0,
        voteName: null,
        voteCount: 0,
        gaveUp: false,
        scored: false,
        note: "none",
      });
    });

    // Drop objects that left the frame. Their name dies with the track, which is
    // what "reused until the track disappears" means.
    this.tracks = this.tracks.filter((track) => now - track.lastSeen <= TRACK_TTL_MS);

    return this.tracks;
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }
}
