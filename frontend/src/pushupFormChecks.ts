/**
 * Pushup form checks: depth (elbow ROM), shoulder stability, hip stability,
 * body alignment (plank), asymmetry. Outputs same check shape as squat for API.
 */

import type { SmoothedState } from './smoothing';
import type {
  RepCheckResult,
  RepCheckEvidence,
  Severity,
  CheckStatus,
} from './types';
import {
  PUSHUP_ELBOW_DEPTH_THRESHOLD,
  PUSHUP_SHOULDER_VARIANCE_THRESHOLD,
  PUSHUP_HIP_VARIANCE_THRESHOLD,
  PUSHUP_TORSO_TILT_THRESHOLD_DEG,
  PUSHUP_ASYMMETRY_SHOULDER_THRESHOLD,
  PUSHUP_ASYMMETRY_ELBOW_THRESHOLD,
} from './constants';

function severityToStatus(s: Severity): CheckStatus {
  if (s === 'high') return 'flag';
  if (s === 'moderate') return 'watch';
  return 'ok';
}

function angleDeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  const ba = { x: ax - bx, y: ay - by };
  const bc = { x: cx - bx, y: cy - by };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const mag =
    Math.sqrt(ba.x * ba.x + ba.y * ba.y) *
      Math.sqrt(bc.x * bc.x + bc.y * bc.y) || 1e-6;
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
  );
}

