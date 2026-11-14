/**
 * Single source of truth for runtime settings.
 *
 * WHY: reading `import.meta.env` in many files means every file has to repeat
 * the same fallback and validation logic. Here we read it once, validate it
 * once, and every other file imports the typed `env` object.
 */

const DEFAULTS = {
  appName: "LiveCaps",
  detectionConfidence: 0.5,
  faceMatchThreshold: 0.55,
  petMatchThreshold: 0.75,
  minFaceSizePx: 80,
  // Pinned to the installed @mediapipe/tasks-vision version (see package.json).
  // The JS loader and the WASM binary must be the same version or they break.
  mediapipeWasmUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm",
  objectModelUrl:
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  embedderModelUrl:
    "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite",
  // Human's built-in default is "../models/", which breaks on SPA routes like
  // /people. A version-pinned CDN URL works out of the box; set
  // VITE_HUMAN_MODELS_PATH=/models if you copy the files into public/models.
  humanModelsPath: "https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models",
} as const;

export type GeocoderKind = "nominatim" | "mapbox" | "none";

/** Trimmed string, or the fallback when the variable is empty/undefined. */
function readString(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

/**
 * Number inside [min, max], or the fallback.
 * WHY reject instead of clamp: a typo like VITE_DETECTION_CONFIDENCE=5 would
 * silently produce a broken detector. Falling back plus a console warning is
 * easier to notice and keeps the app usable.
 */
function readNumber(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    console.warn(
      `[env] ${name}="${value}" is not a number between ${min} and ${max}. Using ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

function readGeocoder(value: string | undefined): GeocoderKind {
  const candidate = readString(value, "nominatim").toLowerCase();
  if (candidate === "nominatim" || candidate === "mapbox" || candidate === "none") {
    return candidate;
  }
  console.warn(`[env] VITE_GEOCODER="${value}" is unknown. Using "nominatim".`);
  return "nominatim";
}

export const env = {
  appName: readString(import.meta.env.VITE_APP_NAME, DEFAULTS.appName),

  /** Minimum score for the object detector to report a box (0..1). */
  detectionConfidence: readNumber(
    "VITE_DETECTION_CONFIDENCE",
    import.meta.env.VITE_DETECTION_CONFIDENCE,
    DEFAULTS.detectionConfidence,
    0.05,
    0.95,
  ),

  /** Minimum similarity for a face to be considered a known person (0..1). */
  faceMatchThreshold: readNumber(
    "VITE_FACE_MATCH_THRESHOLD",
    import.meta.env.VITE_FACE_MATCH_THRESHOLD,
    DEFAULTS.faceMatchThreshold,
    0.1,
    0.99,
  ),

  /** Minimum cosine similarity for a pet to be considered known (0..1). */
  petMatchThreshold: readNumber(
    "VITE_PET_MATCH_THRESHOLD",
    import.meta.env.VITE_PET_MATCH_THRESHOLD,
    DEFAULTS.petMatchThreshold,
    0.1,
    0.99,
  ),

  /** Faces smaller than this many pixels are skipped (too blurry to trust). */
  minFaceSizePx: Math.round(
    readNumber(
      "VITE_MIN_FACE_SIZE_PX",
      import.meta.env.VITE_MIN_FACE_SIZE_PX,
      DEFAULTS.minFaceSizePx,
      20,
      2000,
    ),
  ),

  mediapipeWasmUrl: readString(
    import.meta.env.VITE_MEDIAPIPE_WASM_URL,
    DEFAULTS.mediapipeWasmUrl,
  ),
  objectModelUrl: readString(
    import.meta.env.VITE_MEDIAPIPE_OBJECT_MODEL_URL,
    DEFAULTS.objectModelUrl,
  ),
  embedderModelUrl: readString(
    import.meta.env.VITE_MEDIAPIPE_EMBEDDER_MODEL_URL,
    DEFAULTS.embedderModelUrl,
  ),

  /** Empty means "use Human's default model location". */
  humanModelsPath: readString(
    import.meta.env.VITE_HUMAN_MODELS_PATH,
    DEFAULTS.humanModelsPath,
  ),

  geocoder: readGeocoder(import.meta.env.VITE_GEOCODER),
  mapboxToken: readString(import.meta.env.VITE_MAPBOX_TOKEN, ""),

  supabaseUrl: readString(import.meta.env.VITE_SUPABASE_URL, ""),
  supabaseAnonKey: readString(import.meta.env.VITE_SUPABASE_ANON_KEY, ""),
} as const;

export type Env = typeof env;
