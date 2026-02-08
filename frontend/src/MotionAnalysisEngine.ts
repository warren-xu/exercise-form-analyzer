/**
 * Motion analysis: smoothing + rep detection + form checks.
 * Holds rolling smoothed frames and produces rep summaries with checks.
 */

import { createSmoother } from './smoothing';
import type { SmoothedState } from './smoothing';
import { createRepDetector } from './repDetection';
import { computeFormChecks, computeLiveChecks } from './formChecks';
import type { RepSummary } from './types';
import type { RepCheckResult } from './types';
const LIVE_WINDOW_FRAMES = 15; // ~0.75 s at 20 fps

export function createMotionAnalysisEngine() {
  const smooth = createSmoother();
  const repDetector = createRepDetector();
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
    const liveChecks = computeLiveChecks(liveWindow);

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
      console.warn('[rep] motion engine dropped rep: missing frames', { startFrame, bottomFrame, endFrame, repFramesLen: repFrames.length, bottomIdx });
      return { state, repComplete: null, liveChecks };
    }

    const topY = Math.min(
      ...repFrames.slice(0, 5).map((f) => (f.kpts.l_hip[1] + f.kpts.r_hip[1]) / 2)
    );
    const bottomY = repFrames[bottomIdx].hipMidY;

    const checks = computeFormChecks(repFrames, bottomIdx, topY, bottomY);

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
      ...(repWindow.depth_score !== undefined && { depth_score: repWindow.depth_score }),
      ...(repWindow.stability_score !== undefined && { stability_score: repWindow.stability_score }),
      ...(repWindow.rep_duration_sec !== undefined && { rep_duration_sec: repWindow.rep_duration_sec }),
    };
    repIndex += 1;

    return { state, repComplete: repSummary, liveChecks };
  }

  return {
    processFrame(
      kpts: SmoothedState['kpts'],
      conf: number,
      kpts3d?: SmoothedState['kpts3d'] | null
    ): { state: SmoothedState; repComplete: RepSummary | null; liveChecks: ReturnType<typeof computeLiveChecks> } {
      return processFrame(kpts, conf, kpts3d);
    },
    reset(): void {
      repDetector.reset();
      smoothedFrames.length = 0;
      repIndex = 0;
    },
  };
}
