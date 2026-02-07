"""
Backboard.io assistant client.
Converts structured squat analysis into human-like coaching via Backboard API.
See https://app.backboard.io/docs — base URL and key must be configured (env).
"""
import json
import os
import re
import httpx

from .schemas import AssistantOutput


DEFAULT_BASE = "https://app.backboard.io/api"


def _get_config() -> tuple[str | None, str]:
    api_key = os.environ.get("BACKBOARD_API_KEY")
    base_url = (os.environ.get("BACKBOARD_BASE_URL") or DEFAULT_BASE).rstrip("/")
    return api_key, base_url


def _build_set_coach_message(
    rep_count: int,
    reps: list,
    set_level_summary: dict | None = None,
) -> str:
    payload = {
        "rep_count": rep_count,
        "reps": reps,
        "set_level_summary": set_level_summary or {},
    }
    return (
        f"Squat set summary: {rep_count} reps.\n"
        "Per-rep and set-level analysis (JSON):\n"
        f"{json.dumps(payload)}"
    )


def _parse_assistant_output(raw: str) -> AssistantOutput:
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


async def get_set_coach_response(
    rep_count: int,
    reps: list,
    set_level_summary: dict | None = None,
) -> AssistantOutput:
    api_key, base_url = _get_config()
    if not api_key:
        return AssistantOutput(
            summary="Backboard API key is not configured. Set BACKBOARD_API_KEY to enable AI coaching.",
            cues=["Configure BACKBOARD_API_KEY in the backend to get personalized cues."],
            safety_note="This is a form feedback tool only; reduce load if you feel pain or instability.",
            confidence_note="Keep feet and knees visible in frame for best tracking.",
        )

    content = _build_set_coach_message(rep_count, reps, set_level_summary)
    model = os.environ.get("BACKBOARD_MODEL", "gpt-4o-mini")
    data = {
        "model_name": model,
        "memory": "off",
        "web_search": "off",
        "send_to_llm": "true",
        "content": content,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{base_url}/v1/chat",
            headers={"X-API-Key": api_key},
            data=data,
        )

    if response.status_code != 200:
        raise RuntimeError(f"Backboard API error {response.status_code}: {response.text}")

    body = response.json()
    raw = (
        (body.get("message") or {}).get("content")
        or body.get("content")
        or ""
    )
    return _parse_assistant_output(raw)
