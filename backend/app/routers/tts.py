"""Coach voice: ElevenLabs text-to-speech with a cache, rationing and a safe fallback.

Every distinct (voice, line) is generated once, stored in the database, and served from
there afterwards — so reps never wait on the API and the free-tier characters aren't
burnt twice. If the key is missing, the ration is spent, or ElevenLabs errors, the
frontend falls back to the browser's built-in voice.
"""
import hashlib
import logging

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import db, usage
from ..auth import User
from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tts", tags=["voice"])

MODEL = "eleven_flash_v2_5"  # lowest latency; cues are short
FORMAT = "mp3_22050_32"


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    persona: str = Field(default="calm", pattern="^(calm|hype)$")


def _voice(persona: str) -> str:
    return settings.elevenlabs_voice_id_hype if persona == "hype" else settings.elevenlabs_voice_id_calm


@router.post("")
def tts(body: TtsIn, user_id: str = User) -> Response:
    if db.pool is None:
        raise HTTPException(503, "database not configured")
    voice = _voice(body.persona)
    if not settings.elevenlabs_api_key or not voice:
        raise HTTPException(503, "voice not configured")
    key = hashlib.sha256(f"{voice}|{MODEL}|{body.text}".encode()).hexdigest()
    with db.pool.connection() as c:
        row = c.execute("SELECT audio FROM tts_cache WHERE key = %s", (key,)).fetchone()
    if row:
        return Response(bytes(row[0]), media_type="audio/mpeg", headers={"X-Tts-Cache": "hit"})

    if not usage.spend("tts_chars", user_id, len(body.text)):
        raise HTTPException(429, "daily voice allowance used up")
    try:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
            params={"output_format": FORMAT},
            headers={"xi-api-key": settings.elevenlabs_api_key},
            json={"text": body.text, "model_id": MODEL},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("elevenlabs failed: %s", e)
        raise HTTPException(502, "voice service unavailable")
    audio = r.content
    with db.pool.connection() as c:
        c.execute("INSERT INTO tts_cache (key, voice_id, text, audio) VALUES (%s, %s, %s, %s) ON CONFLICT (key) DO NOTHING", (key, voice, body.text, audio))
    return Response(audio, media_type="audio/mpeg", headers={"X-Tts-Cache": "miss"})
