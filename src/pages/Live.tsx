import { useState } from "react";
import { Link } from "react-router-dom";
import { CanvasOverlay } from "../components/CanvasOverlay";
import { DebugPanel } from "../components/DebugPanel";
import { Pill } from "../components/Pill";
import type { PillTone } from "../components/Pill";
import { useCamera } from "../hooks/useCamera";
import { useDetectionLoop } from "../hooks/useDetectionLoop";
import { useEmbeddingGallery } from "../hooks/useEmbeddingGallery";
import { useGreenFrame } from "../hooks/useGreenFrame";
import { useLandmarkLoop } from "../hooks/useLandmarkLoop";
import { useLiveRecognition } from "../hooks/useLiveRecognition";
import type { ModelStatus } from "../hooks/useLiveRecognition";
import { useMovementAnalysis } from "../hooks/useMovementAnalysis";
import type { OverlayItem } from "../ml/types";
import { useSettingsStore } from "../store/settingsStore";

/** Detection runs ~8 times per second: enough for smooth boxes, cheap on battery. */
const TARGET_FPS = 8;

function modelPill(status: ModelStatus, label: string): { tone: PillTone; text: string } {
  if (status === "ready") return { tone: "ok", text: `${label} ready` };
  if (status === "loading") return { tone: "warn", text: `${label} loading…` };
  if (status === "error") return { tone: "error", text: `${label} failed` };
  return { tone: "muted", text: `${label} not needed` };
}

