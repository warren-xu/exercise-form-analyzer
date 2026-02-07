/**
 * Squat rep segmentation: hip midpoint vertical trajectory → top → bottom → top.
 */

import type { SmoothedState } from './smoothing';
import { REP_MIN_FRAMES, REP_MAX_FRAMES } from './constants';

export interface RepWindow {
  start_frame: number;
  bottom_frame: number;
  end_frame: number;
  rep_confidence: number;
}

const MIN_PEAK_PROMINENCE = 0.02;

export function createRepDetector() {
  const history: { frameIndex: number; hipMidY: number; conf: number }[] = [];
  const maxHistory = 200;
  let lastRepEndFrame = 0;

  function addFrame(state: SmoothedState): RepWindow | null {
    history.push({
      frameIndex: state.frameIndex,
      hipMidY: state.hipMidY,
      conf: state.conf,
    });
    if (history.length > maxHistory) history.shift();

    const n = history.length;
    if (n < REP_MIN_FRAMES * 2) return null;

    const yValues = history.map((h) => h.hipMidY);
    const confAvg =
      history.reduce((a, h) => a + h.conf, 0) / history.length;

    // Normalized coords: y increases downward. Bottom of squat = max(hip Y), top = min(hip Y).
    const searchStart = Math.max(0, n - REP_MAX_FRAMES);
    let bottomIdx = searchStart;
    let maxY = yValues[searchStart];
    for (let i = searchStart + 1; i < n; i++) {
      if (yValues[i] > maxY) {
        maxY = yValues[i];
        bottomIdx = i;
      }
    }
    const topY = Math.min(...yValues.slice(searchStart, n));

    const bottomFrame = history[bottomIdx]?.frameIndex ?? 0;
    if (bottomFrame <= lastRepEndFrame) return null;

    // Start = last "top" (y near topY) before bottom; end = first "top" after bottom
    const topThreshold = topY + MIN_PEAK_PROMINENCE;
    let startIdx = bottomIdx;
    for (let i = bottomIdx - 1; i >= searchStart; i--) {
      if (yValues[i] <= topThreshold) startIdx = i;
      else break;
    }
    let endIdx = bottomIdx;
    for (let i = bottomIdx + 1; i < n; i++) {
      if (yValues[i] <= topThreshold) endIdx = i;
      else break;
    }

    const startFrame = history[startIdx]?.frameIndex ?? 0;
    const endFrame = history[endIdx]?.frameIndex ?? 0;
    const repLength = endFrame - startFrame;
    if (repLength < REP_MIN_FRAMES || repLength > REP_MAX_FRAMES) return null;

    lastRepEndFrame = endFrame;
    return {
      start_frame: startFrame,
      bottom_frame: bottomFrame,
      end_frame: endFrame,
      rep_confidence: confAvg,
    };
  }

  function reset(): void {
    history.length = 0;
    lastRepEndFrame = 0;
  }

  return { addFrame, reset };
}
