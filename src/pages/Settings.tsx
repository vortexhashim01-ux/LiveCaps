import { env } from "../config/env";
import { Pill } from "../components/Pill";
import { AUTO_TUNE, useSettingsStore } from "../store/settingsStore";

function scoreRange(values: number[], pick: "min" | "max"): string {
  if (values.length === 0) return "—";
  const value = pick === "min" ? Math.min(...values) : Math.max(...values);
  return value.toFixed(2);
}

export default function Settings() {
  const faceMatchThreshold = useSettingsStore((state) => state.faceMatchThreshold);
  const petMatchThreshold = useSettingsStore((state) => state.petMatchThreshold);
  const setFaceMatchThreshold = useSettingsStore((state) => state.setFaceMatchThreshold);
  const setPetMatchThreshold = useSettingsStore((state) => state.setPetMatchThreshold);
  const setThresholdMode = useSettingsStore((state) => state.setThresholdMode);
  const cameraMode = useSettingsStore((state) => state.cameraMode);
  const setCameraMode = useSettingsStore((state) => state.setCameraMode);
  const profile = useSettingsStore((state) => state.profiles[state.activeCameraKey] ?? null);
  const profileCount = useSettingsStore((state) => Object.keys(state.profiles).length);
  const resetProfile = useSettingsStore((state) => state.resetProfile);

  const faceKnown = profile?.faceKnown.length ?? 0;
  const faceUnknown = profile?.faceUnknown.length ?? 0;
  const petKnown = profile?.petKnown.length ?? 0;
  const petUnknown = profile?.petUnknown.length ?? 0;

  const faceHasData = faceKnown >= AUTO_TUNE.minKnown && faceUnknown >= AUTO_TUNE.minUnknown;
  const petHasData = petKnown >= AUTO_TUNE.minKnown && petUnknown >= AUTO_TUNE.minUnknown;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Thresholds decide how similar a face or pet must be before a name is shown. Each camera
        gets its own profile, so a phone camera and a laptop webcam do not fight over one value.
      </p>

      <div className="mt-6 space-y-6">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Camera profile</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {profileCount} camera{profileCount === 1 ? "" : "s"} remembered
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Active: <span className="font-medium">{profile?.label || "Default camera"}</span>.
            Connect another camera (for example a phone running DroidCam) and choose it on the
            Live page: its own thresholds and tuning history load automatically.
          </p>

          <label
            className="mt-3 flex items-start gap-2 text-sm"
            title="Ask the browser for any video stream, without resolution or facing preferences. Useful when a virtual camera shows a green frame."
          >
            <input
              type="checkbox"
              checked={cameraMode === "compatible"}
              onChange={(event) =>
                setCameraMode(event.target.checked ? "compatible" : "standard")
              }
              className="mt-0.5 size-4 accent-emerald-600"
            />
            <span>
              Compatibility mode
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Uses the camera&apos;s own defaults. Try this if the preview is green or frozen.
              </span>
            </span>
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="face-threshold" className="text-sm font-medium">
              Face match threshold
            </label>
            <span className="text-sm font-semibold tabular-nums">
              {faceMatchThreshold.toFixed(2)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Pill tone={profile?.faceMode === "auto" ? "ok" : "muted"}>
              {profile?.faceMode === "auto" ? "Auto" : "Manual"}
            </Pill>
            <span>
              {faceKnown} known · {faceUnknown} unknown samples
            </span>
            {faceKnown > 0 && faceUnknown > 0 ? (
              <span>
                weakest known {scoreRange(profile?.faceKnown ?? [], "min")} · strongest unknown{" "}
                {scoreRange(profile?.faceUnknown ?? [], "max")}
              </span>
            ) : null}
            {profile?.faceMode === "manual" ? (
              <button
                type="button"
                onClick={() => setThresholdMode("face", "auto")}
                className="font-medium text-emerald-700 underline dark:text-emerald-400"
              >
                Use automatic tuning
              </button>
            ) : null}
          </div>

          <input
            id="face-threshold"
            type="range"
            min={0.3}
            max={0.9}
            step={0.01}
            value={faceMatchThreshold}
            onChange={(event) => setFaceMatchThreshold(Number(event.target.value))}
            className="mt-3 w-full accent-emerald-600"
          />
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {profile?.faceMode === "manual"
              ? "Manual: your slider wins on this camera. Automatic tuning resumes when you press “Use automatic tuning”."
              : faceHasData
                ? "Automatic: the value is midway between the weakest named match and the strongest unknown. It only moves when those two groups are clearly separated."
                : `Automatic: waiting for ${AUTO_TUNE.minKnown} named and ${AUTO_TUNE.minUnknown} unknown tracks on this camera. The current value stays until then.`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="pet-threshold" className="text-sm font-medium">
              Pet match threshold
            </label>
            <span className="text-sm font-semibold tabular-nums">
              {petMatchThreshold.toFixed(2)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Pill tone={profile?.petMode === "auto" ? "ok" : "muted"}>
              {profile?.petMode === "auto" ? "Auto" : "Manual"}
            </Pill>
            <span>
              {petKnown} known · {petUnknown} unknown samples
            </span>
            {petKnown > 0 && petUnknown > 0 ? (
              <span>
                weakest known {scoreRange(profile?.petKnown ?? [], "min")} · strongest unknown{" "}
                {scoreRange(profile?.petUnknown ?? [], "max")}
              </span>
            ) : null}
            {profile?.petMode === "manual" ? (
              <button
                type="button"
                onClick={() => setThresholdMode("pet", "auto")}
                className="font-medium text-emerald-700 underline dark:text-emerald-400"
              >
                Use automatic tuning
              </button>
            ) : null}
          </div>

          <input
            id="pet-threshold"
            type="range"
            min={0.5}
            max={0.95}
            step={0.01}
            value={petMatchThreshold}
            onChange={(event) => setPetMatchThreshold(Number(event.target.value))}
            className="mt-3 w-full accent-emerald-600"
          />
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {profile?.petMode === "manual"
              ? "Manual: your slider wins on this camera. Automatic tuning resumes when you press “Use automatic tuning”."
              : petHasData
                ? "Automatic: the value is midway between the weakest named pet match and the strongest unknown. Look-alike pets keep the value still when the groups overlap."
                : `Automatic: waiting for ${AUTO_TUNE.minKnown} named and ${AUTO_TUNE.minUnknown} unknown tracks on this camera. The current value stays until then.`}
          </p>
        </div>

        <button
          type="button"
          onClick={resetProfile}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Reset this camera to defaults
        </button>

        <div className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
          <h2 className="font-medium">Fixed for now (from .env)</h2>
          <dl className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
            <div className="flex justify-between gap-4">
              <dt>Detection confidence</dt>
              <dd className="tabular-nums">{env.detectionConfidence.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Minimum face size</dt>
              <dd className="tabular-nums">{env.minFaceSizePx} px</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Detection rate</dt>
              <dd className="tabular-nums">8 fps</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            The frame-rate limit, clear-data and export/import controls arrive in Stage 7.
          </p>
        </div>
      </div>
    </section>
  );
}