export default function Live() {
  const camera = useCamera();
  const [showDebug, setShowDebug] = useState(false);
  const [showSilhouette, setShowSilhouette] = useState(false);

  const { detections, fps, status: detectorStatus, error: detectorError } = useDetectionLoop({
    videoRef: camera.videoRef,
    enabled: camera.status === "running",
    targetFps: TARGET_FPS,
  });

  const { gallery, loading: galleryLoading } = useEmbeddingGallery();

  const recognition = useLiveRecognition({
    videoRef: camera.videoRef,
    detections,
    enabled: camera.status === "running",
    gallery,
  });

  const faceMatchThreshold = useSettingsStore((state) => state.faceMatchThreshold);
  const petMatchThreshold = useSettingsStore((state) => state.petMatchThreshold);
  const activeProfile = useSettingsStore(
    (state) => state.profiles[state.activeCameraKey] ?? null,
  );

  const green = useGreenFrame(camera.videoRef, camera.status === "running");

  const landmarkTracking = useLandmarkLoop({
    videoRef: camera.videoRef,
    enabled: camera.status === "running",
    targetFps: TARGET_FPS,
    // Masks are only copied out of the model while the silhouette is shown.
    segmentation: showSilhouette,
  });

  // Pure analysis over the landmark frame above: no second inference, no
  // second camera stream.
  const movement = useMovementAnalysis({
    frame: landmarkTracking.frame,
    enabled: camera.status === "running",
    videoRef: camera.videoRef,
  });

  const items: OverlayItem[] = recognition.tracks.map((track) => ({
    key: String(track.id),
    label: track.label,
    kind: track.kind,
    confidence: track.confidence,
    box: track.box,
    name: track.name,
  }));

  const cameraTone: PillTone =
    camera.status === "running" ? "ok" : camera.status === "error" ? "error" : "warn";

  const cameraLabel =
    camera.status === "running"
      ? "Camera on"
      : camera.status === "starting"
        ? "Starting camera…"
        : camera.status === "error"
          ? "Camera blocked"
          : "Camera off";

  const detectorTone: PillTone =
    detectorStatus === "ready"
      ? "ok"
      : detectorStatus === "error"
        ? "error"
        : detectorStatus === "loading"
          ? "warn"
          : "muted";

  const facePill = modelPill(recognition.faceStatus, "Faces");
  const petPill = modelPill(recognition.petStatus, "Pets");

  const named = recognition.tracks.filter(
    (track) => track.name !== null && track.name !== "Unknown",
  ).length;
  const unknown = recognition.tracks.filter((track) => track.name === "Unknown").length;

  const enrolledCount = gallery.people.length + gallery.pets.length;

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Live camera</h1>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <Pill tone={cameraTone} dot>
            {cameraLabel}
          </Pill>
          <Pill tone={detectorTone} dot>
            {detectorStatus === "ready"
              ? "Model ready"
              : detectorStatus === "loading"
                ? "Loading model…"
                : detectorStatus === "error"
                  ? "Model failed"
                  : "Model idle"}
          </Pill>
          {recognition.faceStatus !== "idle" ? (
            <Pill tone={facePill.tone} dot>
              {facePill.text}
            </Pill>
          ) : null}
          {recognition.petStatus !== "idle" ? (
            <Pill tone={petPill.tone} dot>
              {petPill.text}
            </Pill>
          ) : null}
          <Pill tone="muted">{fps} FPS</Pill>
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Point the camera at a person, dog, cat or other animal. Human bodies are drawn as pose,
        hand and face landmarks; amber boxes are animals. A name appears after three matching
        results in a row.
      </p>

      {/* The wrapper matches the video box exactly, so the canvas overlay can
          scale video pixels to screen pixels without guessing. */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-black dark:border-slate-800">
        <div className={`relative w-full ${camera.status === "running" ? "" : "aspect-video"}`}>
          <video
            ref={camera.videoRef}
            className="block h-auto w-full"
            // Mirror only the preview; the canvas flips box coordinates itself,
            // so labels stay readable.
            style={camera.isMirrored ? { transform: "scaleX(-1)" } : undefined}
            autoPlay
            muted
            playsInline
          />

          <CanvasOverlay
            items={items}
            landmarks={landmarkTracking.frame}
            analysis={movement.analysis}
            silhouette={showSilhouette}
            videoRef={camera.videoRef}
            mirrored={camera.isMirrored}
          />

          {camera.status !== "running" ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-sm">
                <p className="text-sm font-medium text-slate-200">
                  {camera.status === "error" ? "Camera unavailable" : "Waiting for the camera…"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {camera.error ??
                    "If your browser asks for permission, choose Allow. The preview appears here."}
                </p>
                {camera.status === "error" ? (
                  <button
                    type="button"
                    onClick={camera.retry}
                    className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                  >
                    Retry camera
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {camera.status === "running" && recognition.tracks.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent p-3">
              <p className="text-xs text-slate-200">
                Nothing detected yet — keep the subject in view.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {camera.status === "running" && green.isGreen ? (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <p className="font-medium">The camera is sending a flat green frame</p>
          <p className="mt-1 leading-relaxed">
            This usually means a virtual camera driver (for example DroidCam) is not delivering
            real video to this browser.{" "}
            {camera.mode === "compatible"
              ? "Compatibility mode is already on. Reconnect the camera, restart its driver, or try another browser."
              : "Try compatibility mode, which asks the driver for a plain video stream."}
          </p>
          {camera.mode !== "compatible" ? (
            <button
              type="button"
              onClick={() => camera.setMode("compatible")}
              className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
            >
              Try compatibility mode
            </button>
          ) : null}
        </div>
      ) : null}

      {camera.notice ? (
        <div
          role="status"
          className="mt-3 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"
        >
          {camera.notice}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Camera</span>
          <select
            value={camera.selectedId ?? ""}
            onChange={(event) => camera.selectCamera(event.target.value || null)}
            disabled={camera.devices.length === 0}
            className="max-w-56 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">Default camera</option>
            {camera.selectedId &&
            !camera.devices.some((device) => device.deviceId === camera.selectedId) ? (
              <option value={camera.selectedId}>Selected camera</option>
            ) : null}
            {camera.devices.map((device, index) => (
              <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        </label>

        <label
          className="flex items-center gap-2 text-sm"
          title="Ask the browser for any video stream, without resolution or facing preferences. Useful when a virtual camera (DroidCam) shows a green frame."
        >
          <input
            type="checkbox"
            checked={camera.mode === "compatible"}
            onChange={(event) =>
              camera.setMode(event.target.checked ? "compatible" : "standard")
            }
            className="size-4 accent-emerald-600"
          />
          Compatibility mode
        </label>

        <button
          type="button"
          onClick={camera.toggleMirror}
          aria-pressed={camera.isMirrored}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
            camera.isMirrored
              ? "border-emerald-500 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
              : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          }`}
        >
          Mirror preview
        </button>

        <button
          type="button"
          onClick={camera.retry}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Retry
        </button>

        <button
          type="button"
          disabled
          title="Capture arrives in a later stage"
          className="rounded-xl bg-emerald-600 px-6 py-2 text-sm font-semibold text-white opacity-50"
        >
          Capture
        </button>

        <button
          type="button"
          onClick={() => setShowDebug((current) => !current)}
          aria-pressed={showDebug}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
            showDebug
              ? "border-emerald-500 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
              : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          }`}
        >
          Debug
        </button>

        <button
          type="button"
          onClick={() => setShowSilhouette((current) => !current)}
          aria-pressed={showSilhouette}
          title="Draw the optional body outline from the pose segmentation model"
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
            showSilhouette
              ? "border-emerald-500 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
              : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          }`}
        >
          Silhouette
        </button>

        <span className="text-xs text-slate-500 dark:text-slate-400">
          {recognition.tracks.length} tracked · {named} named · {unknown} unknown
        </span>
      </div>

      {camera.streamInfo && camera.status === "running" ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {camera.streamInfo.label}
          {camera.streamInfo.width > 0 && camera.streamInfo.height > 0
            ? ` · ${camera.streamInfo.width}×${camera.streamInfo.height}`
            : ""}
          {camera.streamInfo.frameRate > 0
            ? ` · ${Math.round(camera.streamInfo.frameRate)} fps`
            : ""}{" "}
          · {camera.mode === "compatible" ? "compatibility mode" : "standard mode"}
        </p>
      ) : null}

      {enrolledCount === 0 && !galleryLoading ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          No one is enrolled yet, so every object stays unnamed.{" "}
          <Link to="/people" className="font-medium text-emerald-700 underline dark:text-emerald-400">
            Enroll a person or pet
          </Link>
          .
        </p>
      ) : null}

      {showDebug ? (
        <DebugPanel
          tracks={recognition.tracks}
          faceThreshold={faceMatchThreshold}
          petThreshold={petMatchThreshold}
          profile={activeProfile}
          faceStatus={recognition.faceStatus}
          petStatus={recognition.petStatus}
          recognitions={recognition.recognitions}
          cameraLabel={camera.streamInfo?.label ?? null}
          cameraMode={camera.mode}
          cameraInfo={camera.streamInfo}
          greenRatio={green.ratio}
          poseStatus={landmarkTracking.status.pose}
          handStatus={landmarkTracking.status.hand}
          faceLandmarkStatus={landmarkTracking.status.face}
          poseCount={landmarkTracking.frame.poses.length}
          handCount={landmarkTracking.frame.hands.length}
          faceCount={landmarkTracking.frame.faces.length}
          landmarkFps={landmarkTracking.fps}
        />
      ) : null}

      {detectorError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <p className="font-medium">The detection model could not load.</p>
          <p className="mt-1 leading-relaxed">{detectorError}</p>
          <p className="mt-1 leading-relaxed">
            Check your internet connection (the model is ~7 MB and downloads once), then reload
            the page.
          </p>
        </div>
      ) : null}

      {landmarkTracking.error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <p className="font-medium">The landmark tracking models could not load.</p>
          <p className="mt-1 leading-relaxed">{landmarkTracking.error}</p>
          <p className="mt-1 leading-relaxed">
            Pose, hand and face models download once (~18 MB total). Check your internet
            connection, then reload the page.
          </p>
        </div>
      ) : null}

      {recognition.faceError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <p className="font-medium">The face models could not load.</p>
          <p className="mt-1 leading-relaxed">{recognition.faceError}</p>
        </div>
      ) : null}

      {recognition.petError ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <p className="font-medium">The pet model could not load.</p>
          <p className="mt-1 leading-relaxed">{recognition.petError}</p>
        </div>
      ) : null}

      {camera.error && camera.status === "error" ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <p className="font-medium">Camera problem</p>
          <p className="mt-1 leading-relaxed">{camera.error}</p>
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Everything runs on this device: frames and descriptors are never uploaded. The camera
        needs HTTPS or localhost — see the README for testing on a phone.
      </p>
    </section>
  );
}
