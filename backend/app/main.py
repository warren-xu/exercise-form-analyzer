"""
FastAPI backend: health + coach endpoints (no DB).
"""
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .backboard import get_set_coach_response
from .schemas import (
    AssistantOutput,
    RepCueResponse,
    SetSummaryRequest,
    RepSummaryRequest,
    ErrorDetail,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield


app = FastAPI(
    title="Exercise Form Analyzer API",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "exercise-form-analyzer"}


@app.post(
    "/api/coach/rep",
    response_model=RepCueResponse,
    responses={400: {"model": ErrorDetail}},
)
async def coach_rep(body: RepSummaryRequest):
    """Optional: single-rep coaching (short cue). Stub; not wired to Backboard."""
    worst = next(
        ((k, c) for k, c in body.checks.items() if c.severity == "high"),
        (None, None),
    )
    if worst and worst[1]:
        k, c = worst
        cue = f"Watch: {k.replace('_', ' ')} — {str(c.evidence)[:80]}..."
    else:
        cue = "Rep looks good. Keep consistency."
    return RepCueResponse(cue=cue)


@app.post(
    "/api/coach/set",
    response_model=AssistantOutput,
    responses={400: {"model": ErrorDetail}, 502: {"model": ErrorDetail}},
)
async def coach_set(body: SetSummaryRequest):
    """Set summary coaching. Calls Backboard assistant."""
    try:
        output = await get_set_coach_response(
            rep_count=body.rep_count,
            reps=[r.model_dump() for r in body.reps],
            set_level_summary=body.set_level_summary.model_dump() if body.set_level_summary is not None else None,
        )
        return output
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=str(e),
        )
