# Specification clarifications and implementation notes

This file records decisions made where the spec was ambiguous, and options for you to adjust.

---

## 1) Backboard.io API

- **Unclear:** The exact Backboard.io base URL, auth header name, and request format were not confirmed from public docs. The backend uses:
  - `BACKBOARD_BASE_URL` (default `https://api.backboard.io`)
  - `BACKBOARD_API_KEY` with `X-API-Key` header
  - `POST /v1/chat` with `multipart/form-data` and fields: `model_name`, `memory`, `web_search`, `send_to_llm`, `content`
- **Action:** If your Backboard dashboard or docs show a different base URL, path, or body format, update `backend/app/backboard.py` and `.env` accordingly.

---

## 2) Rep segmentation

- **Unclear:** “Top” and “bottom” are inferred from hip-midpoint Y only. The rep window is: last “top” (standing) before the global “bottom” (deepest hip) → bottom → first “top” after. Prominence threshold is fixed (`MIN_PEAK_PROMINENCE = 0.02`).
- **Tuning:** If reps are split or merged incorrectly, adjust `REP_MIN_FRAMES`, `REP_MAX_FRAMES`, and `MIN_PEAK_PROMINENCE` in `frontend/src/constants.ts` and `frontend/src/repDetection.ts`.

---

## 3) Form check thresholds

- All thresholds (depth, valgus, torso lean, ankle rise, asymmetry) are in `frontend/src/constants.ts` and `frontend/src/formChecks.ts`. They are tuned for normalized coordinates and typical camera framing; you may want to calibrate per environment.

---

## 4) Live vs rep-based status cards

- The UI shows **rep-based** checks (last completed rep) in the status cards. The spec also mentions “live” rolling feedback (last 0.5–1.0 s). **Live** checks are now implemented: when phase is Live, status cards use a rolling window of the last ~15 frames (~0.75 s at 20 fps) via `computeLiveChecks()` in `formChecks.ts`. When not in Live, only rep-based (or last rep) checks are shown.

---

## 5) Optional POST /api/coach/rep

- Implemented as a simple stub that returns a one-line cue from the worst check. It is **not** wired to Backboard. To add AI per-rep cues, call Backboard (or another LLM) in `backend/app/main.py` (coach_rep) for the `rep` handler with the same prompt style as the set endpoint.

---

## 6) Session context (in-memory, no DB)

- The backend does **not** keep in-memory session state or rate limiting. The client sends `session_id` for correlation only. Adding short-lived session context (e.g. TTL 15–60 min) would require a small in-memory store keyed by `session_id` and a cleanup timer.

---

## 7) Pose inference input (video vs ImageData)

- MediaPipe Pose Landmarker is used with `runningMode: 'VIDEO'`. The code passes `HTMLVideoElement` and a timestamp to `detectForVideo()`. If your version of `@mediapipe/tasks-vision` expects `ImageData` instead, switch to drawing the current video frame to an `OffscreenCanvas`, then call `getImageData()` and pass that plus the timestamp.

---

## 8) Web Worker

- The spec suggests running inference in a Web Worker with `OffscreenCanvas`. The current implementation runs inference on the main thread with throttling by `TARGET_FPS`. Moving pose inference to a worker would require passing frames (e.g. `ImageBitmap` or `ImageData`) to the worker and receiving keypoints back; the rest of the pipeline can stay on the main thread.
