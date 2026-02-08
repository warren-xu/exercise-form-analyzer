"""
MongoDB models for session and feedback storage
"""
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime, timezone

class RepData(BaseModel):
    """Individual rep data"""
    rep_index: int
    confidence: dict
    checks: dict

class SessionModel(BaseModel):
    """Session data model for MongoDB"""
    user_id: str = Field(..., description="Auth0 user ID")
    user_email: Optional[str] = None
    session_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    rep_count: int
    reps: List[RepData]
    assistant_feedback: Optional[dict] = None
    set_level_summary: Optional[dict] = None

class SessionResponse(BaseModel):
    """Response model for session data"""
    id: str
    user_id: str
    user_email: Optional[str] = None
    session_id: str
    timestamp: datetime
    rep_count: int
    assistant_feedback: Optional[dict] = None
