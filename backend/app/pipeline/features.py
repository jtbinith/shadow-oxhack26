"""Turn raw keypoints into a body-size-independent skeleton, and the features used for comparing."""
import numpy as np
from scipy.signal import savgol_filter

L_SH, R_SH, L_HIP, R_HIP = 11, 12, 23, 24
# Bones used for comparing shapes: (from, to) keypoint pairs.
BONES = [
    (11, 13), (13, 15), (12, 14), (14, 16),  # arms
    (23, 25), (25, 27), (24, 26), (26, 28),  # legs
    (11, 12), (23, 24),  # shoulder line, hip line
    (11, 23), (12, 24),  # torso sides
    (0, 11), (0, 12),  # head to shoulders
]
LIMB_TIPS = [13, 14, 15, 16, 25, 26, 27, 28]


def fill_gaps(a: np.ndarray, max_gap: int = 5) -> np.ndarray:
    """Linearly fill short NaN gaps per joint/coordinate; long gaps stay NaN."""
    out = a.copy()
    t = np.arange(len(a))
    flat = out.reshape(len(a), -1)
    for k in range(flat.shape[1]):
        col = flat[:, k]
        bad = np.isnan(col)
        if bad.all() or not bad.any():
            continue
        filled = np.interp(t, t[~bad], col[~bad])
        # Only fill runs no longer than max_gap.
        run_start = None
        for i in range(len(col) + 1):
            if i < len(col) and bad[i]:
                run_start = i if run_start is None else run_start
            elif run_start is not None:
                if i - run_start <= max_gap and run_start > 0 and i < len(col):
                    col[run_start:i] = filled[run_start:i]
                run_start = None
    return out


def normalise(image: np.ndarray) -> np.ndarray:
    """T×33×4 (x, y, z, vis) → T×33×3 (x, y, vis): centred on the mid-hip, scaled so the
    torso (mid-shoulder to mid-hip) is 1, lightly smoothed."""
    pts = fill_gaps(image)
    xy = pts[..., :2].copy()
    vis = pts[..., 3]
    if len(xy) >= 9:
        ok = ~np.isnan(xy).any(axis=(1, 2))
        if ok.sum() >= 9:
            xy[ok] = savgol_filter(xy[ok], window_length=7, polyorder=2, axis=0)
    hip = (xy[:, L_HIP] + xy[:, R_HIP]) / 2
    sh = (xy[:, L_SH] + xy[:, R_SH]) / 2
    torso = np.linalg.norm(sh - hip, axis=1)
    scale = np.nanmedian(torso) if np.isfinite(torso).any() else 1.0
    centred = (xy - hip[:, None, :]) / (scale or 1.0)
    return np.concatenate([centred, vis[..., None]], axis=-1).astype(np.float32)


def bone_directions(norm: np.ndarray) -> np.ndarray:
    """T×33×3 → T×len(BONES)×2 unit vectors (NaN where a bone can't be seen)."""
    a = norm[:, [b[0] for b in BONES], :2]
    b = norm[:, [b[1] for b in BONES], :2]
    v = b - a
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(n > 1e-6, n, np.nan)


def limb_speed(norm: np.ndarray, fps: float) -> np.ndarray:
    """Total speed of hands, elbows, knees and feet per frame (torso lengths per second)."""
    p = norm[:, LIMB_TIPS, :2]
    d = np.linalg.norm(np.diff(p, axis=0), axis=-1)
    s = np.nansum(d, axis=1) * fps
    return np.concatenate([[s[0] if len(s) else 0.0], s])
