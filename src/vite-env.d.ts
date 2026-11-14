/// <reference types="vite/client" />

/**
 * Typed list of every VITE_ variable the app reads.
 * All are optional strings: Vite gives `undefined` when a variable is not set,
 * and src/config/env.ts supplies the defaults.
 */
interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_DETECTION_CONFIDENCE?: string;
  readonly VITE_FACE_MATCH_THRESHOLD?: string;
  readonly VITE_PET_MATCH_THRESHOLD?: string;
  readonly VITE_MIN_FACE_SIZE_PX?: string;
  readonly VITE_MEDIAPIPE_WASM_URL?: string;
  readonly VITE_MEDIAPIPE_OBJECT_MODEL_URL?: string;
  readonly VITE_MEDIAPIPE_EMBEDDER_MODEL_URL?: string;
  readonly VITE_HUMAN_MODELS_PATH?: string;
  readonly VITE_GEOCODER?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
