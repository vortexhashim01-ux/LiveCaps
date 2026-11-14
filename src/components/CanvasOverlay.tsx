import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  FACE_CONNECTIONS,
  FACE_POINT_INDICES,
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
} from "../ml/landmarkers";
import type { LandmarkConnection, LandmarkFrame, SegmentationMask } from "../ml/landmarkers";
import { TRAIL_MS } from "../ml/motionAnalysis";
import type { MotionAnalysis } from "../ml/motionAnalysis";
import type { OverlayItem } from "../ml/types";

interface CanvasOverlayProps {
  items: OverlayItem[];
  /** Pose, hand and face landmarks for the current frame. */
  landmarks: LandmarkFrame;
  /** Trails, gestures, joint angles and movement labels for the same frame. */
  analysis: MotionAnalysis;
  /** Optional body outline built from the pose segmentation masks. */
  silhouette: boolean;
  /** Needed to read videoWidth / videoHeight for the coordinate mapping. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Front camera previews are mirrored, so overlays must be mirrored too. */
  mirrored: boolean;
}

const STYLES = {
  person: { stroke: "#34d399", fill: "rgba(52, 211, 153, 0.12)", chip: "#047857" },
  animal: { stroke: "#fbbf24", fill: "rgba(251, 191, 36, 0.12)", chip: "#b45309" },
} as const;

const LANDMARK_STYLES = {
  pose: { color: "#34d399", radius: 2.6 },
  hand: { color: "#38bdf8", radius: 2.2 },
  face: { color: "#c084fc", radius: 1.4 },
} as const;

const POSE_POINT_INDICES = Array.from({ length: 33 }, (_, index) => index);
const HAND_POINT_INDICES = Array.from({ length: 21 }, (_, index) => index);

/** One colour per traced joint: wrists, elbows, knees and ankles. */
const TRAIL_COLORS: Record<number, string> = {
  15: "#38bdf8",
  16: "#38bdf8",
  13: "#34d399",
  14: "#34d399",
  25: "#2dd4bf",
  26: "#2dd4bf",
  27: "#a7f3d0",
  28: "#a7f3d0",
};

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const ANGLE_COLOR = "#d1fae5";
const GESTURE_CHIP = "#0369a1";
const HUD_BACKGROUND = "rgba(2, 6, 23, 0.62)";

type PointMapper = (point: { x: number; y: number }) => { x: number; y: number };
type PointFilter = (point: NormalizedLandmark) => boolean;

interface SilhouetteLayers {
  fill: HTMLCanvasElement;
  outline: HTMLCanvasElement;
}

/** Rounded rectangle without relying on ctx.roundRect (not everywhere yet). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function isFinitePoint(point: NormalizedLandmark): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Pose landmarks carry a visibility score; hands and faces do not. */
function isPoseVisible(point: NormalizedLandmark): boolean {
  return isFinitePoint(point) && (point.visibility ?? 1) >= 0.5;
}

