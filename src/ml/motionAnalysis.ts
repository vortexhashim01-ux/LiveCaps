import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Movement analysis on top of the landmarks the app already produces.
 *
 * WHY this lives outside the React components: every feature here (trails,
 * gestures, angles, actions, analytics) is arithmetic over the same landmark
 * frame. Keeping it in one pure module means the overlay only draws, the hook
 * only owns state, and the existing pose/hand/face pipeline is untouched.
 *
 * Everything here is 2D and camera-relative. There is no depth model, so
 * "forward/backward" is deliberately not reported: a single camera genuinely
 * cannot tell it apart from a size change.
 */

export type GestureName =
  | "Thumbs up"
  | "Thumbs down"
  | "Open palm"
  | "Closed fist"
  | "Pointing up"
  | "Victory";

export type ActionName =
  | "Standing"
  | "Walking"
  | "Running"
  | "Jumping"
  | "Squatting"
  | "Sitting";

export type DirectionName = "still" | "left" | "right" | "up" | "down";

const ACTION_NAMES: ActionName[] = [
  "Standing",
  "Walking",
  "Running",
  "Jumping",
  "Squatting",
  "Sitting",
];

/** One point of a fading trail. `t` is performance.now() milliseconds. */
export interface TrailSample {
  x: number;
  y: number;
  t: number;
}

/** Trail points for one landmark, oldest first. */
export interface Trail {
  joint: number;
  points: TrailSample[];
}

/** A joint angle, positioned at the joint in normalized video space. */
export interface JointAngleBadge {
  joint: number;
  /** Short label such as "142°". */
  text: string;
  x: number;
  y: number;
}

export interface PoseMotion {
  id: number;
  trails: Trail[];
  angles: JointAngleBadge[];
  action: ActionName;
  direction: DirectionName;
  /** "→" / "↑" / "·"… Screen-independent; the overlay flips it when mirrored. */
  arrow: string;
  /** Rough metres per second, from a 0.55 m torso assumption. */
  speed: number;
  /** Hip centre in normalized video space; used to anchor the analytics chip. */
  x: number;
  y: number;
}

export interface GestureBadge {
  id: number;
  name: GestureName;
  /** Top centre of the hand in normalized video space. */
  x: number;
  y: number;
}

export interface MotionAnalysis {
  poses: PoseMotion[];
  gestures: GestureBadge[];
}

export const EMPTY_MOTION: MotionAnalysis = { poses: [], gestures: [] };

/** Wrists, elbows, knees and ankles: the joints the brief asks us to trace. */
export const TRAIL_JOINTS = [15, 16, 13, 14, 25, 26, 27, 28] as const;

export const TRAIL_MS = 1200;

const MAX_TRAIL_POINTS = 36;
const VISIBILITY_MIN = 0.5;
/** A pose/face landmark is "there" only when the model is reasonably sure. */
const BODY_MATCH_DISTANCE = 0.3;
const HAND_MATCH_DISTANCE = 0.34;
const TRACK_TIMEOUT_MS = 1600;
/** Anthropometric average torso length, only used to turn ratios into m/s. */
const TORSO_METERS = 0.55;
const GESTURE_HOLD_MS = 700;
const GESTURE_FRAMES = 2;
/** Votes needed before the action label changes, and how fast votes decay. */
const ACTION_VOTES = 3;
const ACTION_DECAY = 0.6;

type Point2 = { x: number; y: number };

interface BodyTrack {
  id: number;
  /** Normalized smoothed landmark positions, keyed by MediaPipe index. */
  smoothed: Map<number, Point2>;
  trails: Map<number, TrailSample[]>;
  anchor: Point2;
  lastHip: Point2 | null;
  seenAt: number;
  velocity: Point2;
  speed: number;
  action: ActionName;
  /** Running vote per action: this is the "many frames, not one" part. */
  scores: Record<ActionName, number>;
  direction: DirectionName;
  arrow: string;
}

interface HandTrack {
  id: number;
  wrist: Point2;
  name: GestureName | null;
  candidate: GestureName | null;
  candidateFrames: number;
  holdUntil: number;
  at: Point2;
  seenAt: number;
}

export interface MotionAnalyzer {
  update(
    poses: NormalizedLandmark[][],
    hands: NormalizedLandmark[][],
    now: number,
    aspect: number,
  ): MotionAnalysis;
  reset(): void;
}

