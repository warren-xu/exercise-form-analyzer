/**
 * Pushup rep detector: phases from shoulder level (body going down/up).
 * Elbow angle is tracked to validate a real pushup and compute depth.
 */

import type { SmoothedState } from './smoothing';
import { REP_MIN_FRAMES, REP_MAX_FRAMES, TARGET_FPS } from './constants';

export interface PushupRepWindow {
  start_frame: number;
  bottom_frame: number;
  end_frame: number;
  rep_confidence: number;
  depth_score: number;
  stability_score: number;
  asymmetry_score: number;
  min_elbow_angle: number;
  /** Rep duration in seconds (for coach feedback, not used for rejection). */
  rep_duration_sec: number;
}

const MIN_SHOULDER_DROP = 0.02;
const MIN_SHOULDER_RISE = 0.02;
const SHOULDER_VELOCITY_WINDOW = 5;
const SHOULDER_VELOCITY_THRESHOLD = 0.0012;
const MIN_ELBOW_FLEXION = 25;
const COOLDOWN_FRAMES = 12;
const BOTTOM_SETTLE_FRAMES = 5;

type Phase = 'waiting' | 'descending' | 'ascending';

interface FrameData {
  frameIndex: number;
  shoulderMidY: number;
  elbowAngleLeft: number;
  elbowAngleRight: number;
  elbowAngleAvg: number;
  conf: number;
}

function angleDeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  const bax = ax - bx;
  const bay = ay - by;
  const bcx = cx - bx;
  const bcy = cy - by;
  const dot = bax * bcx + bay * bcy;
  const mag =
    Math.sqrt(bax * bax + bay * bay) * Math.sqrt(bcx * bcx + bcy * bcy) || 1e-6;
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function createPushupRepDetector() {
  const history: FrameData[] = [];
  const shoulderVelocities: number[] = [];
  const maxHistory = 150;

  let phase: Phase = 'waiting';
  let startFrame = 0;
  let startShoulderY = 0;
  let bottomFrame = 0;
  let bottomShoulderY = 0;
  let minElbowAngle = 180;
  let committed = false;
  let lastCountedAtFrame = 0;

  function addFrame(state: SmoothedState): PushupRepWindow | null {
    const k = state.kpts;
    const shoulderMidY = (k.l_shoulder[1] + k.r_shoulder[1]) / 2;
    const elbowAngleLeft = angleDeg(
      k.l_shoulder[0],
      k.l_shoulder[1],
      k.l_elbow[0],
      k.l_elbow[1],
      k.l_wrist[0],
      k.l_wrist[1]
    );
    const elbowAngleRight = angleDeg(
      k.r_shoulder[0],
      k.r_shoulder[1],
      k.r_elbow[0],
      k.r_elbow[1],
      k.r_wrist[0],
      k.r_wrist[1]
    );
    const elbowAngleAvg = (elbowAngleLeft + elbowAngleRight) / 2;

    const frameData: FrameData = {
      frameIndex: state.frameIndex,
      shoulderMidY,
      elbowAngleLeft,
      elbowAngleRight,
      elbowAngleAvg,
      conf: state.conf,
    };
    history.push(frameData);
    if (history.length > maxHistory) history.shift();

    if (history.length >= 2) {
      const prev = history[history.length - 2];
      shoulderVelocities.push(shoulderMidY - prev.shoulderMidY);
      if (shoulderVelocities.length > SHOULDER_VELOCITY_WINDOW)
        shoulderVelocities.shift();
    }
    const avgShoulderVelocity =
      shoulderVelocities.length > 0
        ? average(shoulderVelocities)
        : 0;

    if (history.length < REP_MIN_FRAMES) return null;

    switch (phase) {
      case 'waiting': {
        if (state.frameIndex - lastCountedAtFrame < COOLDOWN_FRAMES)
          return null;
        if (avgShoulderVelocity > SHOULDER_VELOCITY_THRESHOLD) {
          phase = 'descending';
          startFrame = state.frameIndex;
          startShoulderY = shoulderMidY;
          bottomFrame = state.frameIndex;
          bottomShoulderY = shoulderMidY;
          minElbowAngle = elbowAngleAvg;
          committed = false;
        }
        break;
      }

      case 'descending': {
        if (shoulderMidY > bottomShoulderY) {
          bottomShoulderY = shoulderMidY;
          bottomFrame = state.frameIndex;
        }
        if (elbowAngleAvg < minElbowAngle) minElbowAngle = elbowAngleAvg;

        const shoulderDrop = shoulderMidY - startShoulderY;
        if (!committed && shoulderDrop >= MIN_SHOULDER_DROP) committed = true;

        const framesSinceBottom = state.frameIndex - bottomFrame;
        const settledAtBottom = framesSinceBottom >= BOTTOM_SETTLE_FRAMES;
        if (
          avgShoulderVelocity < -SHOULDER_VELOCITY_THRESHOLD &&
          settledAtBottom
        ) {
          phase = 'ascending';
        }

        if (state.frameIndex - startFrame > REP_MAX_FRAMES) {
          phase = 'waiting';
          committed = false;
        }
        break;
      }

      case 'ascending': {
        if (shoulderMidY > bottomShoulderY) {
          bottomShoulderY = shoulderMidY;
          bottomFrame = state.frameIndex;
          if (elbowAngleAvg < minElbowAngle) minElbowAngle = elbowAngleAvg;
          phase = 'descending';
          break;
        }
        if (elbowAngleAvg < minElbowAngle) minElbowAngle = elbowAngleAvg;

        const shoulderRise = bottomShoulderY - shoulderMidY;
        const maxElbowFlexion = 180 - minElbowAngle;

        if (shoulderRise >= MIN_SHOULDER_RISE) {
          const repLength = state.frameIndex - startFrame;
          const repDurationSec = repLength / TARGET_FPS;

          if (
            repLength < REP_MIN_FRAMES ||
            repLength > REP_MAX_FRAMES
          ) {
            phase = 'waiting';
            committed = false;
            return null;
          }
          if (!committed || maxElbowFlexion < MIN_ELBOW_FLEXION) {
            phase = 'waiting';
            committed = false;
            return null;
          }

          const repFrames = history.filter(
            (f) =>
              f.frameIndex >= startFrame && f.frameIndex <= state.frameIndex
          );
          const confAvg =
            repFrames.reduce((a, f) => a + f.conf, 0) / repFrames.length;

          const depthScore =
            minElbowAngle <= 90 ? 1.0 : Math.max(0.3, 1.0 - (minElbowAngle - 90) / 80);
          const shoulderYs = repFrames.map((f) => f.shoulderMidY);
          const meanSy =
            shoulderYs.reduce((a, b) => a + b, 0) / shoulderYs.length;
          const varSy =
            shoulderYs.reduce((a, y) => a + (y - meanSy) ** 2, 0) /
            shoulderYs.length;
          const stabilityScore = Math.max(0, 1 - varSy * 15);
          const asyms = repFrames.map((f) =>
            Math.abs(f.elbowAngleLeft - f.elbowAngleRight)
          );
          const avgAsym =
            asyms.reduce((a, b) => a + b, 0) / asyms.length;
          const asymmetryScore = Math.max(0, 1 - avgAsym / 25);

          lastCountedAtFrame = state.frameIndex;
          phase = 'waiting';
          committed = false;

          return {
            start_frame: startFrame,
            bottom_frame: bottomFrame,
            end_frame: state.frameIndex,
            rep_confidence: confAvg,
            depth_score: depthScore,
            stability_score: stabilityScore,
            asymmetry_score: asymmetryScore,
            min_elbow_angle: minElbowAngle,
            rep_duration_sec: repDurationSec,
          };
        }

        if (state.frameIndex - bottomFrame > REP_MAX_FRAMES) {
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
    shoulderVelocities.length = 0;
    phase = 'waiting';
    startFrame = 0;
    startShoulderY = 0;
    bottomFrame = 0;
    bottomShoulderY = 0;
    minElbowAngle = 180;
    committed = false;
    lastCountedAtFrame = 0;
  }

  return { addFrame, reset };
}
