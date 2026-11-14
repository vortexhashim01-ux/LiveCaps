import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type {
  FaceLandmarkerOptions,
  HandLandmarkerOptions,
  NormalizedLandmark,
  PoseLandmarkerOptions,
} from "@mediapipe/tasks-vision";
import { env } from "../config/env";

/**
 * Official MediaPipe Tasks Vision model bundles.
 *
 * WHY these versions: they are the float16 "1" bundles published by MediaPipe
 * and are pinned, like the object detector, so a silent model update cannot
 * change landmark indices or accuracy behind our back.
 *
 * Pose uses the *lite* bundle: it is the real-time variant and still returns
 * all 33 body points. Hand and face use the standard bundles.
 */
const MODEL_URLS = {
  pose: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
} as const;

type Delegate = "GPU" | "CPU";
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Normalized [0..1] points for every body, hand and face found in a frame. */
export interface LandmarkFrame {
  poses: NormalizedLandmark[][];
  hands: NormalizedLandmark[][];
  faces: NormalizedLandmark[][];
  /**
   * Pose segmentation masks (one per pose, same order) when the caller asked
   * for them. Copy of the model's buffer, because MediaPipe reuses it.
   */
  masks: SegmentationMask[];
}

/** A square-ish 0..1 coverage map for one detected body. */
export interface SegmentationMask {
  width: number;
  height: number;
  data: Float32Array;
}

export interface LandmarkConnection {
  start: number;
  end: number;
}

export const EMPTY_LANDMARKS: LandmarkFrame = {
  poses: [],
  hands: [],
  faces: [],
  masks: [],
};


/**
 * One shared service for all three landmarkers.
 *
 * WHY a single service instead of three hooks: the three models share one WASM
 * fileset, one video element and one timestamp sequence, and the overlay needs
 * one synchronized frame. It also means the ~18 MB of models download once and
 * are reused when the user leaves and reopens the Live page.
 */
class LandmarkService {
  private fileset: Promise<VisionFileset> | null = null;

  private pose: PoseLandmarker | null = null;
  private hand: HandLandmarker | null = null;
  private face: FaceLandmarker | null = null;

  private startingPose: Promise<PoseLandmarker> | null = null;
  private startingHand: Promise<HandLandmarker> | null = null;
  private startingFace: Promise<FaceLandmarker> | null = null;

  private lastPoseTimestamp = 0;
  private lastHandTimestamp = 0;
  private lastFaceTimestamp = 0;
  private warned = new Set<string>();

  /** True once at least one landmarker can run. */
  get ready(): boolean {
    return this.pose !== null || this.hand !== null || this.face !== null;
  }

  initPose(): Promise<PoseLandmarker> {
    if (this.pose) return Promise.resolve(this.pose);
    if (!this.startingPose) {
      this.startingPose = this.getFileset()
        .then((fileset) => this.createPose(fileset))
        .then((task) => {
          this.pose = task;
          return task;
        })
        .catch((error: unknown) => {
          // A failed download must be retryable without a full page reload.
          this.startingPose = null;
          throw error;
        });
    }
    return this.startingPose;
  }

  initHand(): Promise<HandLandmarker> {
    if (this.hand) return Promise.resolve(this.hand);
    if (!this.startingHand) {
      this.startingHand = this.getFileset()
        .then((fileset) => this.createHand(fileset))
        .then((task) => {
          this.hand = task;
          return task;
        })
        .catch((error: unknown) => {
          this.startingHand = null;
          throw error;
        });
    }
    return this.startingHand;
  }

  initFace(): Promise<FaceLandmarker> {
    if (this.face) return Promise.resolve(this.face);
    if (!this.startingFace) {
      this.startingFace = this.getFileset()
        .then((fileset) => this.createFace(fileset))
        .then((task) => {
          this.face = task;
          return task;
        })
        .catch((error: unknown) => {
          this.startingFace = null;
          throw error;
        });
    }
    return this.startingFace;
  }

