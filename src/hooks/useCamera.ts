import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useSettingsStore } from "../store/settingsStore";
import type { CameraMode } from "../store/settingsStore";

export type CameraStatus = "idle" | "starting" | "running" | "error";

/**
 * Browsers report camera problems as cryptic DOMException names.
 * WHY this map: a beginner should see "Camera permission was denied", not
 * "NotAllowedError".
 */
const FRIENDLY_ERRORS: Record<string, string> = {
  NotAllowedError:
    "Camera permission was denied. Allow camera access in your browser's site settings, then tap Retry.",
  PermissionDeniedError:
    "Camera permission was denied. Allow camera access in your browser's site settings, then tap Retry.",
  NotFoundError: "No camera was found on this device.",
  DevicesNotFoundError: "No camera was found on this device.",
  NotReadableError:
    "The camera is already being used by another app or browser tab. Close it, then tap Retry.",
  TrackStartError:
    "The camera could not be started. It may be in use by another app. Close it, then tap Retry.",
  OverconstrainedError:
    "This camera rejected the requested settings. Try compatibility mode.",
  SecurityError:
    "The browser blocked camera access. Make sure the page is served over HTTPS or localhost.",
  AbortError: "The camera stopped unexpectedly. Tap Retry to start it again.",
};

function friendlyCameraMessage(error: unknown): string {
  // The clearest cause first: camera APIs only exist in a secure context.
  if (!window.isSecureContext) {
    return "Camera access needs HTTPS or localhost. On a phone, use `npm run dev:https` or a tunnel such as Cloudflare Tunnel.";
  }

  if (error instanceof DOMException) {
    return (
      FRIENDLY_ERRORS[error.name] ??
      `The camera could not be started (${error.name}). Tap Retry.`
    );
  }

  if (error instanceof Error) return error.message;
  return "The camera could not be started. Tap Retry.";
}

/** The selected camera disappeared between the click and getUserMedia. */
function isMissingCamera(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError" ||
      error.name === "OverconstrainedError")
  );
}

/**
 * Mirror the preview for cameras that are pointed at the user.
 *
 * WHY not mirror everything: a phone's rear camera (or a virtual camera that
 * already flips the image) looks wrong when mirrored. Labels are the only hint
 * the browser gives us, and the user can always override with the toggle.
 */
function shouldMirror(label: string): boolean {
  const lower = label.toLowerCase();
  if (/\b(back|rear|environment)\b/.test(lower)) return false;
  if (/\b(front|user|face|selfie|facetime)\b/.test(lower)) return true;
  return true;
}

