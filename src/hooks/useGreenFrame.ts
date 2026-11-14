import { useEffect, useState } from "react";
import type { RefObject } from "react";

export interface GreenFrameState {
  /** True after several checks in a row saw a flat green frame. */
  isGreen: boolean;
  /** Share of sampled pixels that look green (0..1), useful in Debug. */
  ratio: number;
}

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 24;
const CHECK_INTERVAL_MS = 600;
/** A real scene rarely has 90% green pixels... */
const GREEN_RATIO = 0.9;
/** ...and a real green wall is not perfectly flat. */
const MAX_GREEN_STD = 12;
/** One bad frame is not enough to accuse the camera. */
const CONSECUTIVE_CHECKS = 2;

const IDLE: GreenFrameState = { isGreen: false, ratio: 0 };

/**
 * Watches the video for the classic "virtual camera is broken" green frame.
 *
 * WHY: DroidCam and similar drivers sometimes hand Chromium a solid green
 * image. The app itself cannot fix the driver, but it can tell the user what is
 * happening and suggest compatibility mode instead of letting them think face
 * recognition is broken.
 *
 * Sampling is tiny (32x24) and runs under twice a second, so it costs almost
 * nothing next to the detector.
 */
export function useGreenFrame(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): GreenFrameState {
  const [state, setState] = useState<GreenFrameState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    let stopped = false;
    let timer = 0;
    let streak = 0;

    const check = () => {
      if (stopped) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        streak = 0;
        timer = window.setTimeout(check, CHECK_INTERVAL_MS);
        return;
      }

      let pixels: Uint8ClampedArray;
      try {
        context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
      } catch {
        // A tainted canvas cannot happen with a camera stream, but never let a
        // diagnostic helper break the page.
        timer = window.setTimeout(check, CHECK_INTERVAL_MS);
        return;
      }

      const total = SAMPLE_WIDTH * SAMPLE_HEIGHT;
      let greenPixels = 0;
      let sum = 0;
      let sumSquares = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];

        // Bright, clearly green and not just a dark grey frame.
        if (green > 60 && green > red * 1.25 && green > blue * 1.25) {
          greenPixels += 1;
        }

        sum += green;
        sumSquares += green * green;
      }

      const ratio = greenPixels / total;
      const mean = sum / total;
      const std = Math.sqrt(Math.max(0, sumSquares / total - mean * mean));
      const flatGreen = ratio >= GREEN_RATIO && std <= MAX_GREEN_STD;

      streak = flatGreen ? streak + 1 : 0;
      const isGreen = streak >= CONSECUTIVE_CHECKS;

      // Only re-render when the verdict changes or the ratio moves noticeably;
      // otherwise this would repaint the Live page every 600 ms.
      setState((previous) =>
        previous.isGreen === isGreen && Math.abs(previous.ratio - ratio) < 0.02
          ? previous
          : { isGreen, ratio },
      );

      timer = window.setTimeout(check, CHECK_INTERVAL_MS);
    };

    timer = window.setTimeout(check, CHECK_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled, videoRef]);

  return state;
}
