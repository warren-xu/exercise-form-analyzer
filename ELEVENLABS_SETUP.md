# ElevenLabs TTS Integration

This application now automatically reads out coaching feedback using ElevenLabs AI voices.

## Setup

### 1. Get an ElevenLabs API Key

1. Sign up for a free account at [elevenlabs.io](https://elevenlabs.io/)
2. Go to your account settings and copy your API key
3. Add it to `backend/.env`:

```dotenv
ELEVENLABS_API_KEY=your_api_key_here
```

### 2. (Optional) Change the Voice

By default, the app uses "Rachel" voice. To use a different voice:

1. Get a voice ID from [ElevenLabs voice list](https://docs.elevenlabs.io/voices/pre-made-voices)
2. Add it to `backend/.env`:

```dotenv
ELEVENLABS_VOICE_ID=your_voice_id_here
```

Popular voice options:
- **EXAVITQu4vr4xnSDxMaL** - Rachel (default, energetic & clear)
- **EXAVITQu4vr4xnSDxMaL** - Bella (warm & encouraging)
- **21m00Tcm4TlvDq8ikWAM** - George (professional & calm)

See all available voices: https://docs.elevenlabs.io/voices

### 3. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

## How It Works

When you complete a set and click **"Get coach feedback"**:

1. The backend receives the form data and queries Backboard.io for AI coaching feedback
2. The coaching summary and cues are automatically sent to ElevenLabs TTS
3. The audio is generated and played in the browser simultaneously with displaying the text
4. The voice reads out your personalized coaching tips

## File Changes

### Backend
- **`requirements.txt`** - Added `elevenlabs>=0.2.0`
- **`.env.example`** - Added ElevenLabs configuration
- **`app/tts.py`** - New module for TTS conversion using ElevenLabs API
- **`app/main.py`** - New endpoint `POST /api/tts` to generate audio
- **`app/schemas.py`** - Added `TTSRequest` schema

### Frontend
- **`src/elevenlabs.ts`** - New utility module for TTS client
- **`src/App.tsx`** - Added audio playback trigger when feedback is received

## Architecture

```
Coach Feedback Received (App.tsx)
         ↓
  useEffect triggered
         ↓
extractSummary + cues
         ↓
generateAndPlayAudio() (elevenlabs.ts)
         ↓
POST /api/tts with text
         ↓
Backend TTS conversion (elevenlabs.py)
         ↓
ElevenLabs API call
         ↓
MP3 response
         ↓
Browser playback
```

## Features

- ✅ Automatic playback when feedback is received
- ✅ Combines summary and all cues into one audio
- ✅ Only plays if ElevenLabs API is configured
- ✅ Gracefully handles errors (app still works without TTS)
- ✅ Stops previous audio before playing new feedback

## Troubleshooting

**Audio doesn't play:**
- Check that `ELEVENLABS_API_KEY` is set in `backend/.env`
- Check browser console (F12 → Console) for error messages
- Verify your API key is valid at [elevenlabs.io](https://elevenlabs.io/)

**API errors:**
- "API key not configured" → Set `ELEVENLABS_API_KEY` in `.env`
- "Failed to connect" → Check your internet connection
- Rate limit errors → ElevenLabs free tier has usage limits

**Audio quality:**
- Adjust voice stability/similarity in `app/tts.py` (stability: 0-1, similarity_boost: 0-1)
- Change the voice ID for different tones and accents
