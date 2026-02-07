/**
 * Squat rep: count when hip midline goes lower (Y increases) then raises again (Y decreases).
 * Simple state machine — no "standing threshold" or range-based top.
 */

import type { SmoothedState } from './smoothing';
import { REP_MIN_FRAMES, REP_MAX_FRAMES } from './constants';

const DEBUG_LOG_INTERVAL = 30;

export interface RepWindow {
  start_frame: number;
  bottom_frame: number;
  end_frame: number;
  rep_confidence: number;
}

/** Minimum hip drop (Y increase) to consider "went down" — avoids counting noise. */
const MIN_DROP = 0.03;
/** How much hip must rise (Y decrease) from bottom to count "raised again". */
const RISE_FROM_BOTTOM = 0.03;
/** Frames to look back for "bottom" (local max). */
const BOTTOM_LOOKBACK = 60;
/** Cooldown frames after counting before we can count again. */
const COOLDOWN_FRAMES = 12;

type Phase = 'waiting_for_bottom' | 'seen_bottom';

export function createRepDetector() {
  const history: { frameIndex: number; hipMidY: number; conf: number }[] = [];
  const maxHistory = 150;
  let phase: Phase = 'waiting_for_bottom';
  let bottomY = 0;
  let bottomFrame = 0;
  let startFrame = 0;
  let lastCountedAtFrame = 0;

  function addFrame(state: SmoothedState): RepWindow | null {
    history.push({
      frameIndex: state.frameIndex,
      hipMidY: state.hipMidY,
      conf: state.conf,
    });
    if (history.length > maxHistory) history.shift();

    const n = history.length;
    const y = state.hipMidY;
    if (state.frameIndex <= 3 || state.frameIndex % DEBUG_LOG_INTERVAL === 0) {
      console.log('[rep] frame', state.frameIndex, 'hipMidY', y.toFixed(3), 'phase', phase);
    }

    if (n < REP_MIN_FRAMES) return null;

    const yValues = history.map((h) => h.hipMidY);
    const confAvg = history.reduce((a, h) => a + h.conf, 0) / history.length;
    const searchStart = Math.max(0, n - BOTTOM_LOOKBACK);
    const windowY = yValues.slice(searchStart, n);
    const maxY = Math.max(...windowY);
    const minY = Math.min(...windowY);
    const drop = maxY - minY;

    if (phase === 'waiting_for_bottom') {
      if (state.frameIndex - lastCountedAtFrame < COOLDOWN_FRAMES) return null;
      if (drop < MIN_DROP) return null;
      const atBottom = y >= maxY - 0.015;
      if (atBottom) {
        bottomY = maxY;
        const bottomIdx = searchStart + windowY.lastIndexOf(maxY);
        bottomFrame = history[bottomIdx]?.frameIndex ?? state.frameIndex;
        const minIdx = searchStart + windowY.indexOf(minY);
        startFrame = history[minIdx]?.frameIndex ?? bottomFrame;
        if (startFrame >= bottomFrame) startFrame = Math.max(0, bottomFrame - 15);
        phase = 'seen_bottom';
      }
      return null;
    }

    if (phase === 'seen_bottom') {
      if (y > bottomY) {
        bottomY = y;
        bottomFrame = state.frameIndex;
      }
      if (y < bottomY - RISE_FROM_BOTTOM) {
        const repLength = state.frameIndex - startFrame;
        if (repLength < REP_MIN_FRAMES || repLength > REP_MAX_FRAMES) {
          phase = 'waiting_for_bottom';
          return null;
        }
        lastCountedAtFrame = state.frameIndex;
        phase = 'waiting_for_bottom';
        console.warn('[rep] REP COUNTED', { startFrame, bottomFrame, endFrame: state.frameIndex, repLength, bottomY: bottomY.toFixed(3) });
        return {
          start_frame: startFrame,
          bottom_frame: bottomFrame,
          end_frame: state.frameIndex,
          rep_confidence: confAvg,
        };
      }
      if (state.frameIndex - bottomFrame > REP_MAX_FRAMES) {
        phase = 'waiting_for_bottom';
      }
    }

    return null;
  }

  function reset(): void {
    history.length = 0;
    phase = 'waiting_for_bottom';
    bottomY = 0;
    bottomFrame = 0;
    startFrame = 0;
    lastCountedAtFrame = 0;
  }

  return { addFrame, reset };
}
