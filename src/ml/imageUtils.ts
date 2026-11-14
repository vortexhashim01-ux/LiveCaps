import type { VideoBox } from "./types";

/** Largest side we keep for recognition. Phone photos are 4000px+ and add no accuracy. */
const MAX_SIDE = 1280;

function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxSide: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/**
 * Turn a picked image file into a canvas ready for the models.
 * WHY createImageBitmap: it decodes off the main thread, so a 12 MP phone photo
 * does not freeze the UI.
 */
export async function fileToCanvas(file: File, maxSide = MAX_SIDE): Promise<HTMLCanvasElement> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not an image. Use a JPG, PNG or WebP photo.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    return drawScaled(bitmap, bitmap.width, bitmap.height, maxSide);
  } finally {
    // Free the decoded bitmap immediately; large photos are tens of MB.
    bitmap.close();
  }
}

/**
 * Cut one detection box out of the current video frame, at native resolution.
 *
 * WHY padding: the object detector's person box is usually tight, and a face
 * touching the edge is harder to describe. A little margin helps.
 *
 * Returns null when the box is degenerate (happens on the first frames).
 */
export function cropVideoFrame(
  video: HTMLVideoElement,
  box: VideoBox,
  padding = 0.15,
): HTMLCanvasElement | null {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (videoWidth === 0 || videoHeight === 0) return null;

  const padX = box.width * padding;
  const padY = box.height * padding;

  const left = Math.max(0, Math.floor(box.x - padX));
  const top = Math.max(0, Math.floor(box.y - padY));
  const right = Math.min(videoWidth, Math.ceil(box.x + box.width + padX));
  const bottom = Math.min(videoHeight, Math.ceil(box.y + box.height + padY));

  const width = right - left;
  const height = bottom - top;
  if (width < 16 || height < 16) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, left, top, width, height, 0, 0, width, height);
  return canvas;
}
