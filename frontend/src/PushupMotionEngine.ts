/**
 * Pushup motion analysis: same pipeline as squat but with pushup rep detection
 * and pushup form checks. Produces RepSummary with the same JSON shape for the coach API.
 */

import { createSmoother } from './smoothing';
import type { SmoothedState } from './smoothing';
import { createPushupRepDetector } from './pushupRepDetection';
import {
  computePushupFormChecks,
  computePushupLiveChecks,
} from './pushupFormChecks';
import type { RepSummary } from './types';
import type { RepCheckResult } from './types';

const LIVE_WINDOW_FRAMES = 15;

export function createPushupMotionEngine() {
  const smooth = createSmoother();
  const repDetector = createPushupRepDetector();
  const smoothedFrames: SmoothedState[] = [];
  const maxFrames = 300;
  let repIndex = 0;

  function processFrame(
    kpts: SmoothedState['kpts'],
    conf: number,
    kpts3d?: SmoothedState['kpts3d'] | null
  ): {
    state: SmoothedState;
    repComplete: RepSummary | null;
    liveChecks: {
      depth: RepCheckResult;
      knee_tracking: RepCheckResult;
      torso_angle: RepCheckResult;
      heel_lift: RepCheckResult;
      asymmetry: RepCheckResult;
    };
  } {
    const state = smooth(kpts, conf, kpts3d);
    smoothedFrames.push(state);
    if (smoothedFrames.length > maxFrames) smoothedFrames.shift();

    const liveWindow = smoothedFrames.slice(-LIVE_WINDOW_FRAMES);
    const liveChecks = computePushupLiveChecks(liveWindow);

    const repWindow = repDetector.addFrame(state);
    if (!repWindow) return { state, repComplete: null, liveChecks };

    const startFrame = repWindow.start_frame;
    const bottomFrame = repWindow.bottom_frame;
    const endFrame = repWindow.end_frame;
    const repFrames = smoothedFrames.filter(
      (f) => f.frameIndex >= startFrame && f.frameIndex <= endFrame
    );
    const bottomIdx = repFrames.findIndex((f) => f.frameIndex === bottomFrame);
    if (bottomIdx < 0 || repFrames.length < 3) {
      return { state, repComplete: null, liveChecks };
    }

    const topShoulderY = Math.min(
      ...repFrames.slice(0, 5).map(
        (f) => (f.kpts.l_shoulder[1] + f.kpts.r_shoulder[1]) / 2
      )
    );
    const bottomShoulderY =
      (repFrames[bottomIdx].kpts.l_shoulder[1] +
        repFrames[bottomIdx].kpts.r_shoulder[1]) /
      2;

    const checks = computePushupFormChecks(
      repFrames,
      bottomIdx,
      topShoulderY,
      bottomShoulderY
    );

    const poseAvg =
      repFrames.reduce((a, f) => a + f.conf, 0) / repFrames.length;
    const warnings: string[] = [];
    if (poseAvg < 0.6) warnings.push('Low pose confidence during rep');

    const repSummary: RepSummary = {
      rep_index: repIndex,
      start_frame: startFrame,
      bottom_frame: bottomFrame,
      end_frame: endFrame,
      rep_confidence: repWindow.rep_confidence,
      confidence: { pose_avg: poseAvg, warnings },
      checks,
      depth_score: repWindow.depth_score,
      stability_score: repWindow.stability_score,
      asymmetry_score: repWindow.asymmetry_score,
      min_knee_angle: repWindow.min_elbow_angle,
    };
    repIndex += 1;

    return { state, repComplete: repSummary, liveChecks };
  }

  return {
    processFrame(
      kpts: SmoothedState['kpts'],
      conf: number,
      kpts3d?: SmoothedState['kpts3d'] | null
    ): {
      state: SmoothedState;
      repComplete: RepSummary | null;
      liveChecks: ReturnType<typeof computePushupLiveChecks>;
    } {
      return processFrame(kpts, conf, kpts3d);
    },
    reset(): void {
      repDetector.reset();
      smoothedFrames.length = 0;
      repIndex = 0;
    },
  };
}