function strokeConnections(
  ctx: CanvasRenderingContext2D,
  points: NormalizedLandmark[],
  connections: LandmarkConnection[],
  map: PointMapper,
  color: string,
  visible: PointFilter,
): void {
  ctx.beginPath();

  for (const connection of connections) {
    const start = points[connection.start];
    const end = points[connection.end];
    if (!start || !end || !visible(start) || !visible(end)) continue;

    const a = map(start);
    const b = map(end);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }

  // Dark underlay first, then the colour: the skeleton stays readable on both
  // bright skin and dark clothing.
  ctx.strokeStyle = "rgba(2, 6, 23, 0.55)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPointSet(
  ctx: CanvasRenderingContext2D,
  points: NormalizedLandmark[],
  indices: number[],
  map: PointMapper,
  color: string,
  radius: number,
  visible: PointFilter,
): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(2, 6, 23, 0.55)";
  ctx.lineWidth = 1;

  for (const index of indices) {
    const point = points[index];
    if (!point || !visible(point)) continue;

    const screen = map(point);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Turn one 0..1 coverage mask into a translucent fill plus a thin outline.
 *
 * WHY an offscreen canvas: the mask is 256×256 and only changes when the pose
 * model produces a new frame. Building it once per frame and blitting it from
 * the render loop is far cheaper than touching 65k pixels 30 times a second.
 */
function buildSilhouette(mask: SegmentationMask, color: string): SilhouetteLayers | null {
  const { width, height, data } = mask;
  if (width <= 0 || height <= 0) return null;

  const fill = document.createElement("canvas");
  fill.width = width;
  fill.height = height;
  const fillCtx = fill.getContext("2d");
  if (!fillCtx) return null;

  const image = fillCtx.createImageData(width, height);
  const [red, green, blue] = hexToRgb(color);
  for (let index = 0; index < width * height; index += 1) {
    const coverage = Math.min(1, Math.max(0, data[index] ?? 0));
    const offset = index * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = Math.round(coverage * 255);
  }
  fillCtx.putImageData(image, 0, 0);

  const outline = document.createElement("canvas");
  outline.width = width;
  outline.height = height;
  const outlineCtx = outline.getContext("2d");
  if (!outlineCtx) return null;

  // Dilate the mask by one pixel in every direction, then erase the original:
  // what is left is a one-pixel rim around the person.
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
  ] as const;
  for (const [dx, dy] of offsets) outlineCtx.drawImage(fill, dx, dy);
  outlineCtx.globalCompositeOperation = "destination-out";
  outlineCtx.drawImage(fill, 0, 0);
  outlineCtx.globalCompositeOperation = "source-in";
  outlineCtx.fillStyle = color;
  outlineCtx.fillRect(0, 0, width, height);

  return { fill, outline };
}

function flipArrow(arrow: string): string {
  if (arrow === "→") return "←";
  if (arrow === "←") return "→";
  return arrow;
}

/**
 * Draws landmarks and labels on a transparent canvas that sits exactly on top
 * of the video element.
 *
 * Human tracks are shown as a pose/hand/face skeleton instead of a rectangle.
 * The rectangle is still used internally for tracking and recognition, but it
 * is no longer painted. Animal tracks keep their amber box because there is no
 * animal landmark model in this app.
 *
 * WHY the mapping code below matters: the detector reports coordinates in
 * video pixels (e.g. 1280x720) but the canvas is displayed at CSS pixels
 * (maybe 360x202 on a phone). Landmarks arrive normalized, so they map directly
 * to the canvas size. Without the x-flip, everything is mirrored on the front
 * camera.
 */
