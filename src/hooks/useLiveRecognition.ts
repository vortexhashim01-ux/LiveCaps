import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { env } from "../config/env";
import { cropVideoFrame } from "../ml/imageUtils";
import { faceService } from "../ml/faceService";
import { petService } from "../ml/petService";
import { applyVote, matchSubject, round3 } from "../ml/recognizer";
import { Tracker } from "../ml/tracker";
import type { Track } from "../ml/tracker";
import type { FrameDetection } from "../ml/types";
import { useSettingsStore } from "../store/settingsStore";
import type { Gallery } from "./useEmbeddingGallery";

/** Stop trying after this many attempts; the object is probably not enrolled. */
const MAX_ATTEMPTS = 12;

/** Minimum gap between two attempts on the same object (ms). */
const ATTEMPT_INTERVAL_MS = 700;

export type ModelStatus = "idle" | "loading" | "ready" | "error";

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  detections: FrameDetection[];
  /** False when the camera is not running. */
  enabled: boolean;
  gallery: Gallery;
}

export interface LiveRecognition {
  tracks: Track[];
  faceStatus: ModelStatus;
  petStatus: ModelStatus;
  faceError: string | null;
  petError: string | null;
  /** Total successful recognitions, shown in the Debug panel. */
  recognitions: number;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * Add a finished track to the active camera's tuning samples.
 *
 * WHY only once per track: the tuning data should represent encounters, not
 * frames. A person standing still for a minute would otherwise dominate the
 * samples and freeze the threshold.
 *
 * Known tracks contribute the score that confirmed the name. Unknown tracks
 * contribute their highest score, because that is the score most likely to
 * steal an enrolled name.
 */
function recordTuningSample(track: Track): void {
  if (track.scored || track.name === null) return;

  const score = track.name === "Unknown" ? track.peakScore : track.bestScore;
  if (score === null) return;

  track.scored = true;
  useSettingsStore
    .getState()
    .recordScore(track.kind === "person" ? "face" : "pet", score, track.name !== "Unknown");
}

/**
 * Turns raw detections into named tracks.
 *
 * Two separate jobs, deliberately split:
 *  1. tracking (fast, every frame) gives each object a stable id;
 *  2. recognition (slow, one object at a time) runs only for objects that still
 *     have no name, so a named person is never re-scanned while on screen.
 */
export function useLiveRecognition({
  videoRef,
  detections,
  enabled,
  gallery,
}: Options): LiveRecognition {
  const trackerRef = useRef<Tracker | null>(null);
  if (trackerRef.current === null) trackerRef.current = new Tracker();

  const [tracks, setTracks] = useState<Track[]>([]);
  const tracksRef = useRef<Track[]>([]);

  const [faceStatus, setFaceStatus] = useState<ModelStatus>("idle");
  const [petStatus, setPetStatus] = useState<ModelStatus>("idle");
  const [faceError, setFaceError] = useState<string | null>(null);
  const [petError, setPetError] = useState<string | null>(null);
  const [recognitions, setRecognitions] = useState(0);

  // Read the newest gallery/settings inside async work without stale closures.
  const galleryRef = useRef(gallery);
  galleryRef.current = gallery;

  const commit = useCallback((next: Track[]) => {
    tracksRef.current = next;
    setTracks(next);
  }, []);

  // --- 1. Tracking -------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      trackerRef.current?.reset();
      commit([]);
      return;
    }

    const tracker = trackerRef.current;
    if (!tracker) return;

