/**
 * Checks whether the detected pose is in a good position to start squat tracking.
 * Only when this returns true should we feed frames into rep detection and form checks.
 */

import type { Keypoints } from './types';

const MIN_POSE_CONF = 0.45;
const IN_FRAME_MIN = 0.04;
const IN_FRAME_MAX = 0.96;
const MIN_VERTICAL_SPAN = 0.2;

function inFrame(v: number): boolean {
  return v >= IN_FRAME_MIN && v <= IN_FRAME_MAX;
}

/**
 * Returns true if the body map looks like a normal standing person ready for squat tracking:
 * - Pose confidence above threshold
 * - Standing: shoulders above hips, hips above knees, knees above ankles (Y increases downward)
 * - Full body in frame: keypoints not at edges
 * - Sufficient vertical extent (person not too small / far away)
 */
export function isBodyReadyForSquat(kpts: Keypoints, conf: number): boolean {
  if (conf < MIN_POSE_CONF) return false;

  const shoulderMidY = (kpts.l_shoulder[1] + kpts.r_shoulder[1]) / 2;
  const hipMidY = (kpts.l_hip[1] + kpts.r_hip[1]) / 2;
  const kneeMidY = (kpts.l_knee[1] + kpts.r_knee[1]) / 2;
  const ankleMidY = (kpts.l_ankle[1] + kpts.r_ankle[1]) / 2;

  // Standing: shoulders above hips above knees above ankles (normalized Y increases down)
  if (shoulderMidY >= hipMidY) return false;
  if (hipMidY >= kneeMidY) return false;
  if (kneeMidY >= ankleMidY) return false;

  // All keypoints in frame (no clipping at edges)
  const points: [number, number][] = [
    kpts.l_hip, kpts.r_hip, kpts.l_knee, kpts.r_knee,
    kpts.l_ankle, kpts.r_ankle, kpts.l_shoulder, kpts.r_shoulder,
  ];
  for (const [x, y] of points) {
    if (!inFrame(x) || !inFrame(y)) return false;
  }

  // Sufficient vertical span (full body visible, not tiny)
  const topY = Math.min(kpts.l_shoulder[1], kpts.r_shoulder[1]);
  const bottomY = Math.max(kpts.l_ankle[1], kpts.r_ankle[1]);
  if (bottomY - topY < MIN_VERTICAL_SPAN) return false;

  return true;
}
