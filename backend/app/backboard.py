"""
Backboard.io assistant client using the official SDK.
Sends structured squat form data to an assistant and returns coaching output.
See https://app.backboard.io/docs
"""
import json
import os
import re

from backboard import BackboardClient
from backboard import (
    BackboardAPIError,
    BackboardValidationError,
    BackboardNotFoundError,
)

from .schemas import AssistantOutput

# Encouraging check-in during the live set (e.g. every 10 reps).
COACH_SYSTEM_PROMPT_CHECK_IN = """You are a supportive gym coach checking in during the user's set. Your role is to:
1. Check in with the user and encourage them.
2. Give brief, actionable advice based on the single most critical issue provided (depth, knee tracking, torso angle, heel lift, or asymmetry).
3. Keep responses short and motivating, starting out with a small positive message like "Great job!" followed by a short sentence describing the advice.

Respond in JSON only, with the key: summary, do not include safety_note. Do not mention safety_note, tracking confidence, camera, or visibility. No markdown, no code fence."""

# Full set summary when the user ends the session (squats).
COACH_SYSTEM_PROMPT_SET_SUMMARY = """You are a concise gym coach. The user has finished their squat set and wants a session summary. You receive structured form analysis (depth, knee tracking, torso angle, heel lift, asymmetry) for each rep; per-rep confidence may include rep_duration_sec (seconds per rep) for tempo/speed feedback. Your role is to:
1. Give a 1–2 sentence overall takeaway for the set.
2. Provide 2–4 prioritized, actionable cues for the next session.
3. Be direct and helpful; no fluff.

Respond in JSON only, with keys: summary, cues (array of 2–4 short phrases), safety_note. Do not mention tracking confidence, camera, or visibility. No markdown, no code fence."""

# Pushup: same response shape; checks map to pushup metrics (depth=elbow ROM, knee_tracking=shoulder stability, torso_angle=plank alignment, heel_lift=hip stability, asymmetry=L-R).
COACH_SYSTEM_PROMPT_PUSHUP_CHECK_IN = """You are a supportive gym coach checking in during the user's pushup set. Your role is to:
1. Check in with the user and encourage them.
2. Give brief, actionable advice based on the single most critical issue provided: depth (elbow range of motion), shoulder stability (level shoulders), body alignment (plank), hip stability (no sag/pike), or asymmetry (left-right balance).
3. Keep responses short and motivating, starting out with a small positive message like "Great job!" followed by a short sentence describing the advice.

Respond in JSON only, with key: summary, do not include safety_note. Do not mention, tracking confidence, camera, or visibility. No markdown, no code fence."""

COACH_SYSTEM_PROMPT_PUSHUP_SET_SUMMARY = """You are a concise gym coach. The user has finished their pushup set and wants a session summary. You receive structured form analysis for each rep: depth (elbow ROM), shoulder stability, body alignment, hip stability, asymmetry; per-rep confidence may include rep_duration_sec (seconds per rep) for tempo/speed feedback. Your role is to:
1. Give a 1–2 sentence overall takeaway for the set.
2. Provide 2–4 prioritized, actionable cues for the next session.
3. Be direct and helpful; no fluff.

Respond in JSON only, with keys: summary, cues (array of 2–4 short phrases), safety_note. Do not mention tracking confidence, camera, or visibility. No markdown, no code fence."""


def _build_set_coach_message(
    rep_count: int,
    reps: list,
    set_level_summary: dict | None = None,
    exercise_type: str = "squat",
) -> str:
    """Build the user message containing form data for the assistant."""
    payload = {
        "rep_count": rep_count,
        "reps": reps,
        "set_level_summary": set_level_summary or {},
    }
    label = "Pushup" if exercise_type == "pushup" else "Squat"
    return (
        f"{label} set summary: {rep_count} reps.\n"
        "Per-rep and set-level analysis (JSON):\n"
        f"{json.dumps(payload)}"
    )


