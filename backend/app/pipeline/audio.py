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


def motion_grid(speed: np.ndarray, fps: float, duration: float) -> dict:
    """No music: find the beat from the dancer's own movement.

    1. Where the dance is: from when the movement starts to when it stops (standing still before
       or after isn't part of the routine).
    2. The pulse: the repeating rhythm in hand/foot movement onsets (autocorrelation, 55-170 BPM).
    3. Counts: the dancing part holds a whole number of 4-count bars at that pulse."""
    s = np.nan_to_num(np.asarray(speed, dtype=float))
    period = 0.6
    start, end = 0.0, duration
    if len(s) > fps:
        k = max(1, int(fps * 0.2))
        smooth = np.convolve(s, np.ones(k) / k, mode="same")
        moving = np.flatnonzero(smooth > 0.35 * np.percentile(smooth, 90))
        if len(moving):
            start = max(0.0, moving[0] / fps - 0.1)
            end = min(duration, moving[-1] / fps + 0.1)
        seg = s[int(start * fps) : int(end * fps) + 1]
        if len(seg) > 2 * fps * 60 / 170:
            k = max(1, int(fps * 0.1))
            sm = np.convolve(seg, np.ones(k) / k, mode="same")
            onset = np.maximum(0, np.diff(sm, prepend=sm[0]))
            onset -= onset.mean()
            ac = np.correlate(onset, onset, mode="full")[len(onset) - 1:]
            if ac[0] > 0:
                ac = ac / ac[0]
                lo, hi = int(fps * 60 / 170), min(int(fps * 60 / 55), len(ac) - 1)
                if hi > lo:
                    lag = lo + int(np.argmax(ac[lo:hi]))
                    if ac[lag] > 0.15:  # a real pulse, not noise
                        period = lag / fps
    span = max(end - start, 0.5)
    total = max(4, 4 * round(span / period / 4))  # whole 4-count bars over the dancing part
    beat = span / total
    # Phase: slide the grid (up to half a beat) so the counts land where moves start.
    if len(s) > fps:
        onset_all = np.maximum(0, np.diff(np.convolve(s, np.ones(3) / 3, mode="same"), prepend=s[0]))
        def fit(shift: float) -> float:
            idx = [int(round((start + shift + i * beat) * fps)) for i in range(total)]
            return float(sum(onset_all[max(0, j - 2) : j + 3].max(initial=0) for j in idx if 0 <= j < len(onset_all)))
        shifts = np.linspace(-0.5 * beat, 0.5 * beat, 11)
        best = max(shifts, key=fit)
        start = float(np.clip(start + best, 0.0, max(0.0, duration - total * beat)))
    beats = [round(start + i * beat, 3) for i in range(total)]
    return {"tempo": round(60 / beat, 1), "beats": beats, "downbeats": beats[::4], "fingerprint": None, "source": "movement",
            "end": round(start + total * beat, 3)}


def eight_counts(beats: list[float], downbeats: list[float], duration: float, end: float | None = None) -> list[dict]:
    """Cut the beat grid into phrases from the first downbeat: 8-counts where there are 8 beats,
    a 4-count for a leftover bar (or a routine that's only one bar long). Each phrase has its start,
    end and the real time of every count."""
    start = downbeats[0] if downbeats else 0.0
    bs = [b for b in beats if start - 1e-6 <= b < duration]
    if not bs:
        return [{"start": 0.0, "end": round(duration, 3), "counts": [0.0]}]
    gap = float(np.median(np.diff(bs))) if len(bs) > 1 else duration
    out = []
    i = 0
    while i < len(bs):
        left = len(bs) - i
        n = 8 if left >= 8 else 4 if left >= 4 else left
        if n < 4 and out:
            break  # a few stray beats at the very end: not a phrase
        counts = bs[i : i + n]
        last = bs[i + n] if i + n < len(bs) else min(duration, end if end is not None else counts[-1] + gap)
        end_t = last
        out.append({"start": round(counts[0], 3), "end": round(end_t, 3), "counts": [round(c, 3) for c in counts]})
        i += n
    return out
