import { create } from "zustand";
import { persist } from "zustand/middleware";
import { env } from "../config/env";

export type ThresholdKind = "face" | "pet";
export type ThresholdMode = "auto" | "manual";
export type CameraMode = "standard" | "compatible";

/** Every camera gets its own profile; this key is used until a device id exists. */
export const DEFAULT_CAMERA_KEY = "default";

/** A camera's tuned state: two thresholds plus the score samples behind them. */
export interface CameraProfile {
  /** Friendly device label, kept so Settings can name the camera later. */
  label: string;
  faceThreshold: number;
  petThreshold: number;
  faceMode: ThresholdMode;
  petMode: ThresholdMode;
  /** Scores from tracks that were confirmed with a name. */
  faceKnown: number[];
  /** Scores from tracks that ended up "Unknown" (the risky ones). */
  faceUnknown: number[];
  petKnown: number[];
  petUnknown: number[];
  updatedAt: number;
}

/** How many recent scores we keep per bucket; old lighting should not count forever. */
const SAMPLE_CAP = 40;

/** Auto-tuning only starts once there is enough evidence on both sides. */
export const AUTO_TUNE = {
  minKnown: 6,
  minUnknown: 3,
  minGap: 0.06,
  sampleCap: SAMPLE_CAP,
} as const;

/** A threshold outside these ranges is either useless or dangerous. */
const FACE_RANGE = [0.4, 0.8] as const;
const PET_RANGE = [0.55, 0.92] as const;

interface SettingsState {
  /** Effective threshold for the active camera (what recognition reads). */
  faceMatchThreshold: number;
  petMatchThreshold: number;
  /** Selected camera deviceId, or null for the browser default. */
  cameraId: string | null;
  cameraMode: CameraMode;
  /** Key of the camera whose profile is currently active. */
  activeCameraKey: string;
  profiles: Record<string, CameraProfile>;

