import { FilesetResolver, ImageEmbedder } from "@mediapipe/tasks-vision";
import type { ImageEmbedderOptions } from "@mediapipe/tasks-vision";
import { env } from "../config/env";

/**
 * Turns a pet crop into a vector with MediaPipe's ImageEmbedder
 * (MobileNetV3-small), so two photos of the same animal land close together.
 *
 * WHY not a face model: pet faces are not human faces. A generic image
 * embedding is the pragmatic choice, and it is honest about its limits —
 * look-alike pets of the same breed can confuse it.
 */
class PetService {
  private embedder: ImageEmbedder | null = null;
  private loading: Promise<void> | null = null;
  private delegate: "GPU" | "CPU" | null = null;

  get ready(): boolean {
    return this.embedder !== null;
  }

  get activeDelegate(): "GPU" | "CPU" | null {
    return this.delegate;
  }

  async init(): Promise<void> {
    if (this.embedder) return;
    if (!this.loading) {
      this.loading = this.create().catch((error: unknown) => {
        this.loading = null;
        throw error;
      });
    }
    await this.loading;
  }

  private async create(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(env.mediapipeWasmUrl);

    const options = (delegate: "GPU" | "CPU"): ImageEmbedderOptions => ({
      baseOptions: {
        modelAssetPath: env.embedderModelUrl,
        delegate,
      },
      runningMode: "IMAGE",
      // Normalized vectors make cosine similarity a plain dot product.
      l2Normalize: true,
      quantize: false,
    });

    try {
      this.embedder = await ImageEmbedder.createFromOptions(fileset, options("GPU"));
      this.delegate = "GPU";
    } catch (gpuError) {
      console.warn("[petService] GPU unavailable, falling back to CPU.", gpuError);
      this.embedder = await ImageEmbedder.createFromOptions(fileset, options("CPU"));
      this.delegate = "CPU";
    }
  }

  /** One vector for one image. Returns [] if the model produced nothing. */
  async embed(source: HTMLCanvasElement | HTMLImageElement): Promise<number[]> {
    await this.init();
    const embedder = this.embedder;
    if (!embedder) return [];

    const result = embedder.embed(source);
    const first = result.embeddings[0];
    const vector = first?.floatEmbedding;
    return Array.isArray(vector) ? Array.from(vector) : [];
  }

  dispose(): void {
    this.embedder?.close();
    this.embedder = null;
    this.loading = null;
    this.delegate = null;
  }
}

export const petService = new PetService();
