import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth0 } from '@auth0/auth0-react';
import { WebcamCapture } from "./WebcamCapture";
import { OverlayRenderer } from "./OverlayRenderer";
import { StatusCards } from "./StatusCards";
import { CoachPanel } from "./CoachPanel";
import { HistoricalFeedback } from "./HistoricalFeedback";
import { initPoseLandmarker, detectPose } from "./PoseInferenceEngine";
import { createMotionAnalysisEngine } from "./MotionAnalysisEngine";
import { isBodyReadyForSquat } from "./bodyReadyForSquat";
import { getSetCoach } from "./api";
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
  const { user, logout, getAccessTokenSilently, getIdTokenClaims } = useAuth0();
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
  const [bodyReadyForTracking, setBodyReadyForTracking] = useState(false);

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

      setBodyReadyForTracking(true);
      const {
        state,
        repComplete,
        liveChecks: nextLiveChecks,
      } = engine.processFrame(result.kpts, result.conf);
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
      const token = await getAccessTokenSilently().catch(() => undefined);
      const idClaims = await getIdTokenClaims().catch(() => undefined);
      const userId = idClaims?.sub;
      console.log('🔍 Access token retrieved:', token ? `${token.substring(0, 20)}...` : 'undefined');
      const output = await getSetCoach(sessionIdRef.current, reps, undefined, token, userId);
      
      // Log MongoDB save status
      console.log('\n' + '='.repeat(80));
      console.log('💾 MONGODB SAVE STATUS');
      console.log('='.repeat(80));
      console.log('Session saved to database:', output.saved_to_db);
      if (output.saved_to_db && output.db_session_id) {
        console.log('✅ Database session ID:', output.db_session_id);
        console.log('✅ Session ID:', sessionIdRef.current);
        console.log('✅ Rep count:', reps.length);
      } else {
        console.log('❌ Session was NOT saved to database');
      }
      
      // Show detailed debug info
      if (output.debug_info) {
        console.log('\n🔍 DEBUG INFO:');
        console.log('  Authorization received:', output.debug_info.authorization_received);
        console.log('  MongoDB save attempted:', output.debug_info.mongodb_attempted);
        if (output.debug_info.error) {
          console.log('  Error:', output.debug_info.error);
        }
        console.log('\n📝 Backend logs:');
        output.debug_info.logs?.forEach((log: string, i: number) => {
          console.log(`  ${i + 1}. ${log}`);
        });
      }
      console.log('='.repeat(80) + '\n');
      
      setAssistantOutput(output);
      setPhase("SetSummary");
      stopCamera();
    } catch (e) {
      setAssistantError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setAssistantLoading(false);
    }
  }, [reps, stopCamera, getAccessTokenSilently]);

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
      <header style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
            Squat Form Analyzer
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
            Camera: 3/4 front or side · Full body in frame · Even lighting
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {user && (
            <div style={{ fontSize: 14, color: "var(--muted)" }}>
              {user.name}
            </div>
          )}
          <button
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              backgroundColor: "transparent",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "var(--accent)";
              e.currentTarget.style.color = "#000";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--accent)";
            }}
          >
            Logout
          </button>
        </div>
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

      {/* Historical Feedback Section */}
      <div style={{ marginTop: 24 }}>
        <HistoricalFeedback />
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
