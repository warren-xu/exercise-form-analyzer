"""
Data contracts per spec §11.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Severity = Literal["low", "moderate", "high"]


class RepCheck(BaseModel):
    severity: Severity
    evidence: dict[str, Optional[float]] = Field(default_factory=dict)


class RepSummaryRequest(BaseModel):
    session_id: str
    rep_index: int
    confidence: dict
    checks: dict[str, RepCheck]


class SetLevelSummary(BaseModel):
    worst_issues: Optional[list[str]] = None
    trends: Optional[list[str]] = None
    consistency_note: Optional[str] = None


class SetSummaryRequest(BaseModel):
    session_id: str
    rep_count: int
    reps: list[RepSummaryRequest]
    set_level_summary: Optional[SetLevelSummary] = None


class AssistantOutput(BaseModel):
    summary: str
    cues: list[str]
    safety_note: str
    confidence_note: Optional[str] = None


class RepCueResponse(BaseModel):
    cue: str


class ErrorDetail(BaseModel):
    error: str
    detail: Optional[str] = None