/** True when the landmark exists and the model is confident it is visible. */
function usable(point: NormalizedLandmark | undefined): point is NormalizedLandmark {
  return (
    point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (point.visibility ?? 1) >= VISIBILITY_MIN
  );
}

function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle at `b`, in degrees (0..180). Straight limbs are close to 180°. */
function angleAt(a: Point2, b: Point2, c: Point2): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const lengths = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (lengths === 0) return 0;

  const cosine = (ab.x * cb.x + ab.y * cb.y) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

const ANGLE_JOINTS: { joint: number; from: number; at: number; to: number }[] = [
  { joint: 13, from: 11, at: 13, to: 15 }, // left elbow
  { joint: 14, from: 12, at: 14, to: 16 }, // right elbow
  { joint: 11, from: 13, at: 11, to: 23 }, // left shoulder
  { joint: 12, from: 14, at: 12, to: 24 }, // right shoulder
  { joint: 23, from: 11, at: 23, to: 25 }, // left hip
  { joint: 24, from: 12, at: 24, to: 26 }, // right hip
  { joint: 25, from: 23, at: 25, to: 27 }, // left knee
  { joint: 26, from: 24, at: 26, to: 28 }, // right knee
];

/** Hand landmark groups: [mcp, pip, tip] for each of the four fingers. */
const FINGERS = {
  index: [5, 6, 8],
  middle: [9, 10, 12],
  ring: [13, 14, 16],
  pinky: [17, 18, 20],
} as const;

function createBodyTrack(id: number, anchor: Point2): BodyTrack {
  return {
    id,
    smoothed: new Map(),
    trails: new Map(),
    anchor,
    lastHip: null,
    seenAt: 0,
    velocity: { x: 0, y: 0 },
    speed: 0,
    action: "Standing",
    scores: { Standing: 0, Walking: 0, Running: 0, Jumping: 0, Squatting: 0, Sitting: 0 },
    direction: "still",
    arrow: "·",
  };
}

function createHandTrack(id: number, wrist: Point2): HandTrack {
  return {
    id,
    wrist,
    name: null,
    candidate: null,
    candidateFrames: 0,
    holdUntil: 0,
    at: wrist,
    seenAt: 0,
  };
}

function smoothedPoint(track: BodyTrack, index: number, aspect: number): Point2 | undefined {
  const point = track.smoothed.get(index);
  return point ? { x: point.x * aspect, y: point.y } : undefined;
}

