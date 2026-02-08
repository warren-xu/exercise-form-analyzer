/**
 * Internal frame payload and analysis types (§11.1, §11.2).
 */

export type Severity = 'low' | 'moderate' | 'high';
export type CheckStatus = 'ok' | 'watch' | 'flag';

export interface Keypoints {
  l_hip: [number, number];
  r_hip: [number, number];
  l_knee: [number, number];
  r_knee: [number, number];
  l_ankle: [number, number];
  r_ankle: [number, number];
  l_shoulder: [number, number];
  r_shoulder: [number, number];
}

/** 3D keypoints (MediaPipe world landmarks: x, y, z in meters). */
export interface Keypoints3D {
  l_hip: [number, number, number];
  r_hip: [number, number, number];
  l_knee: [number, number, number];
  r_knee: [number, number, number];
  l_ankle: [number, number, number];
  r_ankle: [number, number, number];
  l_shoulder: [number, number, number];
  r_shoulder: [number, number, number];
}

export interface FramePayload {
  t: number;
  kpts: Keypoints;
  conf: number;
}

export interface RepCheckEvidence {
  [key: string]: number | undefined;
}

export interface RepCheckResult {
  severity: Severity;
  status: CheckStatus;
  evidence: RepCheckEvidence;
  cue?: string;
}

export interface RepSummary {
  rep_index: number;
  start_frame: number;
  bottom_frame: number;
  end_frame: number;
  rep_confidence: number;
  confidence: { pose_avg: number; warnings: string[] };
  checks: {
    depth: RepCheckResult;
    knee_tracking: RepCheckResult;
    torso_angle: RepCheckResult;
    heel_lift: RepCheckResult;
    asymmetry: RepCheckResult;
  };
  /** From rep detector: depth (0–1), stability (0–1), asymmetry (0–1), min knee angle (degrees). */
  depth_score?: number;
  stability_score?: number;
  asymmetry_score?: number;
  min_knee_angle?: number;
}

export interface AssistantOutput {
  summary: string;
  cues: string[];
  safety_note: string;
  confidence_note?: string;
}

export type AppPhase =
  | 'Ready'
  | 'Calibrate'
  | 'Live'
  | 'RepComplete'
  | 'SetSummary';