    const next = tracker.update(detections, performance.now());
    // New array reference so React re-renders; the track objects are reused.
    commit([...next]);
  }, [detections, enabled, commit]);

  // --- 2. Model loading --------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    if (gallery.people.length === 0) {
      setFaceStatus("idle");
    } else if (faceService.ready) {
      setFaceStatus("ready");
    } else {
      setFaceStatus("loading");
      faceService
        .init()
        .then(() => {
          if (!cancelled) setFaceStatus("ready");
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setFaceStatus("error");
          setFaceError(
            errorMessage(caught, "The face models could not be downloaded."),
          );
        });
    }

    if (gallery.pets.length === 0) {
      setPetStatus("idle");
    } else if (petService.ready) {
      setPetStatus("ready");
    } else {
      setPetStatus("loading");
      petService
        .init()
        .then(() => {
          if (!cancelled) setPetStatus("ready");
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setPetStatus("error");
          setPetError(
            errorMessage(caught, "The pet embedding model could not be downloaded."),
          );
        });
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, gallery.people.length, gallery.pets.length]);

  // --- 3. Recognition ----------------------------------------------------
  const recognise = useCallback(
    async (track: Track): Promise<void> => {
      const video = videoRef.current;
      if (!video) return;

      const isPerson = track.kind === "person";
      const petCandidates = isPerson
        ? []
        : galleryRef.current.pets.filter((pet) => pet.petType === track.category);

      // Nothing enrolled for this kind of object: do not guess, do not nag.
      if (isPerson ? galleryRef.current.people.length === 0 : petCandidates.length === 0) {
        track.gaveUp = true;
        commit([...tracksRef.current]);
        return;
      }

      const crop = cropVideoFrame(video, track.box, isPerson ? 0.2 : 0.1);
      if (!crop) return;

      track.attempts += 1;
      track.lastAttemptAt = Date.now();

      if (isPerson) {
        const faces = await faceService.detect(crop);

        // The track may have left the frame while the model was working.
        if (!tracksRef.current.some((item) => item.id === track.id)) return;

        if (faces.length === 0) {
          track.note = "no-face";
        } else if (faces.length > 1) {
          // Ambiguous: two people in one box. Guessing would name the wrong one.
          track.note = "multiple-faces";
        } else {
          const face = faces[0];
          track.faceWidthPx = Math.round(face.box.width);

          if (face.box.width < env.minFaceSizePx) {
            track.note = "small-face";
          } else if (!face.embedding) {
            track.note = "no-embedding";
          } else {
            const threshold = useSettingsStore.getState().faceMatchThreshold;
            const outcome = matchSubject(face.embedding, galleryRef.current.people, threshold);
            track.bestScore = round3(outcome.score);
            track.peakScore = Math.max(track.peakScore ?? 0, track.bestScore);
            track.runnerUpScore = round3(outcome.runnerUp);
            track.note = "ok";
            applyVote(track, outcome);
            setRecognitions((count) => count + 1);
          }
        }
      } else {
        const vector = await petService.embed(crop);

        if (!tracksRef.current.some((item) => item.id === track.id)) return;

        if (vector.length === 0) {
          track.note = "no-embedding";
        } else {
          const threshold = useSettingsStore.getState().petMatchThreshold;
          const outcome = matchSubject(vector, petCandidates, threshold);
          track.bestScore = round3(outcome.score);
          track.peakScore = Math.max(track.peakScore ?? 0, track.bestScore);
          track.runnerUpScore = round3(outcome.runnerUp);
          track.note = "ok";
          applyVote(track, outcome);
          setRecognitions((count) => count + 1);
        }
      }

      if (track.attempts >= MAX_ATTEMPTS && track.name === null) {
        // Out of attempts: say "Unknown" instead of leaving the box nameless.
        track.name = "Unknown";
        track.gaveUp = true;
      }

      recordTuningSample(track);
      commit([...tracksRef.current]);
    },
    [commit, videoRef],
  );

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer = 0;

    const pickCandidate = (): Track | null => {
      const now = Date.now();
      const candidates = tracksRef.current.filter((track) => {
        if (track.name !== null || track.gaveUp) return false;
        if (track.attempts >= MAX_ATTEMPTS) return false;
        if (now - track.lastAttemptAt < ATTEMPT_INTERVAL_MS) return false;

        if (track.kind === "person") {
          return galleryRef.current.people.length > 0 && faceStatus === "ready";
        }

        const isPetCategory = track.category === "dog" || track.category === "cat";
        if (!isPetCategory) return false;
        return (
          petStatus === "ready" &&
          galleryRef.current.pets.some((pet) => pet.petType === track.category)
        );
      });

      // Prefer objects we have tried least, so a crowd is handled fairly.
      candidates.sort((a, b) => a.attempts - b.attempts || a.firstSeen - b.firstSeen);
      return candidates[0] ?? null;
    };

    const loop = async () => {
      if (stopped) return;

      const candidate = pickCandidate();
      if (candidate) {
        try {
          await recognise(candidate);
        } catch (caught) {
          console.warn("[recognition] attempt failed:", caught);
          candidate.note = "error";
          candidate.gaveUp = candidate.attempts >= MAX_ATTEMPTS;
          commit([...tracksRef.current]);
        }
      }

      if (!stopped) timer = window.setTimeout(loop, 250);
    };

    timer = window.setTimeout(loop, 400);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled, faceStatus, petStatus, recognise, commit]);

  return { tracks, faceStatus, petStatus, faceError, petError, recognitions };
}
