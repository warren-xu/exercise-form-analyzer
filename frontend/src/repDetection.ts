/**
 * Squat rep detector using hip height with velocity - 3-phase state machine.
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
  max_depth: number;
}

/** Minimum hip drop (Y increase) to consider "went down" */
const MIN_DROP = 0.08; // 8cm drop to commit
/** How much hip must rise (Y decrease) from bottom to count as standing */
const RISE_FROM_BOTTOM = 0.06; // 6cm rise to complete
/** Velocity window for smoothing */
const VELOCITY_WINDOW = 5;
/** Velocity threshold to detect direction change (in Y per frame) */
const VELOCITY_THRESHOLD = 0.0025;
/** Minimum time for a rep (seconds) */
const MIN_REP_DURATION_SEC = 1.0;
/** Maximum time for a rep (seconds) */
const MAX_REP_DURATION_SEC = 10.0;
/** Cooldown frames after counting */
const COOLDOWN_FRAMES = 12;
/** How many frames to wait after detecting bottom before allowing ascent phase */
const BOTTOM_SETTLE_FRAMES = 6;

type Phase = 'waiting' | 'descending' | 'ascending';

interface FrameData {
  frameIndex: number;
  hipMidY: number;
  conf: number;
}

export function createRepDetector() {
  const history: FrameData[] = [];
  const velocities: number[] = [];
  const maxHistory = 150;
  
  let phase: Phase = 'waiting';
  let startFrame = 0;
  let startY = 0;
  let bottomFrame = 0;
  let bottomY = 0;
  let committed = false;
  let lastCountedAtFrame = 0;

  function calculateDepthScore(drop: number): number {
    // Score based on how deep the squat was (hip drop in Y)
    // 0.15+ (15cm) = perfect, 0.08 (8cm) = shallow
    if (drop >= 0.15) return 1.0;
    if (drop <= 0.08) return 0.3;
    return 0.3 + ((drop - 0.08) / 0.07) * 0.7;
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
    
    // Measure variance in movement path
    const yValues = repFrames.map((f) => f.hipMidY);
    const mean = yValues.reduce((a, b) => a + b, 0) / yValues.length;
    const variance = yValues.reduce((a, y) => a + (y - mean) ** 2, 0) / yValues.length;
    const stability = Math.max(0, 1 - variance * 10);
    
    return stability;
  }

  function addFrame(state: SmoothedState): RepWindow | null {
    const frameData: FrameData = {
      frameIndex: state.frameIndex,
      hipMidY: state.hipMidY,
      conf: state.conf,
    };
    
    history.push(frameData);
    if (history.length > maxHistory) history.shift();

    // Calculate velocity (change in hip Y)
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const velocity = state.hipMidY - prev.hipMidY;
      velocities.push(velocity);
      if (velocities.length > VELOCITY_WINDOW) velocities.shift();
    }

    const avgVelocity = velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;

    const y = state.hipMidY;

    // Debug logging
    if (state.frameIndex <= 3 || state.frameIndex % DEBUG_LOG_INTERVAL === 0) {
      console.log(
        '[rep] frame', state.frameIndex,
        'phase', phase,
        'hipY', y.toFixed(3),
        'velocity', avgVelocity.toFixed(4),
        'bottomY', bottomY.toFixed(3)
      );
    }

    if (history.length < REP_MIN_FRAMES) return null;

    // State machine
    switch (phase) {
      case 'waiting': {
        // Cooldown period
        if (state.frameIndex - lastCountedAtFrame < COOLDOWN_FRAMES) return null;
        
        // Detect start of descent (velocity going down = Y increasing)
        if (avgVelocity > VELOCITY_THRESHOLD) {
          phase = 'descending';
          startFrame = state.frameIndex;
          startY = y;
          bottomY = y;
          bottomFrame = state.frameIndex;
          committed = false;
          console.log('[rep] START descent at frame', startFrame, 'Y=', y.toFixed(3));
        }
        break;
      }

      case 'descending': {
        // Continuously track the deepest position (highest Y value)
        if (y > bottomY) {
          bottomY = y;
          bottomFrame = state.frameIndex;
        }

        // Check if committed to rep (dropped enough)
        const dropY = y - startY;
        
        if (!committed && dropY >= MIN_DROP) {
          committed = true;
          console.log('[rep] COMMITTED to rep at frame', state.frameIndex, 'drop=', dropY.toFixed(3));
        }

        // Transition to ascending when:
        // 1. Velocity reverses (going up = Y decreasing)
        // 2. We've settled at bottom for a few frames (to avoid noise)
        const settledAtBottom = state.frameIndex - bottomFrame >= BOTTOM_SETTLE_FRAMES;
        
        if (avgVelocity < -VELOCITY_THRESHOLD && settledAtBottom) {
          phase = 'ascending';
          console.log('[rep] START ascent at frame', state.frameIndex, 'bottomY=', bottomY.toFixed(3));
        }

        // Timeout if descending too long
        if (state.frameIndex - startFrame > REP_MAX_FRAMES) {
          console.warn('[rep] TIMEOUT during descent');
          phase = 'waiting';
          committed = false;
        }
        break;
      }

      case 'ascending': {
        // Allow bottom to deepen slightly if user goes lower during ascent
        // But only within a small margin (prevents full re-descent from counting as new bottom)
        if (y > bottomY + 0.01) {
          // User went significantly deeper - restart as descending
          bottomY = y;
          bottomFrame = state.frameIndex;
          phase = 'descending';
          console.log('[rep] DEEPER motion detected, back to descending');
          break;
        } else if (y > bottomY) {
          // Small fluctuation, just update bottom
          bottomY = y;
          bottomFrame = state.frameIndex;
        }

        // Check if risen enough to complete rep
        const riseY = bottomY - y;
        const totalDrop = bottomY - startY;
        
        if (riseY >= RISE_FROM_BOTTOM) {
          // Validate rep
          const repLength = state.frameIndex - startFrame;
          const repDurationSec = repLength / TARGET_FPS;

          // Duration check
          if (repDurationSec < MIN_REP_DURATION_SEC) {
            console.warn('[rep] REJECTED: too fast', repDurationSec.toFixed(2), 's');
            phase = 'waiting';
            committed = false;
            return null;
          }
          if (repDurationSec > MAX_REP_DURATION_SEC) {
            console.warn('[rep] REJECTED: too slow', repDurationSec.toFixed(2), 's');
            phase = 'waiting';
            committed = false;
            return null;
          }

          // Frame count check
          if (repLength < REP_MIN_FRAMES || repLength > REP_MAX_FRAMES) {
            console.warn('[rep] REJECTED: bad frame count', repLength);
            phase = 'waiting';
            committed = false;
            return null;
          }

          // Depth check
          if (!committed || totalDrop < MIN_DROP) {
            console.warn('[rep] REJECTED: not deep enough', totalDrop.toFixed(3));
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
            depth_score: calculateDepthScore(totalDrop),
            stability_score: calculateStabilityScore(history, startFrame, state.frameIndex),
            max_depth: totalDrop,
          };

          console.warn('[rep] ✅ REP COUNTED', {
            frames: repLength,
            duration: repDurationSec.toFixed(2) + 's',
            drop: totalDrop.toFixed(3),
            rise: riseY.toFixed(3),
            depthScore: result.depth_score.toFixed(2),
            stabilityScore: result.stability_score.toFixed(2),
          });

          return result;
        }

        // Timeout during ascent
        if (state.frameIndex - bottomFrame > REP_MAX_FRAMES) {
          console.warn('[rep] TIMEOUT during ascent');
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
    velocities.length = 0;
    phase = 'waiting';
    startFrame = 0;
    startY = 0;
    bottomFrame = 0;
    bottomY = 0;
    committed = false;
    lastCountedAtFrame = 0;
  }

  return { addFrame, reset };
}