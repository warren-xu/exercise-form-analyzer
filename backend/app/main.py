"""
FastAPI backend: health + coach endpoints + session history.
"""
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Header
import base64
import json
from typing import Optional
from datetime import timezone
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .backboard import get_set_coach_response
from .database import connect_to_mongo, close_mongo_connection, get_sessions_collection
from .models import SessionModel, SessionResponse, RepData
from .tts import text_to_speech
from .schemas import (
    AssistantOutput,
    RepCueResponse,
    SetSummaryRequest,
    RepSummaryRequest,
    ErrorDetail,
    TTSRequest,
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


def _base64url_decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def extract_user_id(authorization: str) -> str:
    """Extract stable user id from Auth0 JWT if possible, else fall back to raw token."""
    token = authorization.replace('Bearer ', '')
    parts = token.split('.')
    if len(parts) != 3:
        return token
    try:
        payload = json.loads(_base64url_decode(parts[1]).decode('utf-8'))
        return payload.get('sub', token)
    except Exception:
        return token


def resolve_user_id(authorization: str, user_id_header: Optional[str]) -> str:
    """Prefer explicit user id header, else derive from authorization token."""
    if user_id_header:
        return user_id_header
    return extract_user_id(authorization)
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
async def coach_set(
    body: SetSummaryRequest,
    authorization: str = Header(None),
    user_id_header: Optional[str] = Header(None, alias="X-User-Id"),
):
    """Set summary coaching. Calls Backboard assistant and saves session."""
    print("\n" + "="*80)
    print("🎯 coach_set ENDPOINT HIT")
    print(f"🔍 Session ID: {body.session_id}")
    print(f"🔍 Rep count: {body.rep_count}")
    print(f"🔍 Authorization header present: {authorization is not None}")
    if authorization:
        print(f"🔍 Authorization header value: {authorization[:50]}...")
    else:
        print("⚠️ WARNING: No authorization header received!")
    print("="*80 + "\n")
    
    try:
        debug_logs = []
        debug_logs.append(f"Authorization header present: {authorization is not None}")
        debug_logs.append(f"User id header present: {user_id_header is not None}")
        
        output = await get_set_coach_response(
            rep_count=body.rep_count,
            reps=[r.model_dump() for r in body.reps],
            set_level_summary=body.set_level_summary.model_dump() if body.set_level_summary is not None else None,
            coach_mode=body.coach_mode,
            exercise_type=body.exercise_type,
        )
        
        print(f"✓ Got Backboard response: {output.summary[:50] if output.summary else 'No summary'}...")
        debug_logs.append("Got Backboard response successfully")
        
        saved_to_db = False
        db_session_id = None
        db_error_msg = None
        
        # Save session to MongoDB if user is authenticated
        if authorization and authorization.startswith('Bearer '):
            debug_logs.append(f"Authorization header valid (starts with 'Bearer ')")
            debug_logs.append(f"Attempting MongoDB save...")
            print(f"💾 Attempting to save session to MongoDB...")
            try:
                # Extract user info from header (in production, validate JWT)
                # For now, we'll accept a simple user_id from frontend
                user_id = resolve_user_id(authorization, user_id_header)
                print(f"💾 User ID: {user_id[:20]}...")
                debug_logs.append(f"User ID extracted: {user_id[:30]}...")
                
                sessions = get_sessions_collection()
                print(f"💾 Got sessions collection")
                debug_logs.append("Got MongoDB sessions collection")
                
                session_data = SessionModel(
                    user_id=user_id,
                    session_id=body.session_id,
                    rep_count=body.rep_count,
                    reps=[RepData(**r.model_dump()) for r in body.reps],
                    assistant_feedback=output.model_dump(),
                    set_level_summary=body.set_level_summary.model_dump() if body.set_level_summary else None,
                )
                print(f"💾 Created SessionModel")
                debug_logs.append("Created SessionModel")
                
                result = await sessions.insert_one(session_data.model_dump())
                print(f"✅ Session saved to MongoDB! ID: {result.inserted_id}")
                debug_logs.append(f"✅ SUCCESS! Saved to MongoDB with ID: {result.inserted_id}")
                saved_to_db = True
                db_session_id = str(result.inserted_id)
            except Exception as db_error:
                print(f"❌ Failed to save session to DB: {db_error}")
                import traceback
                traceback.print_exc()
                db_error_msg = str(db_error)
                debug_logs.append(f"❌ MongoDB save failed: {db_error_msg}")
        else:
            msg = "No authorization header" if not authorization else "Authorization header doesn't start with 'Bearer '"
            print(f"⚠️ {msg}, skipping DB save")
            debug_logs.append(f"⚠️ {msg}, skipping DB save")
        
        # Return output with DB save status
        return AssistantOutput(
            summary=output.summary,
            cues=output.cues,
            safety_note=output.safety_note,
            confidence_note=output.confidence_note,
            saved_to_db=saved_to_db,
            db_session_id=db_session_id,
            debug_info={
                "logs": debug_logs,
                "authorization_received": authorization is not None,
                "mongodb_attempted": authorization is not None and authorization.startswith('Bearer '),
                "error": db_error_msg
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=str(e),
        )


@app.get(
    "/api/history",
    response_model=List[SessionResponse],
)
async def get_user_history(
    authorization: str = Header(None),
    limit: int = 10,
    user_id_header: Optional[str] = Header(None, alias="X-User-Id"),
):
    """Get user's session history"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    token = authorization.replace('Bearer ', '')
    user_id = resolve_user_id(authorization, user_id_header)
    sessions = get_sessions_collection()
    
    results = []
    seen_ids = set()
    
    # Primary query: stable user id (sub) or raw token (legacy)
    cursor = sessions.find(
        {"user_id": {"$in": [user_id, token]}}
    ).sort("timestamp", -1).limit(limit)
    
    async for doc in cursor:
        doc_id = str(doc["_id"])
        seen_ids.add(doc_id)
        ts = doc["timestamp"]
        if getattr(ts, "tzinfo", None) is None:
            ts = ts.replace(tzinfo=timezone.utc)
        results.append(SessionResponse(
            id=doc_id,
            user_id=doc["user_id"],
            user_email=doc.get("user_email"),
            session_id=doc["session_id"],
            timestamp=ts,
            rep_count=doc["rep_count"],
            assistant_feedback=doc.get("assistant_feedback"),
        ))
    
    # Legacy recovery: decode stored JWTs and migrate user_id to sub
    if len(results) < limit:
        legacy_cursor = sessions.find(
            {"user_id": {"$nin": [user_id, token]}}
        ).sort("timestamp", -1).limit(limit * 3)
        async for doc in legacy_cursor:
            doc_user_id = doc.get("user_id")
            if not isinstance(doc_user_id, str):
                continue
            if doc_user_id.count('.') != 2:
                continue
            decoded_sub = extract_user_id(f"Bearer {doc_user_id}")
            if decoded_sub != user_id:
                continue
            doc_id = str(doc["_id"])
            if doc_id in seen_ids:
                continue
            await sessions.update_one(
                {"_id": doc["_id"]},
                {"$set": {"user_id": user_id}}
            )
            seen_ids.add(doc_id)
            ts = doc["timestamp"]
            if getattr(ts, "tzinfo", None) is None:
                ts = ts.replace(tzinfo=timezone.utc)
            results.append(SessionResponse(
                id=doc_id,
                user_id=user_id,
                user_email=doc.get("user_email"),
                session_id=doc["session_id"],
                timestamp=ts,
                rep_count=doc["rep_count"],
                assistant_feedback=doc.get("assistant_feedback"),
            ))
            if len(results) >= limit:
                break
    
    return results


@app.delete("/api/history/{session_id}")
async def delete_session(
    session_id: str,
    authorization: str = Header(None),
    user_id_header: Optional[str] = Header(None, alias="X-User-Id"),
):
    """Delete a specific session"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    token = authorization.replace('Bearer ', '')
    user_id = resolve_user_id(authorization, user_id_header)
    sessions = get_sessions_collection()
    
    result = await sessions.delete_one({
        "session_id": session_id,
        "user_id": {"$in": [user_id, token]}
    })
    
    if result.deleted_count == 0:
        # Legacy fallback: decode stored token in record
        doc = await sessions.find_one({"session_id": session_id})
        if doc:
            doc_user_id = doc.get("user_id")
            if isinstance(doc_user_id, str) and doc_user_id.count('.') == 2:
                decoded_sub = extract_user_id(f"Bearer {doc_user_id}")
                if decoded_sub == user_id:
                    await sessions.delete_one({"_id": doc["_id"]})
                    return {"status": "deleted", "session_id": session_id}
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"status": "deleted", "session_id": session_id}
@app.post(
    "/api/tts",
    responses={400: {"model": ErrorDetail}, 502: {"model": ErrorDetail}},
)
async def generate_audio(body: TTSRequest):
    """Generate audio from text using ElevenLabs."""
    try:
        audio_bytes = await text_to_speech(body.text, body.voice_id)
        if audio_bytes is None:
            raise HTTPException(
                status_code=502,
                detail="ElevenLabs API key not configured or TTS failed",
            )
        return StreamingResponse(
            iter([audio_bytes]),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=coaching-feedback.mp3"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=str(e),
        )
