import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { objectDetector } from "../ml/objectDetector";
import type { FrameDetection } from "../ml/types";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** False while the camera is still starting: no point running the model. */
  enabled: boolean;
  /** How many detections per second we aim for. */
  targetFps: number;
}

export interface DetectionLoopResult {
  detections: FrameDetection[];
  /** Measured inferences per second, not the requested value. */
  fps: number;
  status: ModelStatus;
  error: string | null;
}

/**
 * Runs the object detector on the video element at a limited rate.
 *
 * WHY requestAnimationFrame + a time check instead of setInterval:
 * requestAnimationFrame pauses automatically when the tab is hidden, so we do
 * not burn battery in the background, and the time check keeps inference at
 * ~8 per second instead of the display's 60.
 */
export function useDetectionLoop({ videoRef, enabled, targetFps }: Options): DetectionLoopResult {
  const [detections, setDetections] = useState<FrameDetection[]>([]);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setDetections([]);
      setFps(0);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let lastInference = 0;
    let framesInWindow = 0;
    let windowStart = performance.now();
    let lastTimestamp = 0;

    setStatus("loading");
    setError(null);

    objectDetector
      .init()
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(
          caught instanceof Error
            ? `The detection model could not load: ${caught.message}`
            : "The detection model could not load. Check your internet connection and tap Retry.",
        );
      });

    const minFrameMs = 1000 / Math.max(1, targetFps);

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      // readyState < 2 means the video has no usable frame yet.
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      // Do not count attempts made while the model is still downloading: the
      // FPS badge should describe real inference, not skipped frames.
      if (!objectDetector.ready) return;

      const now = performance.now();
      if (now - lastInference < minFrameMs) return;
      lastInference = now;

      try {
        // Always increasing, as MediaPipe VIDEO mode requires.
        lastTimestamp = Math.max(now, lastTimestamp + 1);
        setDetections(objectDetector.detect(video, lastTimestamp));
      } catch (caught) {
        // One bad frame must not kill the loop; skip it and try the next one.
        console.warn("[detectionLoop] frame skipped:", caught);
        return;
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

  return { detections, fps, status, error };
}