  setFaceMatchThreshold: (value: number) => void;
  setPetMatchThreshold: (value: number) => void;
  setThresholdMode: (kind: ThresholdKind, mode: ThresholdMode) => void;
  setCameraId: (id: string | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  /** Switch to a camera and load (or create) its profile. */
  activateCamera: (id: string | null, label?: string) => void;
  /** Feed one recognition result into the active camera's tuning samples. */
  recordScore: (kind: ThresholdKind, score: number, known: boolean) => void;
  /** Forget this camera's samples and go back to .env defaults. */
  resetProfile: () => void;
  resetToEnvDefaults: () => void;
}

/**
 * Tunable thresholds, persisted in localStorage.
 *
 * WHY per camera: a laptop webcam, a phone camera and a virtual camera such as
 * DroidCam produce very different scores for the same face. One global
 * threshold would be wrong on at least one of them, so each deviceId gets its
 * own profile and its own automatic tuning history.
 *
 * WHY the top-level thresholds still exist: recognition runs many times per
 * second and should not have to resolve the active profile on every frame.
 * `activateCamera` and `recordScore` keep them in sync with the active profile.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      faceMatchThreshold: env.faceMatchThreshold,
      petMatchThreshold: env.petMatchThreshold,
      cameraId: null,
      cameraMode: "standard",
      activeCameraKey: DEFAULT_CAMERA_KEY,
      profiles: {},

      setFaceMatchThreshold: (value) =>
        set((state) => {
          const faceMatchThreshold = round2(clamp(value, 0.1, 0.99));
          const profile = state.profiles[state.activeCameraKey];
          if (!profile) return { faceMatchThreshold };

          return {
            faceMatchThreshold,
            profiles: {
              ...state.profiles,
              [state.activeCameraKey]: {
                ...profile,
                faceThreshold: faceMatchThreshold,
                // A manual slider means "stop guessing for me on this camera".
                faceMode: "manual",
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setPetMatchThreshold: (value) =>
        set((state) => {
          const petMatchThreshold = round2(clamp(value, 0.1, 0.99));
          const profile = state.profiles[state.activeCameraKey];
          if (!profile) return { petMatchThreshold };

          return {
            petMatchThreshold,
            profiles: {
              ...state.profiles,
              [state.activeCameraKey]: {
                ...profile,
                petThreshold: petMatchThreshold,
                petMode: "manual",
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setThresholdMode: (kind, mode) =>
        set((state) => {
          const key = state.activeCameraKey;
          const profile = state.profiles[key] ?? createProfile(
            state.faceMatchThreshold,
            state.petMatchThreshold,
          );

          if (mode === "manual") {
            return {
              profiles: {
                ...state.profiles,
                [key]:
                  kind === "face"
                    ? { ...profile, faceMode: "manual", updatedAt: Date.now() }
                    : { ...profile, petMode: "manual", updatedAt: Date.now() },
              },
            };
          }

          // Back to automatic: re-derive from the samples we already have.
          const faceThreshold =
            kind === "face"
              ? autoThreshold(profile.faceKnown, profile.faceUnknown, profile.faceThreshold, FACE_RANGE)
              : profile.faceThreshold;
          const petThreshold =
            kind === "pet"
              ? autoThreshold(profile.petKnown, profile.petUnknown, profile.petThreshold, PET_RANGE)
              : profile.petThreshold;

          return {
            faceMatchThreshold: faceThreshold,
            petMatchThreshold: petThreshold,
            profiles: {
              ...state.profiles,
              [key]: {
                ...profile,
                faceThreshold,
                petThreshold,
                faceMode: kind === "face" ? "auto" : profile.faceMode,
                petMode: kind === "pet" ? "auto" : profile.petMode,
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setCameraId: (id) => set({ cameraId: id && id.trim() !== "" ? id : null }),

      setCameraMode: (mode) => set({ cameraMode: mode }),

      activateCamera: (id, label) =>
        set((state) => {
          const key = id && id.trim() !== "" ? id : DEFAULT_CAMERA_KEY;
          const existing = state.profiles[key];

          if (existing) {
            const nextLabel = label?.trim() ? label : existing.label;
            if (state.activeCameraKey === key && nextLabel === existing.label) {
              return {};
            }

            return {
              activeCameraKey: key,
              faceMatchThreshold: existing.faceThreshold,
              petMatchThreshold: existing.petThreshold,
              profiles:
                nextLabel === existing.label
                  ? state.profiles
                  : {
                      ...state.profiles,
                      [key]: { ...existing, label: nextLabel },
                    },
            };
          }

          // First profile on this browser adopts the persisted slider values so
          // an existing user does not lose their tuning. Later cameras start
          // from the .env defaults.
          const isFirstProfile = Object.keys(state.profiles).length === 0;
          const profile = createProfile(
            isFirstProfile ? state.faceMatchThreshold : env.faceMatchThreshold,
            isFirstProfile ? state.petMatchThreshold : env.petMatchThreshold,
            label,
          );

          return {
            activeCameraKey: key,
            faceMatchThreshold: profile.faceThreshold,
            petMatchThreshold: profile.petThreshold,
            profiles: { ...state.profiles, [key]: profile },
          };
        }),

      recordScore: (kind, score, known) =>
        set((state) => {
          if (!Number.isFinite(score)) return {};

          const key = state.activeCameraKey;
          const profile =
            state.profiles[key] ??
            createProfile(state.faceMatchThreshold, state.petMatchThreshold);
          const value = clamp(score, 0, 1);

          const next: CameraProfile =
            kind === "face"
              ? {
                  ...profile,
                  faceKnown: known ? pushCapped(profile.faceKnown, value) : profile.faceKnown,
                  faceUnknown: known ? profile.faceUnknown : pushCapped(profile.faceUnknown, value),
                  updatedAt: Date.now(),
                }
              : {
                  ...profile,
                  petKnown: known ? pushCapped(profile.petKnown, value) : profile.petKnown,
                  petUnknown: known ? profile.petUnknown : pushCapped(profile.petUnknown, value),
                  updatedAt: Date.now(),
                };

          // Recompute both: cheap, and it keeps the effective values honest even
          // if the user toggled modes in another tab.
          if (next.faceMode === "auto") {
            next.faceThreshold = autoThreshold(
              next.faceKnown,
              next.faceUnknown,
              profile.faceThreshold,
              FACE_RANGE,
            );
          }
          if (next.petMode === "auto") {
            next.petThreshold = autoThreshold(
              next.petKnown,
              next.petUnknown,
              profile.petThreshold,
              PET_RANGE,
            );
          }

          return {
            faceMatchThreshold: next.faceThreshold,
            petMatchThreshold: next.petThreshold,
            profiles: { ...state.profiles, [key]: next },
          };
        }),

      resetProfile: () => set(resetActiveProfile),

      // Kept for the existing Settings button; it now resets only this camera.
      resetToEnvDefaults: () => set(resetActiveProfile),
    }),
    { name: "moments.settings" },
  ),
);

function resetActiveProfile(
  state: Pick<SettingsState, "activeCameraKey" | "profiles">,
): Partial<SettingsState> {
  const profile = createProfile(
    env.faceMatchThreshold,
    env.petMatchThreshold,
    state.profiles[state.activeCameraKey]?.label ?? "",
  );

  return {
    faceMatchThreshold: profile.faceThreshold,
    petMatchThreshold: profile.petThreshold,
    profiles: { ...state.profiles, [state.activeCameraKey]: profile },
  };
}

function createProfile(face: number, pet: number, label = ""): CameraProfile {
  return {
    label,
    faceThreshold: round2(clamp(face, 0.1, 0.99)),
    petThreshold: round2(clamp(pet, 0.1, 0.99)),
    faceMode: "auto",
    petMode: "auto",
    faceKnown: [],
    faceUnknown: [],
    petKnown: [],
    petUnknown: [],
    updatedAt: Date.now(),
  };
}

/**
 * Place the threshold between the weakest correct match and the strongest
 * wrong match.
 *
 * WHY a midpoint: it maximises the distance to both mistakes. We refuse to move
 * while the two groups overlap (or nearly touch), because any line through an
 * overlap is a guess; keeping the previous value is safer.
 */
export function autoThreshold(
  known: number[],
  unknown: number[],
  fallback: number,
  range: readonly [number, number],
): number {
  if (known.length < AUTO_TUNE.minKnown || unknown.length < AUTO_TUNE.minUnknown) {
    return fallback;
  }

  const weakestKnown = Math.min(...known);
  const strongestUnknown = Math.max(...unknown);
  if (weakestKnown - strongestUnknown < AUTO_TUNE.minGap) return fallback;

  return round2(clamp((weakestKnown + strongestUnknown) / 2, range[0], range[1]));
}

function pushCapped(values: number[], value: number): number[] {
  return [...values, value].slice(-SAMPLE_CAP);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
