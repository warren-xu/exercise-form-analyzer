/**
 * EMA smoothing and gap handling for landmark jitter reduction.
 */

import type { Keypoints, Keypoints3D } from './types';
import { SMOOTHING_ALPHA } from './constants';

export interface SmoothedState {
  kpts: Keypoints;
  /** 3D world landmarks when available (for 3D knee angle). */
  kpts3d?: Keypoints3D;
  hipMidY: number;
  conf: number;
  frameIndex: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothPoint(
  prev: [number, number],
  next: [number, number],
  alpha: number
): [number, number] {
  return [
    lerp(prev[0], next[0], alpha),
    lerp(prev[1], next[1], alpha),
  ];
}

function smoothPoint3D(
  prev: [number, number, number],
  next: [number, number, number],
  alpha: number
): [number, number, number] {
  return [
    lerp(prev[0], next[0], alpha),
    lerp(prev[1], next[1], alpha),
    lerp(prev[2], next[2], alpha),
  ];
}

export function createSmoother(alpha: number = SMOOTHING_ALPHA) {
  let prev: SmoothedState | null = null;
  let frameIndex = 0;

  return function smooth(
    kpts: Keypoints,
    conf: number,
    kpts3d?: Keypoints3D | null
  ): SmoothedState {
    frameIndex += 1;
    const hipMidY = (kpts.l_hip[1] + kpts.r_hip[1]) / 2;

    if (!prev) {
      const state: SmoothedState = {
        kpts: { ...kpts },
        hipMidY,
        conf,
        frameIndex,
      };
      if (kpts3d) state.kpts3d = { ...kpts3d };
      prev = state;
      return prev;
    }

    const kptsSmoothed: Keypoints = {
      l_hip: smoothPoint(prev.kpts.l_hip, kpts.l_hip, alpha),
      r_hip: smoothPoint(prev.kpts.r_hip, kpts.r_hip, alpha),
      l_knee: smoothPoint(prev.kpts.l_knee, kpts.l_knee, alpha),
      r_knee: smoothPoint(prev.kpts.r_knee, kpts.r_knee, alpha),
      l_ankle: smoothPoint(prev.kpts.l_ankle, kpts.l_ankle, alpha),
      r_ankle: smoothPoint(prev.kpts.r_ankle, kpts.r_ankle, alpha),
      l_shoulder: smoothPoint(prev.kpts.l_shoulder, kpts.l_shoulder, alpha),
      r_shoulder: smoothPoint(prev.kpts.r_shoulder, kpts.r_shoulder, alpha),
    };
    const hipMidYSmoothed = lerp(prev.hipMidY, hipMidY, alpha);
    const confSmoothed = lerp(prev.conf, conf, alpha);

    let kpts3dSmoothed: Keypoints3D | undefined;
    if (kpts3d) {
      if (prev.kpts3d) {
        kpts3dSmoothed = {
          l_hip: smoothPoint3D(prev.kpts3d.l_hip, kpts3d.l_hip, alpha),
          r_hip: smoothPoint3D(prev.kpts3d.r_hip, kpts3d.r_hip, alpha),
          l_knee: smoothPoint3D(prev.kpts3d.l_knee, kpts3d.l_knee, alpha),
          r_knee: smoothPoint3D(prev.kpts3d.r_knee, kpts3d.r_knee, alpha),
          l_ankle: smoothPoint3D(prev.kpts3d.l_ankle, kpts3d.l_ankle, alpha),
          r_ankle: smoothPoint3D(prev.kpts3d.r_ankle, kpts3d.r_ankle, alpha),
          l_shoulder: smoothPoint3D(prev.kpts3d.l_shoulder, kpts3d.l_shoulder, alpha),
          r_shoulder: smoothPoint3D(prev.kpts3d.r_shoulder, kpts3d.r_shoulder, alpha),
        };
      } else {
        kpts3dSmoothed = { ...kpts3d };
      }
    }

    prev = {
      kpts: kptsSmoothed,
      hipMidY: hipMidYSmoothed,
      conf: confSmoothed,
      frameIndex,
      ...(kpts3dSmoothed && { kpts3d: kpts3dSmoothed }),
    };
    return prev;
  };
}
