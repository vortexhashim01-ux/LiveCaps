import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import type { ObjectDetectorOptions } from "@mediapipe/tasks-vision";
import { env } from "../config/env";
import { classifyCategory } from "./labels";
import type { FrameDetection } from "./types";

type Delegate = "GPU" | "CPU";

/**
 * Wraps MediaPipe's ObjectDetector so the rest of the app never touches the
 * MediaPipe API directly. Stage 7 can swap this for a Web Worker without
 * changing any component.
 *
 * It is a class with a single exported instance so the ~7 MB model is loaded
 * exactly once per page load.
 */
class ObjectDetectorService {
  private detector: ObjectDetector | null = null;
  private starting: Promise<ObjectDetector> | null = null;
  private delegate: Delegate | null = null;
  private lastTimestamp = 0;

  /** "GPU" or "CPU" once loaded, null before that. Shown in the UI. */
  get activeDelegate(): Delegate | null {
    return this.delegate;
  }

  /** True once the model can actually run. */
  get ready(): boolean {
    return this.detector !== null;
  }

  /** Load the model. Safe to call many times: the work happens only once. */
  init(): Promise<ObjectDetector> {
    if (this.detector) return Promise.resolve(this.detector);

    if (!this.starting) {
      this.starting = this.create().catch((error: unknown) => {
        // WHY reset: if the download failed (offline, blocked CDN) the user
        // must be able to retry without reloading the whole page.
        this.starting = null;
        throw error;
      });
    }

    return this.starting;
  }

  private async create(): Promise<ObjectDetector> {
    // The WASM runtime is the "engine"; the .tflite file is the "brain".
    const fileset = await FilesetResolver.forVisionTasks(env.mediapipeWasmUrl);

    const options = (delegate: Delegate): ObjectDetectorOptions => ({
      baseOptions: {
        modelAssetPath: env.objectModelUrl,
        delegate,
      },
      runningMode: "VIDEO",
      scoreThreshold: env.detectionConfidence,
      maxResults: 20,
    });

    let detector: ObjectDetector;
    try {
      // GPU is several times faster. Not every browser/phone allows it, though.
      detector = await ObjectDetector.createFromOptions(fileset, options("GPU"));
      this.delegate = "GPU";
    } catch (gpuError) {
      console.warn("[objectDetector] GPU unavailable, falling back to CPU.", gpuError);
      detector = await ObjectDetector.createFromOptions(fileset, options("CPU"));
      this.delegate = "CPU";
    }

    this.detector = detector;
    return detector;
  }

  /**
   * Run one detection on the current video frame.
   * Returns [] when the model is not ready yet, so callers never need null checks.
   */
  detect(video: HTMLVideoElement, timestampMs: number): FrameDetection[] {
    const detector = this.detector;
    if (!detector) return [];

    // MediaPipe VIDEO mode requires strictly increasing timestamps.
    const timestamp =
      timestampMs > this.lastTimestamp ? timestampMs : this.lastTimestamp + 1;
    this.lastTimestamp = timestamp;

    const result = detector.detectForVideo(video, timestamp);
    const found: FrameDetection[] = [];

    result.detections.forEach((detection, index) => {
      const box = detection.boundingBox;
      const best = detection.categories[0];
      if (!box || !best) return;

      const info = classifyCategory(best.categoryName);
      if (!info) return; // chairs, cups, cars... not interesting here

      found.push({
        key: `${index}:${best.categoryName}`,
        label: info.label,
        category: best.categoryName,
        kind: info.kind,
        confidence: best.score,
        box: {
          x: box.originX,
          y: box.originY,
          width: box.width,
          height: box.height,
        },
      });
    });

    return found;
  }

  /** Free WASM memory. Called when the camera page unmounts for a long time. */
  dispose(): void {
    this.detector?.close();
    this.detector = null;
    this.starting = null;
    this.delegate = null;
    this.lastTimestamp = 0;
  }
}

export const objectDetector = new ObjectDetectorService();
