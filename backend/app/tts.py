"""
ElevenLabs text-to-speech integration.
Converts coaching feedback text to audio using ElevenLabs API.
"""
import os

import httpx

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")  # Rachel
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"

print(f"[TTS] API Key configured: {bool(ELEVENLABS_API_KEY)}")
print(f"[TTS] API Key length: {len(ELEVENLABS_API_KEY) if ELEVENLABS_API_KEY else 0}")
print(f"[TTS] Voice ID: {ELEVENLABS_VOICE_ID}")


async def text_to_speech(text: str, voice_id: str | None = None) -> bytes | None:
    """
    Convert text to speech using ElevenLabs API.
    Returns MP3 audio bytes, or None if API key is not configured.
    
    Args:
        text: The text to convert to speech
        
    Returns:
        MP3 audio bytes, or None if not configured
    """
    if not ELEVENLABS_API_KEY:
        return None
    
    if not text or not text.strip():
        return None
    
    resolved_voice_id = voice_id or ELEVENLABS_VOICE_ID
    url = f"{ELEVENLABS_BASE_URL}/text-to-speech/{resolved_voice_id}"
    
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
    }
    
    payload = {
        "text": text,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
        "model_id": "eleven_flash_v2",
    }
    
    #return None  # COMMENT OUT THIS LINE TO ENABLE TTS
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            print(f"[TTS] ElevenLabs response status: {response.status_code}")
            if response.status_code != 200:
                error_text = response.text[:500]
                print(f"[TTS] ElevenLabs error: {error_text}")
            response.raise_for_status()
            return response.content
    except httpx.HTTPError as e:
        print(f"[TTS] ElevenLabs HTTP error: {e}")
        return None
    except Exception as e:
        print(f"[TTS] Unexpected error: {e}")
        return None
