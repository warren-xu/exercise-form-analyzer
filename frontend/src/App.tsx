import { useCallback, useEffect, useRef, useState } from "react";
import { WebcamCapture } from "./WebcamCapture";
import { OverlayRenderer } from "./OverlayRenderer";
import { StatusCards } from "./StatusCards";
import { CoachPanel } from "./CoachPanel";
import { initPoseLandmarker, detectPose } from "./PoseInferenceEngine";
import { createMotionAnalysisEngine } from "./MotionAnalysisEngine";
import { isBodyReadyForSquat } from "./bodyReadyForSquat";
import { getSetCoach } from "./api";
import { generateAndPlayAudio } from "./elevenlabs";
import type { AppPhase } from "./types";
import type { RepSummary, RepCheckResult } from "./types";
import type { AssistantOutput } from "./types";
import type { SmoothedState } from "./smoothing";

type LiveChecksMap = {
  depth: RepCheckResult;
  knee_tracking: RepCheckResult;
  torso_angle: RepCheckResult;
  heel_lift: RepCheckResult;
  asymmetry: RepCheckResult;
};
import { TARGET_FPS } from "./constants";

function generateSessionId(): string {
  return "sess_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("Ready");
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });
  const [currentKeypoints, setCurrentKeypoints] = useState<
    SmoothedState["kpts"] | null
  >(null);
  const [liveChecks, setLiveChecks] = useState<LiveChecksMap | null>(null);
  const [lastRepChecks, setLastRepChecks] = useState<
    RepSummary["checks"] | null
  >(null);
  const [reps, setReps] = useState<RepSummary[]>([]);
  const [assistantOutput, setAssistantOutput] =
    useState<AssistantOutput | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<Awaited<
    ReturnType<typeof initPoseLandmarker>
  > | null>(null);
  const engineRef = useRef<ReturnType<
    typeof createMotionAnalysisEngine
  > | null>(null);
  const sessionIdRef = useRef<string>(generateSessionId());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const onVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) {
      el.addEventListener("loadedmetadata", () => {
        setVideoSize({ width: el.videoWidth, height: el.videoHeight });
      });
    }
  }, []);

  const onStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    setCameraReady(true);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const startInference = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      const lm = await initPoseLandmarker();
      landmarkerRef.current = lm;
      engineRef.current = createMotionAnalysisEngine();
      sessionIdRef.current = generateSessionId();
      setPhase("Calibrate");
      setLastRepChecks(null);
      setLiveChecks(null);
      setReps([]);
      setAssistantOutput(null);
      setAssistantError(null);
    } catch (e) {
      console.error(e);
      setAssistantError(
        e instanceof Error ? e.message : "Failed to load pose model",
      );
    }
  }, []);

  const goLive = useCallback(() => {
    setPhase("Live");
  }, []);

  useEffect(() => {
    if (
      phase !== "Live" ||
      !videoRef.current ||
      !landmarkerRef.current ||
      !engineRef.current
    )
      return;

    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    const engine = engineRef.current;
    const intervalMs = 1000 / TARGET_FPS;
    let tickCount = 0;
    console.log(
      "[rep] Live inference loop started. Open Console (F12) and look for [rep] messages.",
    );

    function tick(t: number) {
      rafRef.current = requestAnimationFrame(tick);
      if (t - lastTimeRef.current < intervalMs) return;
      lastTimeRef.current = t;
      tickCount += 1;

      if (video.readyState < 2) {
        if (tickCount === 1 || tickCount % 100 === 0)
          console.warn("[rep] video not ready, readyState=", video.readyState);
        return;
      }
      let result: ReturnType<typeof detectPose> = null;
      try {
        const timestampMs = video.currentTime * 1000;
        result = detectPose(landmarker, video, timestampMs);
      } catch (err) {
        if (tickCount <= 3 || tickCount % 60 === 0)
          console.error("[rep] detectPose error", err);
        return;
      }
      if (tickCount <= 5 || tickCount % 40 === 0) {
        console.log(
          "[rep] tick",
          tickCount,
          "pose=",
          result ? `ok (conf ${result.conf.toFixed(2)})` : "null",
        );
      }
      if (!result) return;
      const {
        state,
        repComplete,
        liveChecks: nextLiveChecks,
      } = engine.processFrame(
        result.kpts,
        result.conf,
        result.kpts3d ?? undefined,
      );
      setCurrentKeypoints(state.kpts);
      setLiveChecks(nextLiveChecks);

      if (repComplete) {
        setLastRepChecks(repComplete.checks);
        setReps((prev) => [...prev, repComplete]);
        setPhase("RepComplete");
        setPhase("Live");
      }
    }

    rafRef.current = requestAnimationFrame((t) => {
      lastTimeRef.current = t;
      tick(t);
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  const requestSetFeedback = useCallback(async () => {
    if (reps.length === 0) return;
    setAssistantLoading(true);
    setAssistantError(null);
    try {
      const output = await getSetCoach(sessionIdRef.current, reps);
      setAssistantOutput(output);
      setPhase("SetSummary");
      stopCamera();
    } catch (e) {
      setAssistantError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setAssistantLoading(false);
    }
  }, [reps, stopCamera]);

  // Dev function to increment the rep count REMOVE THIS BEFORE DEPLOYING
  const incrementRepCount = useCallback(() => {
    const placeholder: RepSummary = {
      rep_index: reps.length + 1,
      start_frame: 0,
      bottom_frame: 50,
      end_frame: 100,
      rep_confidence: 1,
      confidence: { pose_avg: 1, warnings: [] },
      checks: {
        depth: { severity: "low", status: "ok", evidence: {} },
        knee_tracking: { severity: "low", status: "ok", evidence: {} },
        torso_angle: { severity: "low", status: "ok", evidence: {} },
        heel_lift: { severity: "low", status: "ok", evidence: {} },
        asymmetry: { severity: "low", status: "ok", evidence: {} },
      },
    };
    setReps((prev) => prev.concat(placeholder));
  }, [reps]);
  // Generate and play audio when coach feedback is received
  useEffect(() => {
    if (!assistantOutput) return;

    // Combine summary and cues into a single text to speak
    const textToSpeak = [
      assistantOutput.summary,
      ...assistantOutput.cues,
    ]
      .filter((text) => text && text.trim())
      .join(". ");

    if (textToSpeak) {
      generateAndPlayAudio(textToSpeak).catch((err) =>
        console.error("Failed to generate audio feedback:", err)
      );
    }
  }, [assistantOutput]);

  const displayChecks =
    lastRepChecks ?? (reps.length > 0 ? reps[reps.length - 1].checks : null);
  const showLiveChecks = phase === "Live" ? liveChecks : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: 24,
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
          Squat Form Analyzer
        </h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
          Camera: 3/4 front or side · Full body in frame · Even lighting
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 24,
          flex: 1,
          alignItems: "start",
        }}
      >
        <div
          style={{
            position: "relative",
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <WebcamCapture
            onStream={onStream}
            onVideoRef={onVideoRef}
            className={undefined}
          />
          {currentKeypoints && phase === "Live" && (
            <OverlayRenderer
              keypoints={currentKeypoints}
              width={videoSize.width}
              height={videoSize.height}
            />
          )}
          {phase === "Calibrate" && cameraReady && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: 8,
              }}
            >
              <button type="button" onClick={goLive} style={primaryButtonStyle}>
                Start analysis
              </button>
            </div>
          )}
          {phase === "Ready" && cameraReady && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: "50%",
                transform: "translateX(-50%)",
              }}
            >
              <button
                type="button"
                onClick={startInference}
                style={primaryButtonStyle}
              >
                Calibrate & start
              </button>
            </div>
          )}
        </div>

        <div>
          <p
            style={{ margin: "0 0 12px", fontSize: 14, color: "var(--muted)" }}
          >
            {phase === "Ready" && "Start camera, then calibrate."}
            {phase === "Calibrate" &&
              "Stand still; ensure full body in frame, then start analysis."}
            {phase === "Live" && (
              <>
                Live · Reps: {reps.length}
                <span style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                  F12 → Console for [rep] debug logs
                </span>
                <button type="button" onClick={incrementRepCount}>
                  Increment Rep Count
                </button>
              </>
            )}
            {phase === "RepComplete" && `Rep complete · Reps: ${reps.length}`}
            {phase === "SetSummary" && "Set summary with coach feedback."}
          </p>
          <StatusCards checks={displayChecks} liveChecks={showLiveChecks} />
          {reps.length > 0 && phase !== "SetSummary" && (
            <button
              type="button"
              onClick={requestSetFeedback}
              disabled={assistantLoading}
              style={{ ...primaryButtonStyle, marginTop: 16 }}
            >
              Get coach feedback
            </button>
          )}
          <CoachPanel
            output={assistantOutput}
            loading={assistantLoading}
            error={assistantError}
          />
        </div>
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
};