def _parse_assistant_output(raw: str) -> AssistantOutput:
    """Parse assistant reply (JSON or plain text) into AssistantOutput."""
    trimmed = raw.strip()
    json_match = re.search(r"\{[\s\S]*\}", trimmed)
    if json_match:
        try:
            p = json.loads(json_match.group(0))
            if isinstance(p, dict):
                return AssistantOutput(
                    summary=p.get("summary", "Form analysis complete."),
                    cues=p.get("cues", []) or [],
                    safety_note=p.get("safety_note", "Listen to your body; reduce load if needed."),
                    confidence_note=p.get("confidence_note"),
                )
        except (json.JSONDecodeError, TypeError):
            pass
    return AssistantOutput(
        summary=trimmed or "Form analysis complete.",
        cues=[],
        safety_note="Listen to your body; reduce load if needed.",
    )


def _fallback_output(reason: str, detail: str = "") -> AssistantOutput:
    return AssistantOutput(
        summary=reason,
        cues=[
            "Check BACKBOARD_API_KEY in backend/.env.",
            "See app.backboard.io/docs if the error persists.",
        ],
        safety_note="Form feedback is still available from the status cards.",
        confidence_note=detail or None,
    )


def _get_system_prompt(coach_mode: str, exercise_type: str = "squat") -> str:
    if exercise_type == "pushup":
        if coach_mode == "check_in":
            return COACH_SYSTEM_PROMPT_PUSHUP_CHECK_IN
        return COACH_SYSTEM_PROMPT_PUSHUP_SET_SUMMARY
    if coach_mode == "check_in":
        return COACH_SYSTEM_PROMPT_CHECK_IN
    return COACH_SYSTEM_PROMPT_SET_SUMMARY


async def get_set_coach_response(
    rep_count: int,
    reps: list,
    set_level_summary: dict | None = None,
    coach_mode: str = "set_summary",
    exercise_type: str = "squat",
) -> AssistantOutput:
    api_key = os.environ.get("BACKBOARD_API_KEY")
    print(f"[DEBUG] BACKBOARD_API_KEY loaded: {bool(api_key)}")
    print(f"[DEBUG] API Key first 10 chars: {api_key[:10] if api_key else 'NONE'}")
    
    if not api_key:
        print("[DEBUG] API key is missing!")
        return AssistantOutput(
            summary="Backboard API key is not configured. Set BACKBOARD_API_KEY to enable AI coaching.",
            cues=["Configure BACKBOARD_API_KEY in the backend to get personalized cues."],
            safety_note="This is a form feedback tool only; reduce load if you feel pain or instability.",
            confidence_note="Keep feet and knees visible in frame for best tracking.",
        )

    content = _build_set_coach_message(
        rep_count, reps, set_level_summary, exercise_type
    )
    llm_provider = os.environ.get("BACKBOARD_LLM_PROVIDER", "openai")
    model_name = os.environ.get("BACKBOARD_MODEL", "gpt-4o-mini")
    system_prompt = _get_system_prompt(coach_mode, exercise_type)

    try:
        client = BackboardClient(api_key=api_key)

        assistant = await client.create_assistant(
            name="RepRight Form Coach",
            system_prompt=system_prompt,
        )

        thread = await client.create_thread(assistant.assistant_id)

        response = await client.add_message(
            thread_id=thread.thread_id,
            content=content,
            llm_provider=llm_provider,
            model_name=model_name,
            stream=False,
        )
        print(f"[DEBUG] Message response received: {type(response)}")

        raw = getattr(response, "content", None) or ""
        print(f"[DEBUG] Response content: {raw[:100]}")
        return _parse_assistant_output(raw)

    except (BackboardNotFoundError, BackboardValidationError, BackboardAPIError) as e:
        print(f"[DEBUG] Backboard API error: {type(e).__name__}: {e}")
        return _fallback_output(
            f"Backboard API error: {e!s}",
            detail=str(e),
        )
    except Exception as e:
        print(f"[DEBUG] Unexpected error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return _fallback_output(
            "Could not get coach response from Backboard.",
            detail=str(e),
        )
