/**
 * Squat rep detector: descending/ascending and bottom from hip level (hipMidY).
 * Knee angle is tracked during the rep and required to validate a real squat.
 */

import type { SmoothedState } from './smoothing';
import { REP_MIN_FRAMES, REP_MAX_FRAMES, TARGET_FPS } from './constants';

const DEBUG_LOG_INTERVAL = 30;

export interface RepWindow {
  start_frame: number;
  bottom_frame: number;
  end_frame: number;
  rep_confidence: number;
  depth_score: number;
  stability_score: number;
  asymmetry_score: number;
}

/** Hip Y: minimum drop from start to bottom (normalized) to commit to rep */
const MIN_HIP_DROP = 0.03;
/** Hip Y: minimum rise from bottom to consider rep complete (normalized) */
const MIN_HIP_RISE = 0.03;
/** Hip velocity window (frames) for smoothing */
const HIP_VELOCITY_WINDOW = 5;
/** Hip velocity threshold: Y per frame to detect descent/ascent */
const HIP_VELOCITY_THRESHOLD = 0.0015;
/** Minimum knee flexion (degrees bent from straight) to count as a valid squat: maxKneeAngle >= this */
const MIN_KNEE_FLEXION = 70;
/** Minimum time for a rep (seconds) */
const MIN_REP_DURATION_SEC = 0.55;
/** Maximum time for a rep (seconds) */
const MAX_REP_DURATION_SEC = 5.0;
/** Cooldown frames after counting */
const COOLDOWN_FRAMES = 12;
/** Frames to wait at bottom before allowing ascent transition */
const BOTTOM_SETTLE_FRAMES = 6;
/** Maximum asymmetry allowed (degrees) */
const MAX_ASYMMETRY_WARN = 15;

type Phase = 'waiting' | 'descending' | 'ascending';

interface FrameData {
  frameIndex: number;
  hipMidY: number;
  kneeAngleLeft: number;
  kneeAngleRight: number;
  kneeAngleAvg: number;
  conf: number;
}

