import type { Track } from "../ml/tracker";
import { VOTES_REQUIRED } from "../ml/recognizer";
import { AUTO_TUNE } from "../store/settingsStore";
import type { CameraMode, CameraProfile } from "../store/settingsStore";
import type { StreamInfo } from "../hooks/useCamera";
import type { ModelStatus } from "../hooks/useLiveRecognition";

interface DebugPanelProps {
  tracks: Track[];
  faceThreshold: number;
  petThreshold: number;
  /** Active camera's profile: modes and sample counts for the auto-tuner. */
  profile: CameraProfile | null;
  faceStatus: ModelStatus;
  petStatus: ModelStatus;
  recognitions: number;
  cameraLabel: string | null;
  cameraMode: CameraMode;
  cameraInfo: StreamInfo | null;
  /** Share of sampled pixels that look green (0..1). */
  greenRatio: number;
  poseStatus: ModelStatus;
  handStatus: ModelStatus;
  faceLandmarkStatus: ModelStatus;
  poseCount: number;
  handCount: number;
  faceCount: number;
  landmarkFps: number;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

function statusLabel(status: ModelStatus): string {
  if (status === "ready") return "ready";
  if (status === "loading") return "loading";
  if (status === "error") return "failed";
  return "not needed";
}

function landmarkStatusLabel(status: ModelStatus): string {
  if (status === "ready") return "ready";
  if (status === "loading") return "loading";
  if (status === "error") return "failed";
  return "off";
}

function streamLabel(info: StreamInfo | null): string {
  if (!info) return "not running";
  const size = info.width > 0 && info.height > 0 ? `${info.width}×${info.height}` : "size unknown";
  const rate = info.frameRate > 0 ? ` @ ${Math.round(info.frameRate)} fps` : "";
  return `${size}${rate}`;
}

function sampleLabel(mode: "auto" | "manual", known: number, unknown: number): string {
  return `${mode} · ${known} known / ${unknown} unknown`;
}

/**
 * Threshold tuning view.
 *
 * WHY it exists: a threshold is only meaningful relative to real scores. You
 * stand in front of the camera, read your best score, then show someone else and
 * read theirs. The gap between the two is where the threshold belongs. Once
 * enough of both exist, the app moves the threshold there by itself.
 */
export function DebugPanel({
  tracks,
  faceThreshold,
  petThreshold,
  profile,
  faceStatus,
  petStatus,
  recognitions,
  cameraLabel,
  cameraMode,
  cameraInfo,
  greenRatio,
  poseStatus,
  handStatus,
  faceLandmarkStatus,
  poseCount,
  handCount,
  faceCount,
  landmarkFps,
}: DebugPanelProps) {
  return (
    <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <span className="font-semibold text-slate-800 dark:text-slate-200">Debug</span>
        <span>camera: {cameraLabel ?? "not running"}</span>
        <span>stream: {streamLabel(cameraInfo)}</span>
        <span>mode: {cameraMode}</span>
        <span className={greenRatio > 0.9 ? "text-amber-600 dark:text-amber-400" : undefined}>
          green: {Math.round(greenRatio * 100)}%
        </span>
      </header>

      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <span>
          pose: {landmarkStatusLabel(poseStatus)} ({poseCount})
        </span>
        <span>
          hands: {landmarkStatusLabel(handStatus)} ({handCount})
        </span>
        <span>
          face: {landmarkStatusLabel(faceLandmarkStatus)} ({faceCount})
        </span>
        <span>landmarks: {landmarkFps} fps</span>
      </header>

      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <span>face model: {statusLabel(faceStatus)}</span>
        <span>pet model: {statusLabel(petStatus)}</span>
        <span>
          face ≥ {faceThreshold.toFixed(2)} (
          {profile ? sampleLabel(profile.faceMode, profile.faceKnown.length, profile.faceUnknown.length) : "no profile"})
        </span>
        <span>
          pet ≥ {petThreshold.toFixed(2)} (
          {profile ? sampleLabel(profile.petMode, profile.petKnown.length, profile.petUnknown.length) : "no profile"})
        </span>
        <span>matches: {recognitions}</span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-2 py-1.5 font-medium">ID</th>
              <th className="px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">Name</th>
              <th className="px-2 py-1.5 font-medium">Best</th>
              <th className="px-2 py-1.5 font-medium">Runner-up</th>
              <th className="px-2 py-1.5 font-medium">Votes</th>
              <th className="px-2 py-1.5 font-medium">Tries</th>
              <th className="px-2 py-1.5 font-medium">Face px</th>
              <th className="px-2 py-1.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {tracks.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-3 text-slate-500 dark:text-slate-400">
                  No tracked objects yet.
                </td>
              </tr>
            ) : (
              tracks.map((track) => (
                <tr key={track.id}>
                  <td className="px-2 py-1.5 tabular-nums">{track.id}</td>
                  <td className="px-2 py-1.5">{track.label}</td>
                  <td className="px-2 py-1.5 font-medium">{track.name ?? "—"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatScore(track.bestScore)}</td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {formatScore(track.runnerUpScore)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {track.voteName
                      ? `${track.voteName} ${track.voteCount}/${VOTES_REQUIRED}`
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{track.attempts}</td>
                  <td className="px-2 py-1.5 tabular-nums">{track.faceWidthPx ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400">
                    {track.note === "none" ? "—" : track.note}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="px-3 py-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        A name appears after the same result wins 3 times in a row. Each camera tunes its own
        thresholds once it has {AUTO_TUNE.minKnown} named and {AUTO_TUNE.minUnknown} unknown
        tracks; the new value is placed midway between the weakest match and the strongest
        non-match. Move a slider to take over manually.
      </p>
    </section>
  );
}
