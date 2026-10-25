"""Mic sync: find where in the song a few seconds of microphone audio are.

The learner plays their own copy of the song; the app records a short snippet through the
mic and matches its chroma + onset features against the routine's stored fingerprint
(audio.fingerprint, ~10 frames a second). Only the fingerprint is ever stored; the snippet
is matched in memory and dropped.
"""
import librosa
import numpy as np

from .audio import FP_HOP, SR

FPS = SR / FP_HOP  # fingerprint frames per second (10)


def _features(y: np.ndarray) -> np.ndarray:
    chroma = librosa.feature.chroma_stft(y=y, sr=SR, hop_length=FP_HOP)
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=FP_HOP)[None, :]
    onset = onset / (onset.max() or 1)
    t = min(chroma.shape[1], onset.shape[1])
    return np.vstack([chroma[:, :t], onset[:, :t]]).T  # T × 13


def _prep(f: np.ndarray, chroma_mean: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Mean-centred, unit-length chroma per frame (so 'all notes a bit on' doesn't match everything),
    and a z-scored onset curve."""
    c = f[:, :12] - chroma_mean
    c = c / (np.linalg.norm(c, axis=1, keepdims=True) + 1e-6)
    o = f[:, 12]
    o = (o - o.mean()) / (o.std() + 1e-6)
    return c, o


def locate(fingerprint: bytes, snippet: np.ndarray) -> dict:
    """snippet: mono float32 at SR. Returns {"position": song time (s) at the END of the snippet,
    "confidence": 0..1}. Confidence is how far the best match stands out from the next best one."""
    song = np.frombuffer(fingerprint, dtype=np.uint8).reshape(-1, 13).astype(np.float32) / 255
    mic = _features(snippet.astype(np.float32))
    n = len(mic)
    if n < 20 or len(song) < n + 1:
        return {"position": None, "confidence": 0.0}
    chroma_mean = song[:, :12].mean(axis=0)
    sc, so = _prep(song, chroma_mean)
    mc, mo = _prep(mic, chroma_mean)
    lags = len(song) - n + 1
    scores = np.empty(lags, dtype=np.float32)
    for k in range(lags):
        chroma_sim = float(np.mean(np.sum(sc[k : k + n] * mc, axis=1)))
        win = so[k : k + n]
        onset_sim = float(np.mean((win - win.mean()) / (win.std() + 1e-6) * mo))
        scores[k] = 0.7 * chroma_sim + 0.3 * onset_sim
    best = int(np.argmax(scores))
    # Runner-up at least 1.5 s away from the best match.
    away = np.abs(np.arange(lags) - best) > 1.5 * FPS
    second = float(scores[away].max()) if away.any() else -1.0
    margin = float(scores[best] - second)
    confidence = float(np.clip(margin / 0.15, 0, 1)) if scores[best] > 0.2 else 0.0
    return {"position": round((best + n - 1) / FPS, 2), "confidence": round(confidence, 2)}
