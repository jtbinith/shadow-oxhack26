import numpy as np

from app.pipeline import moves

FPS = 30


def standing() -> np.ndarray:
    p = np.zeros((33, 3), dtype=np.float32)
    p[:, 2] = 1
    p[11, :2], p[12, :2] = (0.4, -1), (-0.4, -1)  # shoulders (dancer's left on image right)
    p[15, :2], p[16, :2] = (0.5, 0), (-0.5, 0)  # wrists down
    p[23, :2], p[24, :2] = (0.2, 0), (-0.2, 0)  # hips
    p[25, :2], p[26, :2] = (0.2, 1), (-0.2, 1)  # knees
    p[27, :2], p[28, :2] = (0.2, 2), (-0.2, 2)  # ankles
    return p


def routine(poses: list[np.ndarray]) -> tuple[np.ndarray, dict]:
    """One pose held for each count (0.5 s per count)."""
    frames = np.stack([p for p in poses for _ in range(15)])
    ec = {"start": 0.0, "end": 4.0, "counts": [0.25 + 0.5 * k for k in range(8)], "key_moments": []}
    return frames, ec


def test_names_arms_steps_drops_and_moments():
    up = standing(); up[15, :2], up[16, :2] = (0.4, -1.8), (-0.4, -1.8)
    out = standing(); out[15, :2], out[16, :2] = (1.4, -1), (-1.4, -1)
    step = standing(); step[28, 0] = -0.9
    drop = standing(); drop[[27, 28], 1] = 1.3; drop[[25, 26], 1] = 0.5
    knee = standing(); knee[25, 1], knee[27, 1] = 0.3, 1.2
    kick = standing(); kick[26, :2], kick[28, :2] = (-0.8, 0.5), (-1.6, 0.6)
    norm, ec = routine([standing(), up, out, standing(), step, drop, knee, kick])
    ec["key_moments"] = [{"type": "hit", "count": 2, "t": 0.75}, {"type": "turn", "count": 4, "t": 1.75}]
    names = [m["name"] for m in moves.name_counts(norm, FPS, ec)]
    assert names[0] == "Groove"
    assert names[1] == "Arms up (hit)"
    assert names[2] == "Arms out"
    assert names[3].startswith("Turn") and "Arms down" in names[3]
    assert names[4] == "Step right"
    assert names[5] == "Drop"
    assert names[6] == "Left knee up"
    assert names[7] == "Right leg kick"


def test_summary_collapses_repeats_and_grooves():
    ms = [{"count": i + 1, "name": n} for i, n in enumerate(["Groove", "Arms up (hit)", "Arms up", "Turn", "Groove", "Drop", "Step left", "Arms out"])]
    assert moves.summary(ms) == "Arms up → Turn → Drop"
    assert moves.summary([{"count": 1, "name": "Groove"}]) == "Groove"


def test_missing_joints_dont_crash():
    p = standing(); p[[15, 16, 27, 28]] = np.nan
    norm, ec = routine([p] * 8)
    assert len(moves.name_counts(norm, FPS, ec)) == 8
