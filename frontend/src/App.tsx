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
import type { AppPhase, RepSummary, RepCheckResult, AssistantOutput, Severity } from "./types";
import type { SmoothedState } from "./smoothing";

const CHECK_ORDER: (keyof RepSummary["checks"])[] = [
  "depth",
  "knee_tracking",
  "torso_angle",
  "heel_lift",
  "asymmetry",
];
const CHECK_LABELS: Record<keyof RepSummary["checks"], string> = {
  depth: "Depth",
  knee_tracking: "Knee tracking",
  torso_angle: "Torso angle",
  heel_lift: "Heel lift",
  asymmetry: "Asymmetry",
};
const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  moderate: 2,
  low: 1,
};

/** One-line summary of the single most critical form issue for the backend. */
function getMostCriticalIssue(rep: RepSummary): string {
  let worstKey: keyof RepSummary["checks"] | null = null;
  let worstRank = 0;
  for (const key of CHECK_ORDER) {
    const r = rep.checks[key];
    const rank = SEVERITY_RANK[r.severity];
    if (rank > worstRank) {
      worstRank = rank;
      worstKey = key;
    }
  }
  if (!worstKey || worstRank <= SEVERITY_RANK.low)
    return "No critical issue; keep consistency.";
  const check = rep.checks[worstKey];
  const label = CHECK_LABELS[worstKey];
  return check.cue ? `${label}: ${check.cue}` : `${label} needs attention.`;
}

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
  /** Every-5-reps check-in feedback (shown in panel under live feed) */
  const [checkInOutput, setCheckInOutput] = useState<AssistantOutput | null>(null);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
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
  const lastCheckInRepsSentRef = useRef<number>(0);

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
      lastCheckInRepsSentRef.current = 0;
      setAssistantOutput(null);
      setCheckInOutput(null);
      setCheckInLoading(false);
      setCheckInError(null);
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

  // Call backend every 5 accepted reps with current rep and most critical issue summary
  useEffect(() => {
    const n = reps.length;
    if (n === 0 || n % 5 !== 0 || n === lastCheckInRepsSentRef.current) return;
    lastCheckInRepsSentRef.current = n;
    const currentRep = reps[n - 1];
    const mostCritical = getMostCriticalIssue(currentRep);
    setCheckInLoading(true);
    setCheckInError(null);
    getSetCoach(
      sessionIdRef.current,
      reps,
      { worst_issues: [mostCritical], consistency_note: "Rep accepted." },
      "check_in"
    )
      .then((output) => {
        setCheckInOutput(output);
      })
      .catch((e) => {
        setCheckInError(e instanceof Error ? e.message : "Set coach failed");
      })
      .finally(() => {
        setCheckInLoading(false);
      });
  }, [reps]);

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
  // Generate and play audio when coach feedback is received (manual "Get coach feedback")
  useEffect(() => {
    if (!assistantOutput) return;
    const textToSpeak = [assistantOutput.summary, ...assistantOutput.cues]
      .filter((text) => text && text.trim())
      .join(". ");
    if (textToSpeak) {
      generateAndPlayAudio(textToSpeak).catch((err) =>
        console.error("Failed to generate audio feedback:", err)
      );
    }
  }, [assistantOutput]);

  // Play check-in feedback when every-5-reps response arrives
  useEffect(() => {
    if (!checkInOutput) return;
    const textToSpeak = [checkInOutput.summary, ...checkInOutput.cues]
      .filter((text) => text && text.trim())
      .join(". ");
    if (textToSpeak) {
      generateAndPlayAudio(textToSpeak).catch((err) =>
        console.error("Failed to generate audio check-in:", err)
      );
    }
  }, [checkInOutput]);

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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

          {phase === "Live" && (checkInLoading || checkInOutput || checkInError) && (
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600 }}>
                Check-in
              </h3>
              {checkInLoading && (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                  Generating feedback…
                </p>
              )}
              {!checkInLoading && checkInError && (
                <p style={{ margin: 0, color: "var(--flag)", fontSize: 14 }}>
                  {checkInError}
                </p>
              )}
              {!checkInLoading && checkInOutput && (
                <>
                  <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>
                    {checkInOutput.summary}
                  </p>
                  {checkInOutput.cues.length > 0 && (
                    <ul
                      style={{
                        margin: "0 0 10px",
                        paddingLeft: 20,
                        lineHeight: 1.5,
                        fontSize: 14,
                      }}
                    >
                      {checkInOutput.cues.map((cue, i) => (
                        <li key={i}>{cue}</li>
                      ))}
                    </ul>
                  )}
                  <p style={{ margin: 0, fontSize: 13, color: "var(--watch)" }}>
                    {checkInOutput.safety_note}
                  </p>
                </>
              )}
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
