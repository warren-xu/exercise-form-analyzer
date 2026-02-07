/**
 * Skeleton overlay: draws keypoints and segments over video.
 */

import { useEffect, useRef } from 'react';
import type { Keypoints } from './types';

export interface OverlayRendererProps {
  keypoints: Keypoints | null;
  width: number;
  height: number;
  className?: string;
}

const SEGMENTS: [keyof Keypoints, keyof Keypoints][] = [
  ['l_shoulder', 'r_shoulder'],
  ['l_shoulder', 'l_hip'],
  ['r_shoulder', 'r_hip'],
  ['l_hip', 'r_hip'],
  ['l_hip', 'l_knee'],
  ['r_hip', 'r_knee'],
  ['l_knee', 'l_ankle'],
  ['r_knee', 'r_ankle'],
];

export function OverlayRenderer({
  keypoints,
  width,
  height,
  className,
}: OverlayRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !keypoints) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const toX = (x: number) => x * width;
    const toY = (y: number) => y * height;

    ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
    ctx.lineWidth = 2;
    for (const [a, b] of SEGMENTS) {
      const [x1, y1] = keypoints[a];
      const [x2, y2] = keypoints[b];
      ctx.beginPath();
      ctx.moveTo(toX(x1), toY(y1));
      ctx.lineTo(toX(x2), toY(y2));
      ctx.stroke();
    }

    ctx.fillStyle = 'var(--accent)';
    const joints: (keyof Keypoints)[] = [
      'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
      'l_shoulder', 'r_shoulder',
    ];
    for (const j of joints) {
      const [x, y] = keypoints[j];
      ctx.beginPath();
      ctx.arc(toX(x), toY(y), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'var(--watch)';
    ctx.beginPath();
    ctx.arc(toX(keypoints.l_knee[0]), toY(keypoints.l_knee[1]), 6, 0, Math.PI * 2);
    ctx.arc(toX(keypoints.r_knee[0]), toY(keypoints.r_knee[1]), 6, 0, Math.PI * 2);
    ctx.fill();
  }, [keypoints, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
