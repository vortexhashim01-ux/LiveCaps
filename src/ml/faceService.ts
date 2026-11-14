import type HumanType from "@vladmandic/human";
import type { Config } from "@vladmandic/human";
import { env } from "../config/env";

export interface DetectedFace {
  /** Box in the coordinates of the image/canvas that was passed in. */
  box: { x: number; y: number; width: number; height: number };
  /** 0..1 detection + description confidence. */
  score: number;
  /** Face descriptor, or null when the description model produced nothing. */
  embedding: number[] | null;
}

/**
 * Face detection + face descriptors, on top of @vladmandic/human.
 *
 * WHY Human for this job: MediaPipe has no "who is this person" model. Human
 * bundles a face detector (BlazeFace) and a face recognition model (faceres)
 * that returns a descriptor we can compare with cosine similarity.
 *
 * Everything except face detection/description is switched off: body, hand,
 * object, gesture, emotion, iris, mesh, age and gender. They cost time and
 * battery and this app never uses them.
 */
class FaceService {
  private human: HumanType | null = null;
  private loading: Promise<void> | null = null;
  private backend: "webgl" | "cpu" | null = null;

  get ready(): boolean {
    return this.human !== null;
  }

  /** Which TFJS backend actually initialized (shown in the Debug panel). */
  get activeBackend(): "webgl" | "cpu" | null {
    return this.backend;
  }

  /** Load the models once. Concurrent callers share the same promise. */
  async init(): Promise<void> {
    if (this.human) return;
    if (!this.loading) {
      this.loading = this.create().catch((error: unknown) => {
        // Allow a retry after a failed download.
        this.loading = null;
        throw error;
      });
    }
    await this.loading;
  }

  private buildConfig(backend: "webgl" | "cpu"): Partial<Config> {
    return {
      modelBasePath: env.humanModelsPath,
      backend,
      // Frame-to-frame smoothing is pointless for single still images.
      filter: { enabled: false },
      cacheSensitivity: 0,
      face: {
        enabled: true,
        detector: {
          rotation: false,
          maxDetected: 4,
          minConfidence: 0.3,
          // Reject tiny faces early: a 20px face has no usable descriptor.
          minSize: 40,
        },
        mesh: { enabled: false },
        iris: { enabled: false },
        emotion: { enabled: false },
        // Age/gender are outputs of the description model; leaving them on adds
        // work without adding accuracy for recognition.
        attention: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
        gear: { enabled: false },
        // This is the model that produces the embedding.
        description: { enabled: true },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false },
    };
  }

  private async create(): Promise<void> {
    // Loaded on demand: Human bundles TensorFlow.js (~1.5 MB), and people who
    // never enroll a face should not download it at all.
    const { default: Human } = await import("@vladmandic/human");

    try {
      const human = new Human(this.buildConfig("webgl"));
      await human.load();
      this.human = human;
      this.backend = "webgl";
    } catch (webglError) {
      // Some browsers/GPUs block WebGL for WASM-heavy work; CPU is slower but works.
      console.warn("[faceService] WebGL backend failed, retrying on CPU.", webglError);
      const human = new Human(this.buildConfig("cpu"));
      await human.load();
      this.human = human;
      this.backend = "cpu";
    }
  }

  /**
   * Detect faces and compute a descriptor for each.
   * Accepts a canvas or an image; both are what enrollment and live crops produce.
   */
  async detect(source: HTMLCanvasElement | HTMLImageElement): Promise<DetectedFace[]> {
    await this.init();
    const human = this.human;
    if (!human) return [];

    const result = await human.detect(source);

    return (result.face ?? []).map((face) => ({
      box: {
        x: face.box[0],
        y: face.box[1],
        width: face.box[2],
        height: face.box[3],
      },
      score: Math.max(face.faceScore ?? 0, face.boxScore ?? 0, face.score ?? 0),
      embedding:
        Array.isArray(face.embedding) && face.embedding.length > 0
          ? Array.from(face.embedding)
          : null,
    }));
  }

  dispose(): void {
    this.human = null;
    this.loading = null;
    this.backend = null;
  }
}

export const faceService = new FaceService();
