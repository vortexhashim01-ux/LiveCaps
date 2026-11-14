import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { LandmarkFrame } from "../ml/landmarkers";
import { EMPTY_MOTION, createMotionAnalyzer } from "../ml/motionAnalysis";
import type { MotionAnalysis, MotionAnalyzer } from "../ml/motionAnalysis";

interface Options {
  /** The exact frame the landmark loop already produced. No extra inference. */
  frame: LandmarkFrame;
  /** False while the camera is not running. */
  enabled: boolean;
  /** Needed for the video aspect ratio, which keeps angles and speeds honest. */
  videoRef: RefObject<HTMLVideoElement | null>;
}

export interface MovementResult {
  analysis: MotionAnalysis;
}

/**
 * Turns each landmark frame into trails, gestures, angles and a movement label.
 *
 * WHY an effect on `frame` instead of its own loop: the landmark loop already
 * runs at the requested FPS on the existing <video> element. Analysis is pure
 * arithmetic on those results, so it reuses them instead of touching the
 * camera or duplicating inference.
 */
export function useMovementAnalysis({ frame, enabled, videoRef }: Options): MovementResult {
  const [analysis, setAnalysis] = useState<MotionAnalysis>(EMPTY_MOTION);
  const analyzerRef = useRef<MotionAnalyzer | null>(null);

  if (analyzerRef.current === null) {
    analyzerRef.current = createMotionAnalyzer();
  }

  useEffect(() => {
    const analyzer = analyzerRef.current;
    if (!analyzer) return;

    if (!enabled) {
      analyzer.reset();
      setAnalysis(EMPTY_MOTION);
      return;
    }

    const video = videoRef.current;
    const aspect =
      video && video.videoWidth > 0 && video.videoHeight > 0
        ? video.videoWidth / video.videoHeight
        : 16 / 9;

    setAnalysis(analyzer.update(frame.poses, frame.hands, performance.now(), aspect));
  }, [frame, enabled, videoRef]);

  return { analysis };
}
