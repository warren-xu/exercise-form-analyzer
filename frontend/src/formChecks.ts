/**
 * Squat form checks: depth, knee tracking, torso, heel lift, asymmetry.
 * Computes severity + evidence from rep window (bottom frame + context).
 */

import type { SmoothedState } from './smoothing';
import type { RepCheckResult, RepCheckEvidence, Severity, CheckStatus } from './types';
import {
  HIP_DROP_DEEP_THRESHOLD,
  VALGUS_THRESHOLD_NORM,
  TORSO_LEAN_THRESHOLD_DEG,
  ANKLE_RISE_THRESHOLD,
  ASYMMETRY_HIP_DIFF_THRESHOLD,
  ASYMMETRY_KNEE_ANGLE_DIFF_THRESHOLD,
} from './constants';

function severityToStatus(s: Severity): CheckStatus {
  if (s === 'high') return 'flag';
  if (s === 'moderate') return 'watch';
  return 'ok';
}

function angleDeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const ba = { x: ax - bx, y: ay - by };
  const bc = { x: cx - bx, y: cy - by };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const mag = Math.sqrt(ba.x * ba.x + ba.y * ba.y) * Math.sqrt(bc.x * bc.x + bc.y * bc.y) || 1e-6;
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function computeFormChecks(
  frames: SmoothedState[],
  bottomIndex: number,
  topY: number,
  bottomY: number
): {
  depth: RepCheckResult;
  knee_tracking: RepCheckResult;
  torso_angle: RepCheckResult;
  heel_lift: RepCheckResult;
  asymmetry: RepCheckResult;
} {
  const b = frames[bottomIndex];
  if (!b) {
    const empty: RepCheckResult = { severity: 'low', status: 'ok', evidence: {} };
    return {
      depth: empty,
      knee_tracking: empty,
      torso_angle: empty,
      heel_lift: empty,
      asymmetry: empty,
    };
  }

  const k = b.kpts;
  const hipMidX = (k.l_hip[0] + k.r_hip[0]) / 2;
  const hipMidY = (k.l_hip[1] + k.r_hip[1]) / 2;
  const shoulderMidX = (k.l_shoulder[0] + k.r_shoulder[0]) / 2;
  const shoulderMidY = (k.l_shoulder[1] + k.r_shoulder[1]) / 2;
  const ankleBaselineY = Math.max(k.l_ankle[1], k.r_ankle[1]);
  const bodyHeight = Math.abs(ankleBaselineY - shoulderMidY) || 0.01;

  // Hip drop: how much the hip moved down (bottom has larger Y in normalized coords)
  const hipDropNorm = (bottomY - topY) / bodyHeight;
  const bottomKneeAngleL = angleDeg(
    k.l_hip[0], k.l_hip[1],
    k.l_knee[0], k.l_knee[1],
    k.l_ankle[0], k.l_ankle[1]
  );
  const bottomKneeAngleR = angleDeg(
    k.r_hip[0], k.r_hip[1],
    k.r_knee[0], k.r_knee[1],
    k.r_ankle[0], k.r_ankle[1]
  );

  let depthSeverity: Severity = 'low';
  if (hipDropNorm < HIP_DROP_DEEP_THRESHOLD * 0.7) depthSeverity = 'high';
  else if (hipDropNorm < HIP_DROP_DEEP_THRESHOLD) depthSeverity = 'moderate';
  const depthEvidence: RepCheckEvidence = {
    hip_drop_norm: Math.round(hipDropNorm * 100) / 100,
    bottom_knee_angle_deg_L: Math.round(bottomKneeAngleL * 10) / 10,
    bottom_knee_angle_deg_R: Math.round(bottomKneeAngleR * 10) / 10,
  };

  const kneeInwardL = (k.l_ankle[0] - k.l_knee[0]);
  const kneeInwardR = (k.r_knee[0] - k.r_ankle[0]);
  const kneeInwardDispL = kneeInwardL / bodyHeight;
  const kneeInwardDispR = kneeInwardR / bodyHeight;
  let valgusPct = 0;
  for (let i = Math.max(0, bottomIndex - 5); i <= Math.min(frames.length - 1, bottomIndex + 5); i++) {
    const f = frames[i].kpts;
    const kl = (f.l_ankle[0] - f.l_knee[0]) / bodyHeight;
    const kr = (f.r_knee[0] - f.r_ankle[0]) / bodyHeight;
    if (Math.abs(kl) > VALGUS_THRESHOLD_NORM || Math.abs(kr) > VALGUS_THRESHOLD_NORM) valgusPct += 1;
  }
  valgusPct = (valgusPct / 11) * 100;
  let kneeSeverity: Severity = 'low';
  if (Math.abs(kneeInwardDispL) > VALGUS_THRESHOLD_NORM * 2 || Math.abs(kneeInwardDispR) > VALGUS_THRESHOLD_NORM * 2) kneeSeverity = 'high';
  else if (valgusPct > 40 || Math.abs(kneeInwardDispL) > VALGUS_THRESHOLD_NORM || Math.abs(kneeInwardDispR) > VALGUS_THRESHOLD_NORM) kneeSeverity = 'moderate';
  const kneeEvidence: RepCheckEvidence = {
    knee_inward_disp_norm_L: Math.round(kneeInwardDispL * 100) / 100,
    knee_inward_disp_norm_R: Math.round(kneeInwardDispR * 100) / 100,
    time_in_valgus_pct: Math.round(valgusPct),
  };

  const torsoAngleRad = Math.atan2(
    shoulderMidX - hipMidX,
    hipMidY - shoulderMidY
  );
  const torsoAngleDeg = Math.abs((torsoAngleRad * 180) / Math.PI);
  const topFrame = frames[Math.max(0, bottomIndex - 30)];
  let torsoChangeDeg = 0;
  if (topFrame) {
    const th = (topFrame.kpts.l_hip[1] + topFrame.kpts.r_hip[1]) / 2;
    const sh = (topFrame.kpts.l_shoulder[1] + topFrame.kpts.r_shoulder[1]) / 2;
    const tx = (topFrame.kpts.l_hip[0] + topFrame.kpts.r_hip[0]) / 2;
    const sx = (topFrame.kpts.l_shoulder[0] + topFrame.kpts.r_shoulder[0]) / 2;
    const topAngle = Math.atan2(sx - tx, th - sh) * (180 / Math.PI);
    torsoChangeDeg = Math.abs(torsoAngleDeg - Math.abs(topAngle));
  }
  let torsoSeverity: Severity = 'low';
  if (torsoAngleDeg > TORSO_LEAN_THRESHOLD_DEG * 1.2) torsoSeverity = 'high';
  else if (torsoAngleDeg > TORSO_LEAN_THRESHOLD_DEG) torsoSeverity = 'moderate';
  const torsoEvidence: RepCheckEvidence = {
    torso_angle_deg_bottom: Math.round(torsoAngleDeg * 10) / 10,
    torso_angle_change_deg: Math.round(torsoChangeDeg * 10) / 10,
  };

  const ankleRiseL = (k.l_ankle[1] - ankleBaselineY) / bodyHeight;
  const ankleRiseR = (k.r_ankle[1] - ankleBaselineY) / bodyHeight;
  let heelSeverity: Severity = 'low';
  if (ankleRiseL > ANKLE_RISE_THRESHOLD * 2 || ankleRiseR > ANKLE_RISE_THRESHOLD * 2) heelSeverity = 'high';
  else if (ankleRiseL > ANKLE_RISE_THRESHOLD || ankleRiseR > ANKLE_RISE_THRESHOLD) heelSeverity = 'moderate';
  const heelEvidence: RepCheckEvidence = {
    ankle_rise_norm_L: Math.round(ankleRiseL * 100) / 100,
    ankle_rise_norm_R: Math.round(ankleRiseR * 100) / 100,
  };

  const hipDepthDiff = Math.abs(k.l_hip[1] - k.r_hip[1]) / bodyHeight;
  const kneeAngleDiff = Math.abs(bottomKneeAngleL - bottomKneeAngleR);
  const hipLineSlope = Math.atan2(k.r_hip[1] - k.l_hip[1], k.r_hip[0] - k.l_hip[0]) * (180 / Math.PI);
  const pelvisTiltDeg = Math.abs(hipLineSlope);
  let asymSeverity: Severity = 'low';
  if (hipDepthDiff > ASYMMETRY_HIP_DIFF_THRESHOLD * 2 || kneeAngleDiff > ASYMMETRY_KNEE_ANGLE_DIFF_THRESHOLD * 2) asymSeverity = 'high';
  else if (hipDepthDiff > ASYMMETRY_HIP_DIFF_THRESHOLD || kneeAngleDiff > ASYMMETRY_KNEE_ANGLE_DIFF_THRESHOLD) asymSeverity = 'moderate';
  const asymEvidence: RepCheckEvidence = {
    hip_depth_diff_norm: Math.round(hipDepthDiff * 100) / 100,
    knee_angle_diff_deg: Math.round(kneeAngleDiff * 10) / 10,
    pelvis_tilt_deg: Math.round(pelvisTiltDeg * 10) / 10,
  };

  return {
    depth: { severity: depthSeverity, status: severityToStatus(depthSeverity), evidence: depthEvidence, cue: depthSeverity !== 'low' ? 'Aim for hip crease below knee; control depth.' : undefined },
    knee_tracking: { severity: kneeSeverity, status: severityToStatus(kneeSeverity), evidence: kneeEvidence, cue: kneeSeverity !== 'low' ? 'Push knees out over toes; spread the floor.' : undefined },
    torso_angle: { severity: torsoSeverity, status: severityToStatus(torsoSeverity), evidence: torsoEvidence, cue: torsoSeverity !== 'low' ? 'Brace core; keep chest proud; avoid excess forward lean.' : undefined },
    heel_lift: { severity: heelSeverity, status: severityToStatus(heelSeverity), evidence: heelEvidence, cue: heelSeverity !== 'low' ? 'Keep weight mid-foot to heel; avoid rising onto toes.' : undefined },
    asymmetry: { severity: asymSeverity, status: severityToStatus(asymSeverity), evidence: asymEvidence, cue: asymSeverity !== 'low' ? 'Even out depth and knee bend left vs right.' : undefined },
  };
}

/** Rolling-window live checks (last ~0.5–1 s). No rep boundary; uses current + recent frames. */
export function computeLiveChecks(recentFrames: SmoothedState[]): {
  depth: RepCheckResult;
  knee_tracking: RepCheckResult;
  torso_angle: RepCheckResult;
  heel_lift: RepCheckResult;
  asymmetry: RepCheckResult;
} {
  const empty: RepCheckResult = { severity: 'low', status: 'ok', evidence: {} };
  if (!recentFrames.length) {
    return { depth: empty, knee_tracking: empty, torso_angle: empty, heel_lift: empty, asymmetry: empty };
  }
  const topY = Math.min(...recentFrames.map((f) => (f.kpts.l_hip[1] + f.kpts.r_hip[1]) / 2));
  const bottomY = Math.max(...recentFrames.map((f) => (f.kpts.l_hip[1] + f.kpts.r_hip[1]) / 2));
  const bottomIdx = recentFrames.length - 1;
  return computeFormChecks(recentFrames, bottomIdx, topY, bottomY);
}
