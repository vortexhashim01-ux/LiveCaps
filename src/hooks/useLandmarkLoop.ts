import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { EMPTY_LANDMARKS, landmarkers } from "../ml/landmarkers";
import type { LandmarkFrame } from "../ml/landmarkers";
import type { ModelStatus } from "./useDetectionLoop";

/** How long a skeleton may stay on screen after the model briefly loses it. */
const HOLD_MS = 250;

export interface LandmarkStatus {
  pose: ModelStatus;
  hand: ModelStatus;
  face: ModelStatus;
}

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** False while the camera is not running. */
  enabled: boolean;
  /** Target landmark inferences per second. */
  targetFps: number;
  /**
   * Ask for pose segmentation masks (used by the silhouette overlay).
   * Read from a ref inside the loop, so flipping it never restarts the models.
   */
  segmentation?: boolean;
}

export interface LandmarkLoopResult {
  frame: LandmarkFrame;
  status: LandmarkStatus;
  /** Measured landmark passes per second, shown in the Debug panel. */
  fps: number;
  error: string | null;
}

const IDLE_STATUS: LandmarkStatus = { pose: "idle", hand: "idle", face: "idle" };

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : "unknown error";
}

/**
 * Runs pose, hand and face landmarkers on the existing camera frame.
 *
 * WHY a separate loop from the object detector: landmark models are heavier
 * and can run at their own cadence. The object detector still supplies the
 * tracks used for names; this loop only supplies the visual landmarks.
 *
 * All three tasks read the same <video> element, so no second camera stream is
 * created and the landmarks always match the preview.
 */
export function useLandmarkLoop({
  videoRef,
  enabled,
  targetFps,
  segmentation = false,
}: Options): LandmarkLoopResult {
  const [frame, setFrame] = useState<LandmarkFrame>(EMPTY_LANDMARKS);
  const [status, setStatus] = useState<LandmarkStatus>(IDLE_STATUS);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const previousFrame = useRef<LandmarkFrame>(EMPTY_LANDMARKS);
  const holdUntil = useRef({ pose: 0, hand: 0, face: 0 });

  // A ref (not a dependency) so toggling the silhouette does not tear down and
  // reload the landmark models.
  const segmentationRef = useRef(segmentation);
  segmentationRef.current = segmentation;

  useEffect(() => {
    if (!enabled) {
      setStatus(IDLE_STATUS);
      setFrame(EMPTY_LANDMARKS);
      setFps(0);
      previousFrame.current = EMPTY_LANDMARKS;
      holdUntil.current = { pose: 0, hand: 0, face: 0 };
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let lastInference = 0;
    let framesInWindow = 0;
    let windowStart = performance.now();

    setStatus({ pose: "loading", hand: "loading", face: "loading" });
    setError(null);

    const failures: string[] = [];

    const start = (
      key: keyof LandmarkStatus,
      label: string,
      init: () => Promise<unknown>,
    ) => {
      init()
        .then(() => {
          if (!cancelled) {
            setStatus((current) => ({ ...current, [key]: "ready" }));
          }
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setStatus((current) => ({ ...current, [key]: "error" }));
          failures.push(`${label}: ${message(caught)}`);
          setError(`Landmark tracking could not load (${failures.join("; ")}).`);
        });
    };

    // Load independently: a blocked face model must not disable pose or hands.
    start("pose", "pose", () => landmarkers.initPose());
    start("hand", "hands", () => landmarkers.initHand());
    start("face", "face", () => landmarkers.initFace());

    const minFrameMs = 1000 / Math.max(1, targetFps);

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      // readyState < 2 means there is no usable frame yet.
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      if (!landmarkers.ready) return;

      const now = performance.now();
      if (now - lastInference < minFrameMs) return;
      lastInference = now;

      let next: LandmarkFrame;
      try {
        next = landmarkers.detect(video, now, segmentationRef.current);
      } catch (caught) {
        // The service already isolates per-task failures; this is a last
        // resort so one bad frame cannot kill the loop.
        console.warn("[landmarkLoop] frame skipped:", caught);
        return;
      }

      // Keep the last skeleton for a moment when the model blinks, then let it
      // disappear. This avoids flicker without showing stale poses forever.
      const previous = previousFrame.current;
      const held = holdUntil.current;
      const merged: LandmarkFrame = {
        poses:
          next.poses.length > 0
            ? next.poses
            : now < held.pose
              ? previous.poses
              : EMPTY_LANDMARKS.poses,
        hands:
          next.hands.length > 0
            ? next.hands
            : now < held.hand
              ? previous.hands
              : EMPTY_LANDMARKS.hands,
        faces:
          next.faces.length > 0
            ? next.faces
            : now < held.face
              ? previous.faces
              : EMPTY_LANDMARKS.faces,
        // Masks describe the poses of *this* frame only; never pair a held
        // pose with a stale silhouette.
        masks: next.poses.length > 0 ? next.masks : EMPTY_LANDMARKS.masks,
      };

      if (next.poses.length > 0) held.pose = now + HOLD_MS;
      if (next.hands.length > 0) held.hand = now + HOLD_MS;
      if (next.faces.length > 0) held.face = now + HOLD_MS;

      // A frame with no landmarks and nothing held looks exactly like the last
      // one; skip the render instead of repainting the whole page at 8 fps.
      const unchanged =
        merged.poses === previous.poses &&
        merged.hands === previous.hands &&
        merged.faces === previous.faces;
      if (!unchanged) {
        previousFrame.current = merged;
        setFrame(merged);
      }

      framesInWindow += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 1000) {
        setFps(Math.round((framesInWindow * 1000) / elapsed));
        framesInWindow = 0;
        windowStart = now;
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, targetFps, videoRef]);

  return { frame, status, fps, error };
}
