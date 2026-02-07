# Exercise Form Analyzer — Live Webcam Squat Feedback

Proof-of-concept web app for **live squat form feedback** using the browser webcam. Pose estimation and motion analysis run **in the browser**; only a small structured summary is sent to the backend, which uses a **Backboard.io** (or compatible) AI assistant to return coaching text.

## Features

- **In-browser:** Pose estimation (MediaPipe Pose Landmarker), smoothing, rep detection, and form checks (depth, knee tracking, torso angle, heel lift, asymmetry).
- **Privacy-first:** Raw video never leaves the device.
- **Backend:** Stateless API; optional Backboard integration for set-level coaching.
- **UI:** Dark mode, live skeleton overlay, **live** and rep-based status cards (OK / Watch / Flag), coach panel.

## Quick start

### Backend (FastAPI)

```bash
cd backend
cp .env.example .env
# Edit .env and set BACKBOARD_API_KEY if you have one (optional; fallback message shown otherwise).
pip install -r requirements.txt
uvicorn app.main:app --reload --port 3001
```

Runs at `http://localhost:3001`. Endpoints:

- `GET /api/health` — health check
- `POST /api/coach/rep` — optional single-rep cue (stub)
- `POST /api/coach/set` — set summary → AI coaching (uses Backboard when key is set)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173` and proxies `/api` to the backend.

1. Allow camera access and click **Start camera**.
2. Click **Calibrate & start**, then **Start analysis**.
3. Perform squats (full body in frame, 3/4 or side view).
4. After one or more reps, click **Get coach feedback** for the set-level AI summary.

## Camera setup (recommended)

- **Angle:** 3/4 front or side; side for depth/torso, 3/4 for knee tracking and symmetry.
- **Framing:** Full body including feet, knees, hips, shoulders.
- **Lighting:** Even; avoid strong backlight.

## Configuration

- **Backend:** `backend/.env` — `BACKBOARD_API_KEY`, `BACKBOARD_BASE_URL`, optional `BACKBOARD_MODEL`. Port is set via uvicorn (`--port 3001`).
- **Frontend:** Thresholds and FPS in `frontend/src/constants.ts`.

## How reps are detected

See **docs/PIPELINE.md** for the full flow (pose → smoothing → rep detection → form checks) and why reps might not increment.

## Unclear / optional items

See **SPEC_NOTES.md** for decisions and extension points (Backboard API shape, rep segmentation tuning, live vs rep-based feedback, optional session store, worker-based inference).

## Tech stack

- **Frontend:** React, TypeScript, Vite, `@mediapipe/tasks-vision` (Pose Landmarker). **Live** form checks use a rolling window (~0.75 s).
- **Backend:** Python, FastAPI, httpx (Backboard client). No database.
