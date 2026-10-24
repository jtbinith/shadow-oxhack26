"""Cut the routine into 8-counts and find repeats, key moments and difficulty."""
import numpy as np

from .features import bone_directions, limb_speed

SAMPLES = 32
REPEAT_DISTANCE = 0.08


def _slice(norm: np.ndarray, fps: float, start: float, end: float) -> np.ndarray:
    a = max(0, int(round(start * fps)))
    b = min(len(norm), int(round(end * fps)))
    return norm[a:b]


def _signature(seg: np.ndarray) -> np.ndarray | None:
    """Bone directions resampled to a fixed length, for comparing 8-counts with each other."""
    if len(seg) < 4:
        return None
    dirs = bone_directions(seg)
    idx = np.linspace(0, len(dirs) - 1, SAMPLES).round().astype(int)
    return dirs[idx]


def _distance(a: np.ndarray, b: np.ndarray) -> float:
    cos = np.nansum(a * b, axis=-1)  # SAMPLES × bones
    valid = ~np.isnan((a * b).sum(axis=-1))
    if valid.sum() < 0.5 * valid.size:
        return 1.0
    return float(np.mean(1 - cos[valid]))


def analyse(norm: np.ndarray, fps: float, counts: list[dict]) -> list[dict]:
    speed = limb_speed(norm, fps)
    sigs = [_signature(_slice(norm, fps, c["start"], c["end"])) for c in counts]
    mean_speed = float(np.nanmean(speed)) if np.isfinite(speed).any() else 0.0
    out = []
    for i, c in enumerate(counts):
        seg_speed = speed[max(0, int(c["start"] * fps)) : int(c["end"] * fps)]
        # Repeat of an earlier 8-count: learnt once, not taught twice.
        repeat_of = None
        if sigs[i] is not None:
            for j in range(i):
                if sigs[j] is not None and out[j]["repeat_of"] is None and _distance(sigs[i], sigs[j]) < REPEAT_DISTANCE:
                    repeat_of = j
                    break
        moments = key_moments(seg_speed, fps, c)
        hits = sum(1 for m in moments if m["type"] == "hit")
        seg_mean = float(np.nanmean(seg_speed)) if len(seg_speed) and np.isfinite(seg_speed).any() else 0.0
        difficulty = float(np.clip(0.5 * seg_mean / (mean_speed or 1) + 0.08 * hits, 0, 1))
        visible = float(np.isfinite(_slice(norm, fps, c["start"], c["end"])[..., 0]).mean()) if seg_speed.size else 0.0
        out.append({**c, "index": i, "repeat_of": repeat_of, "key_moments": moments, "difficulty": round(difficulty, 2), "visible": round(visible, 2)})
    return out


def key_moments(seg_speed: np.ndarray, fps: float, c: dict) -> list[dict]:
    """Hits: a speed peak followed by a sharp stop, near a count. Freezes: half a beat or more of stillness."""
    if len(seg_speed) < 5 or not np.isfinite(seg_speed).any():
        return []
    s = np.nan_to_num(seg_speed)
    thresh = s.mean() + s.std()
    moments = []
    beat = (c["end"] - c["start"]) / 8
    for k in range(1, len(s) - 3):
        if s[k] > thresh and s[k] >= s[k - 1] and s[k] >= s[k + 1] and s[k + 3] < 0.5 * s[k]:
            t = c["start"] + k / fps
            count = int(np.argmin([abs(t - ct) for ct in c["counts"]])) + 1
            if not moments or moments[-1]["count"] != count:
                moments.append({"type": "hit", "count": count, "t": round(t, 3)})
    still = s < 0.25 * (s.mean() or 1)
    run = 0
    for k, v in enumerate(still):
        run = run + 1 if v else 0
        if run == int(0.5 * beat * fps):
            t = c["start"] + (k - run + 1) / fps
            count = int(np.argmin([abs(t - ct) for ct in c["counts"]])) + 1
            moments.append({"type": "freeze", "count": count, "t": round(t, 3)})
    return moments
