"""ffmpeg steps: read the upload, split it into a silent 30 fps video and a mono audio track."""
import json
import subprocess
from pathlib import Path

FPS = 30


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    info = json.loads(out)
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise ValueError("no video stream")
    return {
        "duration": float(info["format"]["duration"]),
        "width": int(video["width"]),
        "height": int(video["height"]),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def split(src: Path, workdir: Path) -> tuple[Path, Path | None]:
    """Returns (silent 30 fps video, mono 22.05 kHz WAV or None)."""
    video = workdir / "video.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-an", "-vf", f"fps={FPS},scale='min(960,iw)':-2",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", str(video)],
        check=True,
    )
    audio = workdir / "audio.wav"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "22050", str(audio)])
    return video, (audio if r.returncode == 0 and audio.exists() else None)