  /**
   * Run every ready landmarker on the current video frame.
   *
   * Each task keeps its own timestamp because MediaPipe VIDEO mode requires
   * strictly increasing values per task, and one failing task must never stop
   * the other two from drawing.
   *
   * `withSegmentation` only controls the (relatively expensive) copy of the
   * pose masks out of the model; the mask itself is computed either way because
   * toggling it at runtime would mean rebuilding the pose landmarker.
   */
  detect(video: HTMLVideoElement, timestampMs: number, withSegmentation = false): LandmarkFrame {
    let poses: NormalizedLandmark[][] = [];
    let hands: NormalizedLandmark[][] = [];
    let faces: NormalizedLandmark[][] = [];
    let masks: SegmentationMask[] = [];

    if (this.pose) {
      this.lastPoseTimestamp = nextTimestamp(timestampMs, this.lastPoseTimestamp);
      try {
        const result = this.pose.detectForVideo(video, this.lastPoseTimestamp);
        poses = result.landmarks;

        if (withSegmentation && result.segmentationMasks) {
          masks = result.segmentationMasks.map((mask) => ({
            width: mask.width,
            height: mask.height,
            // slice(): the model's buffer is overwritten on the next frame.
            data: mask.getAsFloat32Array().slice(),
          }));
        }
      } catch (error) {
        this.warnOnce("pose", error);
      }
    }

    if (this.hand) {
      this.lastHandTimestamp = nextTimestamp(timestampMs, this.lastHandTimestamp);
      try {
        hands = this.hand.detectForVideo(video, this.lastHandTimestamp).landmarks;
      } catch (error) {
        this.warnOnce("hand", error);
      }
    }

    if (this.face) {
      this.lastFaceTimestamp = nextTimestamp(timestampMs, this.lastFaceTimestamp);
      try {
        faces = this.face.detectForVideo(video, this.lastFaceTimestamp).faceLandmarks;
      } catch (error) {
        this.warnOnce("face", error);
      }
    }

    return { poses, hands, faces, masks };
  }

  /** Free WASM memory when the whole feature is turned off for a long time. */
  dispose(): void {
    this.pose?.close();
    this.hand?.close();
    this.face?.close();
    this.pose = null;
    this.hand = null;
    this.face = null;
    this.startingPose = null;
    this.startingHand = null;
    this.startingFace = null;
    this.fileset = null;
    this.lastPoseTimestamp = 0;
    this.lastHandTimestamp = 0;
    this.lastFaceTimestamp = 0;
    this.warned.clear();
  }

  private getFileset(): Promise<VisionFileset> {
    if (!this.fileset) {
      this.fileset = FilesetResolver.forVisionTasks(env.mediapipeWasmUrl).catch(
        (error: unknown) => {
          this.fileset = null;
          throw error;
        },
      );
    }
    return this.fileset;
  }

  private async createPose(fileset: VisionFileset): Promise<PoseLandmarker> {
    const options = (delegate: Delegate): PoseLandmarkerOptions => ({
      baseOptions: { modelAssetPath: MODEL_URLS.pose, delegate },
      runningMode: "VIDEO",
      // Four people covers a family or a small group without making the model
      // do unbounded work on a crowded street.
      numPoses: 4,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      // The silhouette feature (Live page toggle) reads these masks. The pose
      // lite bundle already supports them; enabling costs a little inference
      // time but avoids rebuilding the landmarker when the toggle flips.
      outputSegmentationMasks: true,
    });

    try {
      return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch (gpuError) {
      console.warn("[landmarkers] pose GPU unavailable, falling back to CPU.", gpuError);
      return PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  private async createHand(fileset: VisionFileset): Promise<HandLandmarker> {
    const options = (delegate: Delegate): HandLandmarkerOptions => ({
      baseOptions: { modelAssetPath: MODEL_URLS.hand, delegate },
      runningMode: "VIDEO",
      // Both hands for up to two people in frame.
      numHands: 4,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    try {
      return await HandLandmarker.createFromOptions(fileset, options("GPU"));
    } catch (gpuError) {
      console.warn("[landmarkers] hand GPU unavailable, falling back to CPU.", gpuError);
      return HandLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  private async createFace(fileset: VisionFileset): Promise<FaceLandmarker> {
    const options = (delegate: Delegate): FaceLandmarkerOptions => ({
      baseOptions: { modelAssetPath: MODEL_URLS.face, delegate },
      runningMode: "VIDEO",
      numFaces: 4,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      // We only draw 2D contours; blendshapes and matrices would add work.
      outputFacialTransformationMatrixes: false,
    });

    try {
      return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch (gpuError) {
      console.warn("[landmarkers] face GPU unavailable, falling back to CPU.", gpuError);
      return FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  private warnOnce(key: string, error: unknown): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[landmarkers] ${key} frame skipped:`, error);
  }
}

export const landmarkers = new LandmarkService();

/**
 * Official connection tables, copied into plain objects so the overlay does not
 * depend on MediaPipe's non-exported `Connection` type.
 */
function copyConnections(connections: { start: number; end: number }[]): LandmarkConnection[] {
  return connections.map(({ start, end }) => ({ start, end }));
}

export const POSE_CONNECTIONS = copyConnections(PoseLandmarker.POSE_CONNECTIONS);
export const HAND_CONNECTIONS = copyConnections(HandLandmarker.HAND_CONNECTIONS);
export const FACE_CONNECTIONS = copyConnections([
  ...FaceLandmarker.FACE_LANDMARKS_CONTOURS,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
]);

/** Only the points that belong to a face connection, so the face stays readable. */
export const FACE_POINT_INDICES = Array.from(
  new Set(FACE_CONNECTIONS.flatMap(({ start, end }) => [start, end])),
);

function nextTimestamp(now: number, last: number): number {
  return now > last ? now : last + 1;
}