export function CanvasOverlay({
  items,
  landmarks,
  analysis,
  silhouette,
  videoRef,
  mirrored,
}: CanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const itemsRef = useRef(items);
  const landmarksRef = useRef(landmarks);
  const analysisRef = useRef(analysis);
  const silhouetteEnabled = useRef(silhouette);
  const silhouetteCache = useRef<{ masks: SegmentationMask[]; layers: (SilhouetteLayers | null)[] }>({
    masks: [],
    layers: [],
  });

  // Keep the newest data available to the resize handler without re-registering
  // the ResizeObserver on every frame.
  itemsRef.current = items;
  landmarksRef.current = landmarks;
  analysisRef.current = analysis;
  silhouetteEnabled.current = silhouette;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return;

    // Back the canvas with real device pixels so text and lines stay sharp on
    // high-DPI phones, then work in CSS pixels.
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const video = videoRef.current;
    const videoWidth = video?.videoWidth ?? 0;
    const videoHeight = video?.videoHeight ?? 0;
    if (videoWidth === 0 || videoHeight === 0) return;

    const scaleX = cssWidth / videoWidth;
    const scaleY = cssHeight / videoHeight;

    // Normalized landmarks already refer to the whole video frame, so x and y
    // map straight onto the canvas. Mirroring happens around the centre.
    const mapPoint: PointMapper = (point) => {
      const x = point.x * cssWidth;
      return { x: mirrored ? cssWidth - x : x, y: point.y * cssHeight };
    };

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // --- Optional body silhouette (pose segmentation masks) ---------------
    if (silhouetteEnabled.current) {
      const masks = landmarksRef.current.masks;
      const cache = silhouetteCache.current;
      if (cache.masks !== masks) {
        cache.masks = masks;
        cache.layers = masks.map((mask) => buildSilhouette(mask, STYLES.person.stroke));
      }

      for (const layers of cache.layers) {
        if (!layers) continue;
        ctx.save();
        if (mirrored) {
          ctx.translate(cssWidth, 0);
          ctx.scale(-1, 1);
        }
        ctx.globalAlpha = 0.15;
        ctx.drawImage(layers.fill, 0, 0, cssWidth, cssHeight);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(layers.outline, 0, 0, cssWidth, cssHeight);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // --- Motion trails (fading history of wrists, elbows, knees, ankles) --
    const now = performance.now();
    for (const pose of analysisRef.current.poses) {
      for (const trail of pose.trails) {
        const points = trail.points;
        if (points.length < 2) continue;

        const color = TRAIL_COLORS[trail.joint] ?? LANDMARK_STYLES.pose.color;
        for (let index = 1; index < points.length; index += 1) {
          const point = points[index];
          if (!point) continue;

          const life = 1 - (now - point.t) / TRAIL_MS;
          if (life <= 0) continue;

          const previous = points[index - 1];
          if (!previous) continue;

          const a = mapPoint(previous);
          const b = mapPoint(point);
          ctx.globalAlpha = Math.min(1, life) * 0.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1 + 3 * life;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // --- Pose skeletons ---------------------------------------------------
    for (const pose of landmarksRef.current.poses) {
      strokeConnections(
        ctx,
        pose,
        POSE_CONNECTIONS,
        mapPoint,
        LANDMARK_STYLES.pose.color,
        isPoseVisible,
      );
      drawPointSet(
        ctx,
        pose,
        POSE_POINT_INDICES,
        mapPoint,
        LANDMARK_STYLES.pose.color,
        LANDMARK_STYLES.pose.radius,
        isPoseVisible,
      );
    }

    // --- Hand skeletons ---------------------------------------------------
    for (const hand of landmarksRef.current.hands) {
      strokeConnections(
        ctx,
        hand,
        HAND_CONNECTIONS,
        mapPoint,
        LANDMARK_STYLES.hand.color,
        isFinitePoint,
      );
      drawPointSet(
        ctx,
        hand,
        HAND_POINT_INDICES,
        mapPoint,
        LANDMARK_STYLES.hand.color,
        LANDMARK_STYLES.hand.radius,
        isFinitePoint,
      );
    }

    // --- Face contours ----------------------------------------------------
    for (const face of landmarksRef.current.faces) {
      strokeConnections(
        ctx,
        face,
        FACE_CONNECTIONS,
        mapPoint,
        LANDMARK_STYLES.face.color,
        isFinitePoint,
      );
      drawPointSet(
        ctx,
        face,
        FACE_POINT_INDICES,
        mapPoint,
        LANDMARK_STYLES.face.color,
        LANDMARK_STYLES.face.radius,
        isFinitePoint,
      );
    }

    // --- Joint angles, pushed away from the body so they stay readable ----
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const pose of analysisRef.current.poses) {
      const hip = { x: pose.x, y: pose.y };
      for (const angle of pose.angles) {
        const at = mapPoint(angle);
        const dx = mirrored ? hip.x - angle.x : angle.x - hip.x;
        const dy = angle.y - hip.y;
        const length = Math.hypot(dx, dy) || 1;
        const x = at.x + (dx / length) * 16;
        const y = at.y + (dy / length) * 12;

        // Dark halo first: angle numbers sit on top of skin and clothing.
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(2, 6, 23, 0.8)";
        ctx.strokeText(angle.text, x, y);
        ctx.fillStyle = ANGLE_COLOR;
        ctx.fillText(angle.text, x, y);
      }
    }

    // --- Gesture labels near the hand ------------------------------------
    ctx.textAlign = "left";
    ctx.font = `600 12px ${FONT}`;
    for (const gesture of analysisRef.current.gestures) {
      const anchor = mapPoint(gesture);
      const text = gesture.name;
      const textWidth = ctx.measureText(text).width;
      const chipWidth = textWidth + 14;
      const chipHeight = 22;
      const chipX = Math.min(Math.max(0, anchor.x - chipWidth / 2), Math.max(0, cssWidth - chipWidth));
      const chipY = Math.max(0, anchor.y - chipHeight - 8);

      ctx.fillStyle = GESTURE_CHIP;
      roundedRect(ctx, chipX, chipY, chipWidth, chipHeight, 6);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(text, chipX + 7, chipY + chipHeight / 2 + 0.5);
    }

    // --- Tracks: labels for people, boxes only for animals ----------------
    for (const item of itemsRef.current) {
      const style = STYLES[item.kind];

      const boxWidth = item.box.width * scaleX;
      const boxHeight = item.box.height * scaleY;
      // Mirror around the canvas centre when the preview is flipped.
      const rawX = item.box.x * scaleX;
      const boxX = mirrored ? cssWidth - rawX - boxWidth : rawX;
      const boxY = item.box.y * scaleY;

      if (item.kind === "animal") {
        // Animals have no landmark model, so their existing box is preserved.
        ctx.fillStyle = style.fill;
        roundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fill();

        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 2;
        roundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 8);
        ctx.stroke();
      }

      // A confirmed name replaces the confidence readout: "Rahul (Human)".
      const text = item.name
        ? `${item.name} (${item.label})`
        : `${item.label} ${Math.round(item.confidence * 100)}%`;
      ctx.font = `600 13px ${FONT}`;
      const textWidth = ctx.measureText(text).width;
      const chipWidth = textWidth + 16;
      const chipHeight = 24;

      // Put the label above the track, unless there is no room up there.
      const chipAbove = boxY - chipHeight - 4;
      const chipY = chipAbove >= 0 ? chipAbove : boxY + 4;
      const chipX = Math.min(Math.max(0, boxX), Math.max(0, cssWidth - chipWidth));

      ctx.fillStyle = style.chip;
      roundedRect(ctx, chipX, chipY, chipWidth, chipHeight, 6);
      ctx.fill();

      // Text is drawn normally (never mirrored) so it stays readable.
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(text, chipX + 8, chipY + chipHeight / 2 + 0.5);
    }

    // --- Movement analytics HUD (top-right, inside the video) ------------
    const motions = analysisRef.current.poses.slice(0, 2);
    if (motions.length > 0) {
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const lines = motions.map((motion) => {
        const arrow = mirrored ? flipArrow(motion.arrow) : motion.arrow;
        const speed = `${motion.speed.toFixed(1)} m/s`;
        return `${motion.action} · ${speed} ${arrow}`;
      });

      const widgets = lines.map((line) => ({ line, width: ctx.measureText(line).width + 18 }));
      const chipHeight = 22;
      const gap = 4;

      lines.forEach((line, index) => {
        const widget = widgets[index];
        if (!widget) return;

        // Top-right: the per-person name chips sit above each box and the
        // "nothing detected" banner owns the bottom edge, so this corner stays
        // clear in normal use.
        const x = Math.max(0, cssWidth - widget.width - 10);
        const y = 10 + index * (chipHeight + gap);

        ctx.fillStyle = HUD_BACKGROUND;
        roundedRect(ctx, x, y, widget.width, chipHeight, 6);
        ctx.fill();

        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(line, x + 9, y + chipHeight / 2 + 0.5);
      });
    }
  }, [mirrored, videoRef]);

  // Redraw when new items or landmarks arrive.
  useEffect(() => {
    draw();
  }, [items, landmarks, analysis, silhouette, draw]);

  // Trails fade with time, so keep repainting between landmark frames. The
  // throttle keeps this near 30 fps instead of the display's 60.
  useEffect(() => {
    let rafId = 0;
    let last = 0;

    const loop = (time: number) => {
      rafId = requestAnimationFrame(loop);
      if (time - last < 32) return;
      last = time;
      if (document.visibilityState !== "visible") return;

      const hasTrails = analysisRef.current.poses.some((pose) =>
        pose.trails.some((trail) => trail.points.length > 1),
      );
      if (hasTrails) draw();
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [draw]);

  // Redraw when the element changes size (rotation, window resize, layout).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
