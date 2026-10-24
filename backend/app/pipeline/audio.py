"""Music → beat grid and a coarse fingerprint. The recording itself is never kept."""
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 512
# Fingerprint: 12 chroma bins + onset strength, ~10 times a second, stored as bytes.
FP_HOP = 2205


def beat_grid(wav: Path | None, duration: float) -> dict:
    """Beats, downbeats (bar starts, 4/4) and tempo. Without usable music, an even 100 BPM grid."""
    if wav is not None:
        y, _ = librosa.load(wav, sr=SR, mono=True)
        if np.sqrt(np.mean(y**2)) > 0.005:
            onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
            tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=HOP, units="frames")
            beats = librosa.frames_to_time(frames, sr=SR, hop_length=HOP)
            if len(beats) >= 16:
                # Downbeats: of the four possible bar phases, the one whose beats have the strongest onsets.
                strength = onset[np.clip(frames, 0, len(onset) - 1)]
                phase = int(np.argmax([strength[p::4].mean() for p in range(4)]))
                return {
                    "tempo": float(np.atleast_1d(tempo)[0]),
                    "beats": beats.round(3).tolist(),
                    "downbeats": beats[phase::4].round(3).tolist(),
                    "fingerprint": fingerprint(y),
                    "source": "music",
                }
    step = 60 / 100
    beats = np.arange(0, duration, step)
    return {"tempo": 100.0, "beats": beats.round(3).tolist(), "downbeats": beats[::4].round(3).tolist(), "fingerprint": None, "source": "default"}


def fingerprint(y: np.ndarray) -> bytes:
    chroma = librosa.feature.chroma_stft(y=y, sr=SR, hop_length=FP_HOP)  # 12 × T
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=FP_HOP)[None, :]
    onset = onset / (onset.max() or 1)
    t = min(chroma.shape[1], onset.shape[1])
    feats = np.vstack([chroma[:, :t], onset[:, :t]])  # 13 × T, values 0..1
    return (feats.T * 255).astype(np.uint8).tobytes()


def eight_counts(downbeats: list[float], duration: float) -> list[dict]:
    """Two 4/4 bars = one 8-count. Each has its start, end and the time of every count."""
    out = []
    bars = downbeats + [duration]
    for i in range(0, len(bars) - 2, 2):
        start, mid, end = bars[i], bars[i + 1], bars[i + 2]
        counts = list(np.linspace(start, mid, 4, endpoint=False)) + list(np.linspace(mid, end, 4, endpoint=False))
        out.append({"start": round(start, 3), "end": round(end, 3), "counts": [round(c, 3) for c in counts]})
    return out