export interface StreamInfo {
  deviceId: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

export interface CameraApi {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
  /** Non-fatal message, e.g. "selected camera disconnected, using default". */
  notice: string | null;
  devices: MediaDeviceInfo[];
  /** Number of video input devices found (0 until permission is granted). */
  cameraCount: number;
  selectedId: string | null;
  mode: CameraMode;
  /** True for the front camera: the preview is mirrored like a mirror. */
  isMirrored: boolean;
  streamInfo: StreamInfo | null;
  selectCamera: (id: string | null) => void;
  setMode: (mode: CameraMode) => void;
  toggleMirror: () => void;
  retry: () => void;
}

/**
 * Owns the camera stream for one <video> element.
 *
 * WHY a hook: the stream, the effect cleanup and the error messages are easy to
 * get wrong. Keeping them in one place means the Live page is just UI, and the
 * camera light always turns off when the page unmounts.
 *
 * Camera choice and compatibility mode live in the settings store so they
 * survive a reload; starting a stream also activates that camera's threshold
 * profile, which is what makes auto-tuning per device work.
 */
export function useCamera(): CameraApi {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [isMirrored, setIsMirrored] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const cameraId = useSettingsStore((state) => state.cameraId);
  const cameraMode = useSettingsStore((state) => state.cameraMode);
  const setCameraId = useSettingsStore((state) => state.setCameraId);
  const setCameraMode = useSettingsStore((state) => state.setCameraMode);
  const activateCamera = useSettingsStore((state) => state.activateCamera);

  // Fresh values inside listeners without re-subscribing them every render.
  const statusRef = useRef(status);
  statusRef.current = status;
  const selectedRef = useRef(cameraId);
  selectedRef.current = cameraId;

  // Only re-apply the mirror heuristic when the camera itself changes; a Retry
  // or a compatibility-mode switch must not undo the user's choice.
  const mirrorCameraRef = useRef<string | null>(null);

  // --- Device list: refresh on mount and whenever hardware is plugged in ----
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const all = await mediaDevices.enumerateDevices();
        if (cancelled) return;
        const videoInputs = all.filter((device) => device.kind === "videoinput");
        setDevices(videoInputs);

        const selected = selectedRef.current;
        if (selected && videoInputs.every((device) => device.deviceId !== selected)) {
          // Unplugged while selected: fall back instead of showing an error.
          setNotice(
            "The selected camera was disconnected, so the default camera was started instead.",
          );
          setCameraId(null);
        } else if (statusRef.current === "error" && videoInputs.length > 0) {
          // A camera came back: try again without making the user press Retry.
          setAttempt((current) => current + 1);
        }
      } catch {
        // enumerateDevices may fail before permission; the stream attempt will
        // surface the real problem with a friendly message.
      }
    };

    const onChange = () => void refresh();
    void refresh();
    mediaDevices.addEventListener("devicechange", onChange);

    return () => {
      cancelled = true;
      mediaDevices.removeEventListener("devicechange", onChange);
    };
  }, [setCameraId]);

  // --- Stream lifecycle ----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start() {
      setStatus("starting");
      setError(null);

      // Older browsers, and any page served over plain http:// on the LAN.
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError(
          "This browser does not expose the camera API here. Camera access needs HTTPS or localhost.",
        );
        return;
      }

      try {
        stream = await openStream(cameraId, cameraMode);

        // The component may have unmounted while the permission prompt was open.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            await video.play();
          } catch {
            // Autoplay can be blocked until a user gesture. The element is
            // muted + playsInline, so in practice this rarely happens.
          }
        }

        if (cancelled) return;

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() ?? {};
        const actualId = settings.deviceId || cameraId || "";
        const label = track?.label || "Camera";
        const info: StreamInfo = {
          deviceId: actualId,
          label,
          width: settings.width ?? video?.videoWidth ?? 0,
          height: settings.height ?? video?.videoHeight ?? 0,
          frameRate: settings.frameRate ?? 0,
        };

        setStreamInfo(info);
        setStatus("running");

        const mirrorKey = actualId || "default";
        if (mirrorCameraRef.current !== mirrorKey) {
          mirrorCameraRef.current = mirrorKey;
          setIsMirrored(shouldMirror(label));
        }

        // Load this camera's threshold profile (creating it on first use).
        activateCamera(actualId, label);

        // Labels are only readable after permission, so refresh the list now.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices(all.filter((device) => device.kind === "videoinput"));
        }

        // Unplugging a USB/virtual camera usually ends the track silently.
        if (track) {
          track.onended = () => {
            if (cancelled) return;
            setStatus("error");
            setError("The camera stopped. Reconnect it, then tap Retry.");
          };
        }
      } catch (caught) {
        if (cancelled) return;

        // A saved camera id can outlive the device. Recover by starting the
        // default camera instead of leaving the page broken.
        if (cameraId && isMissingCamera(caught)) {
          setNotice(
            "The selected camera is not available right now, so the default camera was started instead.",
          );
          setCameraId(null);
          return;
        }

        setStatus("error");
        setError(friendlyCameraMessage(caught));
      }
    }

    void start();

    return () => {
      // WHY stop the tracks: this is what turns the camera light off. Just
      // clearing srcObject is not enough in every browser.
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [cameraId, cameraMode, attempt, activateCamera, setCameraId]);

  const selectCamera = useCallback(
    (id: string | null) => {
      setNotice(null);
      setCameraId(id);
    },
    [setCameraId],
  );

  const setMode = useCallback(
    (mode: CameraMode) => {
      setNotice(null);
      setCameraMode(mode);
    },
    [setCameraMode],
  );

  const toggleMirror = useCallback(() => {
    setIsMirrored((current) => !current);
  }, []);

  const retry = useCallback(() => {
    setNotice(null);
    setAttempt((current) => current + 1);
  }, []);

  return {
    videoRef,
    status,
    error,
    notice,
    devices,
    cameraCount: devices.length,
    selectedId: cameraId,
    mode: cameraMode,
    isMirrored,
    streamInfo,
    selectCamera,
    setMode,
    toggleMirror,
    retry,
  };
}

/**
 * Ask for a stream with as few constraints as possible in compatibility mode.
 *
 * WHY: virtual cameras such as DroidCam can report a resolution they cannot
 * actually deliver. `{ video: true }` lets the driver pick, which is the usual
 * fix for a green or frozen frame.
 */
async function openStream(cameraId: string | null, mode: CameraMode): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;

  if (mode === "compatible") {
    return mediaDevices.getUserMedia({ audio: false, video: true });
  }

  if (cameraId) {
    try {
      return await mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: cameraId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (caught) {
      // Some cameras refuse 720p. Keep the device, drop the resolution.
      if (caught instanceof DOMException && caught.name === "OverconstrainedError") {
        return mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: cameraId } },
        });
      }
      throw caught;
    }
  }

  return mediaDevices.getUserMedia({
    audio: false,
    video: {
      // `ideal` means "prefer this, but do not fail if unavailable", so a
      // laptop with one camera still works.
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}