export function createRepDetector() {
  const history: FrameData[] = [];
  const hipVelocities: number[] = [];
  const maxHistory = 150;

  let phase: Phase = 'waiting';
  let startFrame = 0;
  let startHipY = 0;
  let bottomFrame = 0;
  let bottomHipY = 0;
  let maxKneeAngle = 0;
  let committed = false;
  let lastCountedAtFrame = 0;

  /** Knee angle from 2D keypoints (fallback when 3D unavailable). */
  function calculateKneeAngle2D(
    hip: [number, number],
    knee: [number, number],
    ankle: [number, number]
  ): number {
    const hipKnee = { x: knee[0] - hip[0], y: knee[1] - hip[1] };
    const kneeAnkle = { x: ankle[0] - knee[0], y: ankle[1] - knee[1] };
    const dot = hipKnee.x * kneeAnkle.x + hipKnee.y * kneeAnkle.y;
    const mag1 = Math.sqrt(hipKnee.x ** 2 + hipKnee.y ** 2);
    const mag2 = Math.sqrt(kneeAnkle.x ** 2 + kneeAnkle.y ** 2);
    if (mag1 === 0 || mag2 === 0) return 180;
    const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  /**
   * Knee angle from MediaPipe 3D world landmarks (meters).
   * Uses the 3D vectors hip→knee and knee→ankle; angle is invariant to camera angle.
   */
  function calculateKneeAngle3D(
    hip: [number, number, number],
    knee: [number, number, number],
    ankle: [number, number, number]
  ): number {
    const hipKnee = [
      knee[0] - hip[0],
      knee[1] - hip[1],
      knee[2] - hip[2],
    ];
    const kneeAnkle = [
      ankle[0] - knee[0],
      ankle[1] - knee[1],
      ankle[2] - knee[2],
    ];
    const dot =
      hipKnee[0] * kneeAnkle[0] +
      hipKnee[1] * kneeAnkle[1] +
      hipKnee[2] * kneeAnkle[2];
    const mag1 = Math.sqrt(
      hipKnee[0] ** 2 + hipKnee[1] ** 2 + hipKnee[2] ** 2
    );
    const mag2 = Math.sqrt(
      kneeAnkle[0] ** 2 + kneeAnkle[1] ** 2 + kneeAnkle[2] ** 2
    );
    if (mag1 === 0 || mag2 === 0) return 180;
    const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosAngle) * (180 / Math.PI);
  }

  function calculateDepthScore(maxAngle: number): number {
    // Score based on how deep the squat was
    // 90° = perfect, 120° = shallow, 60° = very deep
    if (maxAngle >= 90) return 1.0;
    if (maxAngle <= 140) return 0.3;
    return 1.0 - (maxAngle - 90) / 100;
  }

  function calculateStabilityScore(
    frames: FrameData[],
    start: number,
    end: number
  ): number {
    const repFrames = frames.filter(
      (f) => f.frameIndex >= start && f.frameIndex <= end
    );
    if (repFrames.length === 0) return 0.5;
    
    // Measure variance in movement path (using hip Y)
    const yValues = repFrames.map((f) => f.hipMidY);
    const mean = yValues.reduce((a, b) => a + b, 0) / yValues.length;
    const variance = yValues.reduce((a, y) => a + (y - mean) ** 2, 0) / yValues.length;
    const stability = Math.max(0, 1 - variance * 10);
    
    return stability;
  }

  function calculateAsymmetryScore(frames: FrameData[]): number {
    const asymmetries = frames.map((f) =>
      Math.abs(f.kneeAngleLeft - f.kneeAngleRight)
    );
    const avgAsymmetry = asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length;
    
    // Convert to 0-1 score (0° asymmetry = 1.0, 45°+ = 0.0)
    return Math.max(0, 1 - avgAsymmetry / 45);
  }

  function addFrame(state: SmoothedState): RepWindow | null {
    const kpts3d = state.kpts3d;
    const kneeAngleLeft = kpts3d
      ? calculateKneeAngle3D(kpts3d.l_hip, kpts3d.l_knee, kpts3d.l_ankle)
      : calculateKneeAngle2D(
          state.kpts.l_hip,
          state.kpts.l_knee,
          state.kpts.l_ankle
        );
    const kneeAngleRight = kpts3d
      ? calculateKneeAngle3D(kpts3d.r_hip, kpts3d.r_knee, kpts3d.r_ankle)
      : calculateKneeAngle2D(
          state.kpts.r_hip,
          state.kpts.r_knee,
          state.kpts.r_ankle
        );
    const kneeAngleAvg = (kneeAngleLeft + kneeAngleRight) / 2;
    
    const frameData: FrameData = {
      frameIndex: state.frameIndex,
      hipMidY: state.hipMidY,
      kneeAngleLeft,
      kneeAngleRight,
      kneeAngleAvg,
      conf: state.conf,
    };
    
    history.push(frameData);
    if (history.length > maxHistory) history.shift();

    const hipY = frameData.hipMidY;
    // Hip Y velocity: positive = hip moving down (descending), negative = hip moving up (ascending)
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const hipVelocity = hipY - prev.hipMidY;
      hipVelocities.push(hipVelocity);
      if (hipVelocities.length > HIP_VELOCITY_WINDOW) hipVelocities.shift();
    }
    const avgHipVelocity = hipVelocities.length > 0
      ? hipVelocities.reduce((a, b) => a + b, 0) / hipVelocities.length
      : 0;
    const angle = kneeAngleAvg;
    const asymmetry = Math.abs(kneeAngleLeft - kneeAngleRight);

    // Debug logging
    if (state.frameIndex <= 3 || state.frameIndex % DEBUG_LOG_INTERVAL === 0) {
      console.log(
        '[rep] frame', state.frameIndex,
        'phase', phase,
        'hipY', hipY.toFixed(3),
        'hipVel', avgHipVelocity.toFixed(4),
        'kneeAngle', angle.toFixed(1) + '°',
        'maxAngle', maxKneeAngle.toFixed(1) + '°',
        'framesSinceBottom', state.frameIndex - bottomFrame,
        'asymmetry', asymmetry.toFixed(1) + '°'
      );
    }

    if (history.length < REP_MIN_FRAMES) return null;

    // Warn about asymmetry
    if (asymmetry > MAX_ASYMMETRY_WARN && state.frameIndex % 60 === 0) {
      console.warn('[rep] ⚠️ High asymmetry:', asymmetry.toFixed(1), '°');
    }

    // State machine: phases driven by hip level; knee angle used only for squat validation
    switch (phase) {
      case 'waiting': {
        if (state.frameIndex - lastCountedAtFrame < COOLDOWN_FRAMES) return null;
        // Start descent when hip is moving down (positive hip Y velocity)
        if (avgHipVelocity > HIP_VELOCITY_THRESHOLD) {
          phase = 'descending';
          startFrame = state.frameIndex;
          startHipY = hipY;
          maxKneeAngle = angle;
          bottomFrame = state.frameIndex;
          bottomHipY = hipY;
          committed = false;
          console.log('[rep] ⬇️ START descent at frame', startFrame, 'hipY=', hipY.toFixed(3), 'knee=', angle.toFixed(1) + '°');
        }
        break;
      }

      case 'descending': {
        // Bottom = frame where hip Y is highest (lowest body position)
        if (hipY > bottomHipY) {
          bottomHipY = hipY;
          bottomFrame = state.frameIndex;
        }
        // Track min knee angle for squat validation
        if (angle > maxKneeAngle) maxKneeAngle = angle;

        // Commit when hip has dropped enough
        const hipDrop = hipY - startHipY;
        if (!committed && hipDrop >= MIN_HIP_DROP) {
          committed = true;
          console.log('[rep] ✓ COMMITTED at frame', state.frameIndex, 'hipDrop=', hipDrop.toFixed(3));
        }

        const framesSinceBottom = state.frameIndex - bottomFrame;
        const settledAtBottom = framesSinceBottom >= BOTTOM_SETTLE_FRAMES;
        // Start ascent when hip is moving up (negative velocity) and we've settled at bottom
        if (avgHipVelocity < -HIP_VELOCITY_THRESHOLD && settledAtBottom) {
          phase = 'ascending';
          console.log('[rep] ⬆️ START ascent at frame', state.frameIndex, 'bottomHipY=', bottomHipY.toFixed(3), 'maxKneeAngle=', maxKneeAngle.toFixed(1) + '°');
        }

        if (state.frameIndex - startFrame > REP_MAX_FRAMES) {
          console.warn('[rep] ⏱️ TIMEOUT during descent');
          phase = 'waiting';
          committed = false;
        }
        break;
      }

      case 'ascending': {
        // If hip goes lower than previous bottom, treat as deeper descent
        if (hipY > bottomHipY) {
          bottomHipY = hipY;
          bottomFrame = state.frameIndex;
          if (angle > maxKneeAngle) maxKneeAngle = angle;
          phase = 'descending';
          console.log('[rep] 🔄 DEEPER motion, back to descending');
          break;
        }
        if (angle > maxKneeAngle) maxKneeAngle = angle;

        // Rep complete when hip has risen enough from bottom (normalized Y decreased)
        const hipRise = bottomHipY - hipY;

        if (hipRise >= MIN_HIP_RISE) {
          const repLength = state.frameIndex - startFrame;
          const repDurationSec = repLength / TARGET_FPS;
          const descendDuration = bottomFrame - startFrame;
          const ascendDuration = state.frameIndex - bottomFrame;

          console.log('[rep] 🎯 Validating rep:', {
            totalFrames: repLength,
            hipRise: hipRise.toFixed(3),
            maxKneeAngle: maxKneeAngle.toFixed(1) + '°',
            duration: repDurationSec.toFixed(2) + 's'
          });

          if (repDurationSec < MIN_REP_DURATION_SEC) {
            console.warn('[rep] ❌ REJECTED: too fast', repDurationSec.toFixed(2), 's');
            phase = 'waiting';
            committed = false;
            return null;
          }
          if (repDurationSec > MAX_REP_DURATION_SEC) {
            console.warn('[rep] ❌ REJECTED: too slow', repDurationSec.toFixed(2), 's');
            phase = 'waiting';
            committed = false;
            return null;
          }
          if (repLength < REP_MIN_FRAMES || repLength > REP_MAX_FRAMES) {
            console.warn('[rep] ❌ REJECTED: bad frame count', repLength);
            phase = 'waiting';
            committed = false;
            return null;
          }
          // Squat validation: require at least MIN_KNEE_FLEXION (maxKneeAngle >= 25°)
          if (!committed || maxKneeAngle < MIN_KNEE_FLEXION) {
            console.warn('[rep] ❌ REJECTED: not a squat (maxKneeAngle)', maxKneeAngle.toFixed(1) + '°', '<', MIN_KNEE_FLEXION + '°');
            phase = 'waiting';
            committed = false;
            return null;
          }

          // REP COUNTED!
          lastCountedAtFrame = state.frameIndex;
          phase = 'waiting';
          committed = false;

          const repFrames = history.filter(
            (f) => f.frameIndex >= startFrame && f.frameIndex <= state.frameIndex
          );
          const confAvg = repFrames.reduce((a, f) => a + f.conf, 0) / repFrames.length;

          const result: RepWindow = {
            start_frame: startFrame,
            bottom_frame: bottomFrame,
            end_frame: state.frameIndex,
            rep_confidence: confAvg,
            depth_score: calculateDepthScore(maxKneeAngle),
            stability_score: calculateStabilityScore(history, startFrame, state.frameIndex),
            asymmetry_score: calculateAsymmetryScore(repFrames),
          };

          console.warn('[rep] ✅ REP COUNTED', {
            totalFrames: repLength,
            descendFrames: descendDuration,
            ascendFrames: ascendDuration,
            duration: repDurationSec.toFixed(2) + 's',
            maxKneeAngle: maxKneeAngle.toFixed(1) + '°',
            hipRise: hipRise.toFixed(3),
            depthScore: result.depth_score.toFixed(2),
            stabilityScore: result.stability_score.toFixed(2),
            asymmetryScore: result.asymmetry_score.toFixed(2),
          });

          return result;
        }

        // Timeout during ascent
        if (state.frameIndex - bottomFrame > REP_MAX_FRAMES) {
          console.warn('[rep] ⏱️ TIMEOUT during ascent');
          phase = 'waiting';
          committed = false;
        }
        break;
      }
    }

    return null;
  }

  function reset(): void {
    history.length = 0;
    hipVelocities.length = 0;
    phase = 'waiting';
    startFrame = 0;
    startHipY = 0;
    bottomFrame = 0;
    bottomHipY = 0;
    maxKneeAngle = 0;
    committed = false;
    lastCountedAtFrame = 0;
  }

  return { addFrame, reset };
}