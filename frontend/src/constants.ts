/**
 * MediaPipe Pose Landmarker indices (same as BlazePose).
 * https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
 */
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export const TARGET_FPS = 20;
export const SMOOTHING_ALPHA = 0.4;
export const REP_MIN_FRAMES = 10;
export const REP_MAX_FRAMES = 150;
/** Min normalized hip drop (as fraction of body height) to count as deep enough; lower = less strict */
export const HIP_DROP_DEEP_THRESHOLD = 0.07;
export const VALGUS_THRESHOLD_NORM = 0.04;
export const TORSO_LEAN_THRESHOLD_DEG = 45;
export const ANKLE_RISE_THRESHOLD = 0.02;
export const ASYMMETRY_HIP_DIFF_THRESHOLD = 0.05;
export const ASYMMETRY_KNEE_ANGLE_DIFF_THRESHOLD = 10;

// Pushup form thresholds
/** Min elbow angle (deg) at bottom for good depth; below = too shallow */
export const PUSHUP_ELBOW_DEPTH_THRESHOLD = 95;
/** Max variance of shoulder mid Y (normalized) across rep for "level shoulders" */
export const PUSHUP_SHOULDER_VARIANCE_THRESHOLD = 0.015;
/** Max variance of hip mid Y (normalized) across rep for "stable hips" */
export const PUSHUP_HIP_VARIANCE_THRESHOLD = 0.015;
/** Max deviation (deg) of shoulder-hip line from horizontal at bottom for plank alignment */
export const PUSHUP_TORSO_TILT_THRESHOLD_DEG = 15;
/** Max L-R shoulder height diff (normalized) for symmetry */
export const PUSHUP_ASYMMETRY_SHOULDER_THRESHOLD = 0.03;
/** Max L-R elbow angle diff (deg) for symmetry */
export const PUSHUP_ASYMMETRY_ELBOW_THRESHOLD = 12;

/** Set to true and open DevTools Console to see rep-detection debug logs. */
export const REP_DEBUG = true;
