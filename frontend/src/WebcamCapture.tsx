import { useCallback, useEffect, useRef, useState } from 'react';

export interface WebcamCaptureProps {
  onStream?: (stream: MediaStream) => void;
  onVideoRef?: (video: HTMLVideoElement | null) => void;
  facingMode?: 'user' | 'environment';
  className?: string;
}

export function WebcamCapture({
  onStream,
  onVideoRef,
  facingMode = 'user',
  className,
}: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'live'>('idle');

  const start = useCallback(async () => {
    setError(null);
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
        onVideoRef?.(video);
        onStream?.(stream);
        setStatus('live');
      } else {
        stream.getTracks().forEach((t) => t.stop());
        setError('Video element not mounted');
        setStatus('idle');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Camera access failed';
      setError(msg);
      setStatus('idle');
    }
  }, [facingMode, onStream, onVideoRef]);

  useEffect(() => {
    onVideoRef?.(videoRef.current ?? null);
    return () => {
      const v = videoRef.current;
      if (v?.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [onVideoRef]);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: '100%', display: 'block', background: '#000' }}
      />
      {status === 'idle' && !error && (
        <button
          type="button"
          onClick={start}
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Start camera
        </button>
      )}
      {error && (
        <p style={{ color: 'var(--flag)', padding: 12, margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
