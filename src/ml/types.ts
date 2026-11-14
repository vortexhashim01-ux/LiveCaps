/** What kind of thing was found. Naming only applies to people and pets (later stages). */
export type DetectionKind = "person" | "animal";

/**
 * A box in *video pixel* coordinates (the same space as `video.videoWidth`).
 * WHY keep it in video pixels: the detector speaks video pixels. Conversion to
 * screen pixels happens once, in CanvasOverlay, so a resized window never
 * corrupts the stored data.
 */
export interface VideoBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One object found in one video frame. */
export interface FrameDetection {
  /** Unique per frame; the tracker replaces this with a stable id in Stage 5. */
  key: string;
  /** Human-friendly label shown on screen, e.g. "Human", "Dog". */
  label: string;
  /** Raw model category, e.g. "person", "cat". */
  category: string;
  kind: DetectionKind;
  /** 0..1 */
  confidence: number;
  box: VideoBox;
}

/**
 * What the overlay needs to draw one box.
 * Tracks (with a stable id) and raw detections both fit this shape.
 */
export interface OverlayItem {
  key: string;
  label: string;
  kind: DetectionKind;
  confidence: number;
  box: VideoBox;
  /** Confirmed identity, or null while unknown/not yet recognized. */
  name?: string | null;
}
