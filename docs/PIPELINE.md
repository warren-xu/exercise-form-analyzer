# How the rep pipeline works

## End-to-end flow

1. **Frame capture** (`App.tsx` + `WebcamCapture`)  
   Video runs from the webcam. A `requestAnimationFrame` loop runs at **~20 FPS** (throttled by `TARGET_FPS` in `constants.ts`).

2. **Pose inference** (`PoseInferenceEngine.ts`)  
   Each throttled frame is sent to MediaPipe Pose Landmarker (`detectForVideo(video, timestampMs)`).  
   Output: **keypoints** (L/R hip, knee, ankle, shoulder) in normalized [0,1] and a **confidence** score.

3. **Smoothing** (`smoothing.ts`)  
   Keypoints and confidence are smoothed with an **EMA** (alpha 0.4).  
   Each smoothed frame gets a **frame index** (1, 2, 3, …) that never resets until you click “Calibrate & start” again.

4. **Rep detection** (`repDetection.ts`)  
   - We keep a short **history** of `(frameIndex, hipMidY)` (hip midpoint Y in normalized coords; **Y increases downward**).
   - In the last **REP_MAX_FRAMES** (120) frames we find:
     - **Bottom of rep** = frame where **hip Y is largest** (lowest body position).
     - **Top** = frame where hip Y is smallest (standing).
   - We define one rep as: **start** (last “top” before that bottom) → **bottom** → **end** (first “top” after that bottom).
   - “Top” means: hip Y ≤ **topThreshold**. This is now **forgiving**: we use the top 35% of the hip range (topY to bottomY) so you don’t have to stand perfectly back up. If the range is very small we use `topY + 0.03`. We also require **range ≥ 0.05** (min hip drop) so we don’t count when you’re just standing.
   - We only **emit** a rep when:
     - We’ve seen a bottom **after** the previous rep’s end (`bottomFrame > lastRepEndFrame`).
     - The rep length (in frames) is between **REP_MIN_FRAMES** (15) and **REP_MAX_FRAMES** (120).

5. **Form checks** (`formChecks.ts`)  
   When a rep is emitted we have a window of frames from start → bottom → end. We compute **depth, knee tracking, torso angle, heel lift, asymmetry** from that window (especially around the bottom frame).

6. **UI** (`App.tsx`)  
   - **Rep count** comes from `reps.length`. `reps` is only appended when `engine.processFrame()` returns a **non-null `repComplete`**.
   - So the count only goes up when the **rep detector** returns a rep (hip went down then up) **and** the motion engine successfully builds a `RepSummary` from the smoothed frames.

## Why reps might not update

- **You never register as “back at top”**  
  If your standing hip Y stays above `topY + 0.02` (e.g. you lean forward, or the camera angle changes), the detector never sees an “end” frame, so it never emits that rep.

- **Rep too short or too long**  
  Rep length in frames must be between 15 and 120 (~0.75 s–6 s at 20 FPS). Very quick or very slow squats can be rejected.

- **Pose confidence**  
  If MediaPipe often fails (no pose or low confidence), those frames don’t get smooth hip Y, so the trajectory can be too noisy to get a clear top → bottom → top.

- **Frames evicted**  
  The motion engine keeps only the last 300 smoothed frames. If a rep’s start frame was evicted, we still try to build the rep from the frames we have; in bad cases that can affect form checks but usually we still have the bottom and end.

## Debug logging

Set **`REP_DEBUG = true`** in `frontend/src/constants.ts`, run the app, open **DevTools → Console**, and start analysis. You’ll see:

| Log | What it means |
|-----|----------------|
| `[rep] frame N hipMidY 0.52 conf 0.85` | Every ~20 frames: current hip height (Y goes **up** as you go down). Watch this move up when you squat and back down when you stand. |
| `[rep] skip: range too small 0.03 < 0.05` | Hip didn’t drop enough (range &lt; 0.05). Squat deeper or check that full body is in frame. |
| `[rep] skip: bottom already counted` | This bottom was already used for a previous rep. Normal between reps. |
| `[rep] skip: repLength 8 outside 15-120` | Rep was too fast (fewer than 15 frames) or we never saw you “back at top” after the bottom (end = bottom, so length 0). Stand more fully between reps. |
| `[rep] REP COUNTED { startFrame, bottomFrame, endFrame, repLength, range }` | A rep was accepted. Rep count in the UI should increase. |
| `[rep] motion engine dropped rep: missing frames` | Rep detector said “rep” but we’d already evicted those frames from the buffer. Rare; if you see it often, you may be at very high frame indices. |

**What to look for:** During a squat, `hipMidY` should **increase** (you go down) then **decrease** (you stand). If it stays flat or noisy, pose may be poor (lighting, framing, or confidence). If you see “range too small” even when you squat deep, your standing Y might be too high (camera angle); try lowering `MIN_RANGE_FOR_REP` in `repDetection.ts` (e.g. to 0.04). Set `REP_DEBUG = false` when you’re done to avoid console noise.

## Constants you can tune

In `frontend/src/constants.ts` and `frontend/src/repDetection.ts`:

- **REP_MIN_FRAMES** (15) – minimum frames for one rep.
- **REP_MAX_FRAMES** (120) – maximum frames; bottom is searched in this window.
- **TOP_RANGE_FRACTION** (0.35) and **MIN_PEAK_PROMINENCE** (0.03) in `repDetection.ts` – how much of the hip range counts as “standing”; **MIN_RANGE_FOR_REP** (0.05) – minimum hip drop to count a rep.