export function createMotionAnalyzer(): MotionAnalyzer {
  const bodies = new Map<number, BodyTrack>();
  const handTracks = new Map<number, HandTrack>();
  let nextId = 1;

  function updateBody(track: BodyTrack, pose: NormalizedLandmark[], now: number, aspect: number): PoseMotion {
    const dt = track.seenAt > 0 ? now - track.seenAt : 0;
    track.seenAt = now;

    // Smooth each landmark so trails and angle labels do not jitter with the
    // model's frame-to-frame noise. A long gap means the track was lost: snap
    // instead of easing from a stale position.
    const alpha = dt <= 0 ? 1 : Math.min(1, Math.max(0.3, 1 - Math.exp(-dt / 110)));
    for (let index = 0; index < pose.length; index += 1) {
      const point = pose[index];
      if (!usable(point)) continue;

      const previous = track.smoothed.get(index);
      track.smoothed.set(
        index,
        previous
          ? {
              x: previous.x + (point.x - previous.x) * alpha,
              y: previous.y + (point.y - previous.y) * alpha,
            }
          : { x: point.x, y: point.y },
      );
    }

    const hipLeft = smoothedPoint(track, 23, aspect);
    const hipRight = smoothedPoint(track, 24, aspect);
    const hip = hipLeft && hipRight ? midpoint(hipLeft, hipRight) : (hipLeft ?? hipRight ?? null);
    if (hip) track.anchor = hip;

    // --- Trails --------------------------------------------------------
    for (const joint of TRAIL_JOINTS) {
      const point = smoothedPoint(track, joint, aspect);
      if (!point) continue;

      const points = track.trails.get(joint) ?? [];
      points.push({ x: point.x, y: point.y, t: now });
      while (points.length > 0 && (now - points[0].t > TRAIL_MS || points.length > MAX_TRAIL_POINTS)) {
        points.shift();
      }
      track.trails.set(joint, points);
    }

    // --- Joint angles --------------------------------------------------
    const angles: JointAngleBadge[] = [];
    for (const { joint, from, at, to } of ANGLE_JOINTS) {
      const a = smoothedPoint(track, from, aspect);
      const b = smoothedPoint(track, at, aspect);
      const c = smoothedPoint(track, to, aspect);
      if (!a || !b || !c) continue;

      const degrees = angleAt(a, b, c);
      const normalized = track.smoothed.get(at);
      if (!normalized) continue;

      angles.push({
        joint,
        text: `${Math.round(degrees)}°`,
        x: normalized.x,
        y: normalized.y,
      });
    }

    // --- Velocity, direction, speed ------------------------------------
    if (hip && track.lastHip && dt > 20) {
      const instant = {
        x: ((hip.x - track.lastHip.x) * aspect) / (dt / 1000),
        y: (hip.y - track.lastHip.y) / (dt / 1000),
      };
      if (dt > 500) {
        track.velocity = instant;
      } else {
        track.velocity = {
          x: track.velocity.x + (instant.x - track.velocity.x) * 0.45,
          y: track.velocity.y + (instant.y - track.velocity.y) * 0.45,
        };
      }
    }
    track.lastHip = hip;

    const shoulderLeft = smoothedPoint(track, 11, aspect);
    const shoulderRight = smoothedPoint(track, 12, aspect);
    const shoulder =
      shoulderLeft && shoulderRight
        ? midpoint(shoulderLeft, shoulderRight)
        : (shoulderLeft ?? shoulderRight ?? null);
    const torso = hip && shoulder ? distance(hip, shoulder) : 0;

    const raw = {
      x: Number.isFinite(track.velocity.x) ? track.velocity.x : 0,
      y: Number.isFinite(track.velocity.y) ? track.velocity.y : 0,
    };
    const torsoRatio = torso > 0.02 ? Math.hypot(raw.x, raw.y) / torso : 0;
    track.speed = torsoRatio;

    // --- Action state machine ------------------------------------------
    if (hip && torso > 0.02) {
      const kneeLeft = smoothedPoint(track, 25, aspect);
      const kneeAngles = angles
        .filter((angle) => angle.joint === 25 || angle.joint === 26)
        .map((angle) => Number.parseInt(angle.text, 10))
        .filter((value) => Number.isFinite(value));
      const kneeAverage =
        kneeAngles.length > 0
          ? kneeAngles.reduce((sum, value) => sum + value, 0) / kneeAngles.length
          : 180;

      const thigh = hipLeft && kneeLeft ? { x: kneeLeft.x - hipLeft.x, y: kneeLeft.y - hipLeft.y } : null;
      const thighHorizontal = thigh ? Math.abs(thigh.x) > Math.abs(thigh.y) * 1.05 : false;
      const verticalSpeed = torso > 0.02 ? raw.y / torso : 0;

      // How far the hips sit above the ankles, in torso lengths. Standing is
      // roughly 1.4; a crouch or a chair pulls it under 1.1. This works from a
      // front-facing camera too, where the knee barely bends in 2D.
      const ankleLeft = smoothedPoint(track, 27, aspect);
      const ankleRight = smoothedPoint(track, 28, aspect);
      const ankle =
        ankleLeft && ankleRight
          ? midpoint(ankleLeft, ankleRight)
          : (ankleLeft ?? ankleRight ?? null);
      const legExtension = ankle ? (ankle.y - hip.y) / torso : null;

      // Sitting and a deep lunge look alike in a single 2D frame: both lower
      // the hips over bent knees. The difference is that a seated shin stays
      // vertical under the knee, while a lunge throws the whole leg sideways.
      const shinVertical =
        kneeLeft && ankleLeft
          ? Math.abs(ankleLeft.x - kneeLeft.x) < Math.abs(ankleLeft.y - kneeLeft.y) * 0.8
          : false;
      const kneeRight = smoothedPoint(track, 26, aspect);
      const kneeY =
        kneeLeft && kneeRight ? (kneeLeft.y + kneeRight.y) / 2 : (kneeLeft?.y ?? kneeRight?.y ?? null);
      const hipsAtOrBelowKnees = kneeY !== null && hip.y >= kneeY - 0.02;

      const sitting =
        legExtension !== null &&
        // A seated body does not travel across the frame; this also keeps a
        // deep lunge that is moving from being called "Sitting".
        torsoRatio < 1.0 &&
        kneeAverage < 160 &&
        (hipsAtOrBelowKnees || (thighHorizontal && shinVertical && legExtension < 1.05));
      const squatting =
        !sitting &&
        legExtension !== null &&
        legExtension < 1.15 &&
        kneeAverage < 150 &&
        // A fast crouched run should still read as Running below.
        torsoRatio < 1.8;

      let candidate: ActionName;
      if (verticalSpeed < -1.2 && torsoRatio > 1.1) {
        candidate = "Jumping";
      } else if (sitting) {
        candidate = "Sitting";
      } else if (squatting) {
        candidate = "Squatting";
      } else if (torsoRatio > 2.1) {
        candidate = "Running";
      } else if (torsoRatio > 0.6) {
        candidate = "Walking";
      } else {
        candidate = "Standing";
      }

      // Vote across frames instead of trusting one frame: the winning label
      // grows while the others decay, so a single noisy pose cannot flip it and
      // a pose that alternates between two plausible labels still settles.
      for (const name of ACTION_NAMES) {
        if (name === candidate) continue;
        track.scores[name] = Math.max(0, track.scores[name] - ACTION_DECAY);
      }
      track.scores[candidate] = Math.min(ACTION_VOTES + 1, track.scores[candidate] + 1);

      if (track.scores[candidate] >= ACTION_VOTES) track.action = candidate;
    }

    // --- Direction ------------------------------------------------------
    if (torsoRatio < 0.45) {
      track.direction = "still";
      track.arrow = "·";
    } else if (Math.abs(raw.x) > Math.abs(raw.y) * 1.35) {
      track.direction = raw.x > 0 ? "right" : "left";
      track.arrow = raw.x > 0 ? "→" : "←";
    } else {
      track.direction = raw.y < 0 ? "up" : "down";
      track.arrow = raw.y < 0 ? "↑" : "↓";
    }

    const trails: Trail[] = [];
    for (const [joint, points] of track.trails) trails.push({ joint, points });

    return {
      id: track.id,
      trails,
      angles,
      action: track.action,
      direction: track.direction,
      arrow: track.arrow,
      speed: torso > 0.02 ? (torsoRatio * TORSO_METERS) : 0,
      x: hip?.x ?? 0.5,
      y: hip?.y ?? 0.5,
    };
  }

  function classifyGesture(hand: NormalizedLandmark[], aspect: number): GestureName | null {
    const point = (index: number): Point2 | null => {
      const landmark = hand[index];
      return usable(landmark) ? { x: landmark.x * aspect, y: landmark.y } : null;
    };

    const wrist = point(0);
    const middleMcp = point(9);
    if (!wrist || !middleMcp) return null;

    const handSize = Math.max(distance(wrist, middleMcp), 0.0001);
    const extended = {
      index: false,
      middle: false,
      ring: false,
      pinky: false,
    };

    for (const [name, [mcp, pip, tip]] of Object.entries(FINGERS)) {
      const base = point(mcp);
      const joint = point(pip);
      const end = point(tip);
      if (!base || !joint || !end) continue;

      const reach = distance(wrist, end);
      const bent = distance(wrist, joint);
      // A curled finger folds back toward the palm, so its tip is closer to
      // the wrist than its middle joint. 1.12 leaves room for foreshortening.
      extended[name as keyof typeof extended] = reach > bent * 1.12;
    }

    const thumbTip = point(4);
    const thumbIp = point(3);
    const thumbMcp = point(2);
    // A tucked thumb folds at its IP joint; an extended one is almost straight.
    const thumbStraight =
      thumbTip !== null && thumbIp !== null && thumbMcp !== null
        ? angleAt(thumbMcp, thumbIp, thumbTip) > 145
        : false;

    const indexOnly = extended.index && !extended.middle && !extended.ring && !extended.pinky;
    const victory = extended.index && extended.middle && !extended.ring && !extended.pinky;
    const allFingers = extended.index && extended.middle && extended.ring && extended.pinky;
    const noFingers = !extended.index && !extended.middle && !extended.ring && !extended.pinky;

    if (allFingers) return "Open palm";

    if (victory) return "Victory";

    if (indexOnly) {
      // "Pointing up" only when the index finger really points at the ceiling.
      const indexTip = point(8);
      const indexMcp = point(5);
      if (indexTip && indexMcp && indexTip.y < indexMcp.y - handSize * 0.15) {
        return "Pointing up";
      }
      return null;
    }

    if (noFingers) {
      if (thumbStraight && thumbTip && thumbIp) {
        if (thumbTip.y < thumbIp.y - handSize * 0.1) return "Thumbs up";
        if (thumbTip.y > thumbIp.y + handSize * 0.1) return "Thumbs down";
      }
      return "Closed fist";
    }

    return null;
  }

  function updateHand(track: HandTrack, hand: NormalizedLandmark[], now: number, aspect: number): GestureBadge | null {
    const landmarks = hand.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (landmarks.length === 0) return null;

    const wrist = landmarks[0] ?? null;
    if (wrist) track.wrist = { x: wrist.x * aspect, y: wrist.y };

    let minX = 1;
    let minY = 1;
    let maxX = 0;
    for (const point of landmarks) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
    }
    track.at = { x: (minX + maxX) / 2, y: minY };

    const name = classifyGesture(hand, aspect);
    if (name === track.candidate) {
      track.candidateFrames += 1;
    } else {
      track.candidate = name;
      track.candidateFrames = 1;
    }

    // Two matching frames in a row before a gesture is shown: one noisy frame
    // must not flash a wrong label.
    if (name && track.candidateFrames >= GESTURE_FRAMES) {
      track.name = name;
      track.holdUntil = now + GESTURE_HOLD_MS;
    }

    if (!track.name || now > track.holdUntil) return null;
    return { id: track.id, name: track.name, x: track.at.x, y: track.at.y };
  }

  function update(
    poses: NormalizedLandmark[][],
    hands: NormalizedLandmark[][],
    now: number,
    aspect: number,
  ): MotionAnalysis {
    const poseMotions: PoseMotion[] = [];
    const gestures: GestureBadge[] = [];
    const usedBodies = new Set<number>();
    const usedHands = new Set<number>();

    for (const pose of poses) {
      const hipLeft = usable(pose[23]) ? { x: pose[23].x * aspect, y: pose[23].y } : null;
      const hipRight = usable(pose[24]) ? { x: pose[24].x * aspect, y: pose[24].y } : null;
      const anchor = hipLeft && hipRight ? midpoint(hipLeft, hipRight) : (hipLeft ?? hipRight ?? null);

      // Follow the same body across frames by hip proximity. MediaPipe does
      // not promise a stable order for multiple poses.
      let track: BodyTrack | null = null;
      if (anchor) {
        let best = BODY_MATCH_DISTANCE;
        for (const candidate of bodies.values()) {
          if (usedBodies.has(candidate.id)) continue;
          const gap = distance(candidate.anchor, anchor);
          if (gap < best) {
            best = gap;
            track = candidate;
          }
        }
      }

      if (!track) {
        track = createBodyTrack(nextId++, anchor ?? { x: 0.5, y: 0.5 });
        bodies.set(track.id, track);
      }

      usedBodies.add(track.id);
      poseMotions.push(updateBody(track, pose, now, aspect));
    }

    for (const hand of hands) {
      const wrist = usable(hand[0]) ? { x: hand[0].x * aspect, y: hand[0].y } : null;

      let track: HandTrack | null = null;
      if (wrist) {
        let best = HAND_MATCH_DISTANCE;
        for (const candidate of handTracks.values()) {
          if (usedHands.has(candidate.id)) continue;
          const gap = distance(candidate.wrist, wrist);
          if (gap < best) {
            best = gap;
            track = candidate;
          }
        }
      }

      if (!track) {
        track = createHandTrack(nextId++, wrist ?? { x: 0.5, y: 0.5 });
        handTracks.set(track.id, track);
      }

      usedHands.add(track.id);
      track.seenAt = now;

      const badge = updateHand(track, hand, now, aspect);
      if (badge) gestures.push(badge);
    }

    // Drop bodies that left the frame; the overlay stops drawing their trails.
    for (const track of bodies.values()) {
      if (now - track.seenAt > TRACK_TIMEOUT_MS) bodies.delete(track.id);
    }
    for (const track of handTracks.values()) {
      if (now - track.seenAt > TRACK_TIMEOUT_MS) handTracks.delete(track.id);
    }

    return { poses: poseMotions, gestures };
  }

  return {
    update,
    reset() {
      bodies.clear();
      handTracks.clear();
      nextId = 1;
    },
  };
}
