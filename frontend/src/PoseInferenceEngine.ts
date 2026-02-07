/**
 * In-browser pose inference using MediaPipe Pose Landmarker (Option A).
 * Outputs keypoints + confidence per frame.
 */

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Keypoints } from './types';
import { POSE_LANDMARKS } from './constants';

let landmarker: PoseLandmarker | null = null;

export async function initPoseLandmarker(): Promise<PoseLandmarker> {
  if (landmarker) return landmarker;
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return landmarker;
}

function getLandmark(
  landmarks: Array<{ x: number; y: number; visibility?: number }>,
  index: number
): [number, number] {
  const l = landmarks[index];
  if (!l) return [0.5, 0.5];
  return [l.x, l.y];
}

function avgVisibility(
  landmarks: Array<{ visibility?: number }>,
  indices: number[]
): number {
  let sum = 0;
  let n = 0;
  for (const i of indices) {
    const v = landmarks[i]?.visibility ?? 0;
    sum += v;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Run detection on a video frame. Call with video.currentTime for VIDEO mode.
 */
export function detectPose(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number
): { kpts: Keypoints; conf: number } | null {
  const result = landmarker.detectForVideo(video, timestampMs);
  if (!result.landmarks?.length) return null;
  const lm = result.landmarks[0];
  if (!lm) return null;

  const kpts: Keypoints = {
    l_hip: getLandmark(lm, POSE_LANDMARKS.LEFT_HIP),
    r_hip: getLandmark(lm, POSE_LANDMARKS.RIGHT_HIP),
    l_knee: getLandmark(lm, POSE_LANDMARKS.LEFT_KNEE),
    r_knee: getLandmark(lm, POSE_LANDMARKS.RIGHT_KNEE),
    l_ankle: getLandmark(lm, POSE_LANDMARKS.LEFT_ANKLE),
    r_ankle: getLandmark(lm, POSE_LANDMARKS.RIGHT_ANKLE),
    l_shoulder: getLandmark(lm, POSE_LANDMARKS.LEFT_SHOULDER),
    r_shoulder: getLandmark(lm, POSE_LANDMARKS.RIGHT_SHOULDER),
  };

  const indices = [
    POSE_LANDMARKS.LEFT_HIP,
    POSE_LANDMARKS.RIGHT_HIP,
    POSE_LANDMARKS.LEFT_KNEE,
    POSE_LANDMARKS.RIGHT_KNEE,
    POSE_LANDMARKS.LEFT_ANKLE,
    POSE_LANDMARKS.RIGHT_ANKLE,
    POSE_LANDMARKS.LEFT_SHOULDER,
    POSE_LANDMARKS.RIGHT_SHOULDER,
  ];
  const conf = avgVisibility(lm, indices);
  return { kpts, conf };
}