export function computePushupFormChecks(
  frames: SmoothedState[],
  bottomIndex: number,
  topShoulderY: number,
  bottomShoulderY: number
): {
  depth: RepCheckResult;
  knee_tracking: RepCheckResult;
  torso_angle: RepCheckResult;
  heel_lift: RepCheckResult;
  asymmetry: RepCheckResult;
} {
  const b = frames[bottomIndex];
  if (!b) {
    const empty: RepCheckResult = {
      severity: 'low',
      status: 'ok',
      evidence: {},
    };
    return {
      depth: empty,
      knee_tracking: empty,
      torso_angle: empty,
      heel_lift: empty,
      asymmetry: empty,
    };
  }

  const k = b.kpts;
  const shoulderMidY = (k.l_shoulder[1] + k.r_shoulder[1]) / 2;
  const hipMidY = (k.l_hip[1] + k.r_hip[1]) / 2;
  const bodyHeight =
    Math.abs(
      Math.max(k.l_ankle[1], k.r_ankle[1]) -
        (k.l_shoulder[1] + k.r_shoulder[1]) / 2
    ) || 0.01;

  const elbowAngleL = angleDeg(
    k.l_shoulder[0],
    k.l_shoulder[1],
    k.l_elbow[0],
    k.l_elbow[1],
    k.l_wrist[0],
    k.l_wrist[1]
  );
  const elbowAngleR = angleDeg(
    k.r_shoulder[0],
    k.r_shoulder[1],
    k.r_elbow[0],
    k.r_elbow[1],
    k.r_wrist[0],
    k.r_wrist[1]
  );
  const elbowAngleAvg = (elbowAngleL + elbowAngleR) / 2;

  // Depth: elbow angle at bottom (lower = deeper pushup)
  let depthSeverity: Severity = 'low';
  if (elbowAngleAvg > PUSHUP_ELBOW_DEPTH_THRESHOLD + 25) depthSeverity = 'high';
  else if (elbowAngleAvg > PUSHUP_ELBOW_DEPTH_THRESHOLD) depthSeverity = 'moderate';
  const depthEvidence: RepCheckEvidence = {
    bottom_elbow_angle_deg: Math.round(elbowAngleAvg * 10) / 10,
    bottom_elbow_L: Math.round(elbowAngleL * 10) / 10,
    bottom_elbow_R: Math.round(elbowAngleR * 10) / 10,
  };

  // Shoulder stability (constant shoulder level) -> knee_tracking
  const shoulderMidYs = frames.map(
    (f) => (f.kpts.l_shoulder[1] + f.kpts.r_shoulder[1]) / 2
  );
  const shoulderLrDeltas = frames.map(
    (f) => Math.abs(f.kpts.l_shoulder[1] - f.kpts.r_shoulder[1])
  );
  const shoulderVariance = variance(shoulderMidYs);
  const maxShoulderLrDelta = Math.max(...shoulderLrDeltas);
  let shoulderSeverity: Severity = 'low';
  if (
    shoulderVariance > PUSHUP_SHOULDER_VARIANCE_THRESHOLD * 2 ||
    maxShoulderLrDelta > 0.06
  )
    shoulderSeverity = 'high';
  else if (
    shoulderVariance > PUSHUP_SHOULDER_VARIANCE_THRESHOLD ||
    maxShoulderLrDelta > 0.04
  )
    shoulderSeverity = 'moderate';
  const kneeTrackingEvidence: RepCheckEvidence = {
    shoulder_y_variance: Math.round(shoulderVariance * 1000) / 1000,
    shoulder_lr_max_diff: Math.round(maxShoulderLrDelta * 100) / 100,
  };

  // Hip stability (constant hip level) -> heel_lift
  const hipMidYs = frames.map(
    (f) => (f.kpts.l_hip[1] + f.kpts.r_hip[1]) / 2
  );
  const hipVariance = variance(hipMidYs);
  let hipSeverity: Severity = 'low';
  if (hipVariance > PUSHUP_HIP_VARIANCE_THRESHOLD * 2) hipSeverity = 'high';
  else if (hipVariance > PUSHUP_HIP_VARIANCE_THRESHOLD) hipSeverity = 'moderate';
  const heelLiftEvidence: RepCheckEvidence = {
    hip_y_variance: Math.round(hipVariance * 1000) / 1000,
  };

  // Body alignment (plank: shoulder-hip line vs horizontal) -> torso_angle
  const dx = (k.l_hip[0] + k.r_hip[0]) / 2 - (k.l_shoulder[0] + k.r_shoulder[0]) / 2;
  const dy = hipMidY - shoulderMidY;
  const torsoTiltDeg =
    (Math.atan2(Math.abs(dy), Math.abs(dx) || 1e-6) * 180) / Math.PI;
  let torsoSeverity: Severity = 'low';
  if (torsoTiltDeg > PUSHUP_TORSO_TILT_THRESHOLD_DEG * 2) torsoSeverity = 'high';
  else if (torsoTiltDeg > PUSHUP_TORSO_TILT_THRESHOLD_DEG)
    torsoSeverity = 'moderate';
  const torsoEvidence: RepCheckEvidence = {
    torso_tilt_deg: Math.round(torsoTiltDeg * 10) / 10,
  };

  // Asymmetry: L-R shoulder height and elbow angle
  const shoulderHeightDiff = Math.abs(k.l_shoulder[1] - k.r_shoulder[1]);
  const elbowAngleDiff = Math.abs(elbowAngleL - elbowAngleR);
  let asymSeverity: Severity = 'low';
  if (
    shoulderHeightDiff > PUSHUP_ASYMMETRY_SHOULDER_THRESHOLD * 2 ||
    elbowAngleDiff > PUSHUP_ASYMMETRY_ELBOW_THRESHOLD * 2
  )
    asymSeverity = 'high';
  else if (
    shoulderHeightDiff > PUSHUP_ASYMMETRY_SHOULDER_THRESHOLD ||
    elbowAngleDiff > PUSHUP_ASYMMETRY_ELBOW_THRESHOLD
  )
    asymSeverity = 'moderate';
  const asymEvidence: RepCheckEvidence = {
    shoulder_height_diff: Math.round(shoulderHeightDiff * 100) / 100,
    elbow_angle_diff: Math.round(elbowAngleDiff * 10) / 10,
  };

  return {
    depth: {
      severity: depthSeverity,
      status: severityToStatus(depthSeverity),
      evidence: depthEvidence,
      cue:
        depthSeverity !== 'low'
          ? 'Lower chest toward the floor; aim for elbows around 90° at bottom.'
          : undefined,
    },
    knee_tracking: {
      severity: shoulderSeverity,
      status: severityToStatus(shoulderSeverity),
      evidence: kneeTrackingEvidence,
      cue:
        shoulderSeverity !== 'low'
          ? 'Keep shoulders level and stable throughout the rep; avoid rolling.'
          : undefined,
    },
    torso_angle: {
      severity: torsoSeverity,
      status: severityToStatus(torsoSeverity),
      evidence: torsoEvidence,
      cue:
        torsoSeverity !== 'low'
          ? 'Maintain a straight line from shoulders to hips; avoid sagging or piking.'
          : undefined,
    },
    heel_lift: {
      severity: hipSeverity,
      status: severityToStatus(hipSeverity),
      evidence: heelLiftEvidence,
      cue:
        hipSeverity !== 'low'
          ? 'Keep hips stable; avoid letting them sag or lift during the rep.'
          : undefined,
    },
    asymmetry: {
      severity: asymSeverity,
      status: severityToStatus(asymSeverity),
      evidence: asymEvidence,
      cue:
        asymSeverity !== 'low'
          ? 'Even out shoulder height and elbow bend left vs right.'
          : undefined,
    },
  };
}

/** Rolling live checks for pushups (e.g. last N frames). */
export function computePushupLiveChecks(
  recentFrames: SmoothedState[]
): {
  depth: RepCheckResult;
  knee_tracking: RepCheckResult;
  torso_angle: RepCheckResult;
  heel_lift: RepCheckResult;
  asymmetry: RepCheckResult;
} {
  if (recentFrames.length < 3) {
    const empty: RepCheckResult = {
      severity: 'low',
      status: 'ok',
      evidence: {},
    };
    return {
      depth: empty,
      knee_tracking: empty,
      torso_angle: empty,
      heel_lift: empty,
      asymmetry: empty,
    };
  }
  const mid = Math.floor(recentFrames.length / 2);
  const topY = Math.min(
    ...recentFrames.slice(0, 3).map(
      (f) => (f.kpts.l_shoulder[1] + f.kpts.r_shoulder[1]) / 2
    )
  );
  const bottomY = Math.max(
    ...recentFrames.map(
      (f) => (f.kpts.l_shoulder[1] + f.kpts.r_shoulder[1]) / 2
    )
  );
  return computePushupFormChecks(recentFrames, mid, topY, bottomY);
}
