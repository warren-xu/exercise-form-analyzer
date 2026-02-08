/**
 * ElevenLabs text-to-speech client.
 * Converts coaching feedback text to audio and plays it.
 */

const API_BASE = '/api';

/**
 * Generate audio from text via the backend TTS endpoint.
 * Returns the audio as a Blob that can be played.
 */
export async function generateAudio(
  text: string,
  voiceId?: string,
): Promise<Blob | null> {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('TTS error:', error);
      return null;
    }

    return await response.blob();
  } catch (error) {
    console.error('Failed to generate audio:', error);
    return null;
  }
}

/**
 * Play an audio blob.
 * Automatically stops any currently playing audio before starting a new one.
 */
let currentAudio: HTMLAudioElement | null = null;

export function playAudio(blob: Blob): void {
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
  };
  audio.onerror = () => {
    console.error('Audio playback error');
    URL.revokeObjectURL(url);
  };

  currentAudio = audio;
  audio.play().catch((err) => console.error('Failed to play audio:', err));
}

/**
 * Generate and play audio from text.
 * Combines generateAudio and playAudio.
 */
export async function generateAndPlayAudio(
  text: string,
  voiceId?: string,
): Promise<void> {
  const blob = await generateAudio(text, voiceId);
  if (blob) {
    playAudio(blob);
  }
}

/**
 * Stop any currently playing audio.
 */
export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}
