"""
FastAPI backend: health + coach endpoints + session history.
"""
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware

from .backboard import get_set_coach_response
from .database import connect_to_mongo, close_mongo_connection, get_sessions_collection
from .models import SessionModel, SessionResponse, RepData
from .schemas import (
    AssistantOutput,
    RepCueResponse,
    SetSummaryRequest,
    RepSummaryRequest,
    ErrorDetail,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await connect_to_mongo()
    yield
    await close_mongo_connection()


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


@app.get("/api/debug/config")
async def debug_config():
    """Debug endpoint to check if API keys are loaded"""
    import os
    return {
        "BACKBOARD_API_KEY_SET": bool(os.getenv("BACKBOARD_API_KEY")),
        "BACKBOARD_API_KEY_FIRST_10": os.getenv("BACKBOARD_API_KEY", "NOT_SET")[:10],
        "BACKBOARD_BASE_URL": os.getenv("BACKBOARD_BASE_URL"),
        "MONGODB_URL_SET": bool(os.getenv("MONGODB_URL")),
        "MONGODB_DB_NAME": os.getenv("MONGODB_DB_NAME"),
    }


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
async def coach_set(body: SetSummaryRequest, authorization: str = Header(None)):
    """Set summary coaching. Calls Backboard assistant and saves session."""
    try:
        output = await get_set_coach_response(
            rep_count=body.rep_count,
            reps=[r.model_dump() for r in body.reps],
            set_level_summary=body.set_level_summary.model_dump() if body.set_level_summary is not None else None,
        )
        
        # Save session to MongoDB if user is authenticated
        if authorization and authorization.startswith('Bearer '):
            try:
                # Extract user info from header (in production, validate JWT)
                # For now, we'll accept a simple user_id from frontend
                sessions = get_sessions_collection()
                session_data = SessionModel(
                    user_id=authorization.replace('Bearer ', ''),
                    session_id=body.session_id,
                    rep_count=body.rep_count,
                    reps=[RepData(**r.model_dump()) for r in body.reps],
                    assistant_feedback=output.model_dump(),
                    set_level_summary=body.set_level_summary.model_dump() if body.set_level_summary else None,
                )
                await sessions.insert_one(session_data.model_dump())
            except Exception as db_error:
                print(f"Failed to save session to DB: {db_error}")
        
        return output
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=str(e),
        )


@app.get(
    "/api/history",
    response_model=List[SessionResponse],
)
async def get_user_history(authorization: str = Header(None), limit: int = 10):
    """Get user's session history"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    user_id = authorization.replace('Bearer ', '')
    sessions = get_sessions_collection()
    
    cursor = sessions.find(
        {"user_id": user_id}
    ).sort("timestamp", -1).limit(limit)
    
    results = []
    async for doc in cursor:
        results.append(SessionResponse(
            id=str(doc["_id"]),
            user_id=doc["user_id"],
            user_email=doc.get("user_email"),
            session_id=doc["session_id"],
            timestamp=doc["timestamp"],
            rep_count=doc["rep_count"],
            assistant_feedback=doc.get("assistant_feedback"),
        ))
    
    return results


@app.delete("/api/history/{session_id}")
async def delete_session(session_id: str, authorization: str = Header(None)):
    """Delete a specific session"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    user_id = authorization.replace('Bearer ', '')
    sessions = get_sessions_collection()
    
    result = await sessions.delete_one({
        "session_id": session_id,
        "user_id": user_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"status": "deleted", "session_id": session_id}
