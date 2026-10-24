"""Name the moves: a plain-language label for each count, the way a teacher calls them out.

Rules over the normalised skeleton (hip-centred, torso = 1, y grows downwards): where the
wrists are on the count (up / out / down), knee lifts, drops (legs bending), steps (feet
spreading or closing), plus the turns, hits and freezes found by segment.py. Each 8-count
gets per-count names ("Step right", "Arms up + hit") and a short summary.
"""
import warnings

import numpy as np

L_SH, R_SH, L_WR, R_WR = 11, 12, 15, 16
L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN = 23, 24, 25, 26, 27, 28


def _pose_at(norm: np.ndarray, fps: float, t: float) -> np.ndarray | None:
    """Mean pose over a few frames around time t (seconds into the routine)."""
    f = int(round(t * fps))
    seg = norm[max(0, f - 2) : f + 3, :, :2]
    if not len(seg):
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN joints stay NaN
        p = np.nanmean(seg, axis=0)
    return p


def _arm(p: np.ndarray, sh: int, wr: int) -> str | None:
    """'up', 'out' or 'down' for one arm."""
    s, w = p[sh], p[wr]
    if np.isnan(s).any() or np.isnan(w).any():
        return None
    if w[1] < s[1] - 0.35:
        return "up"
    if abs(w[0] - s[0]) > 0.6 and abs(w[1] - s[1]) < 0.45:
        return "out"
    return "down"


def _arms(p: np.ndarray) -> str | None:
    # Body-relative: "left" is the dancer's own left, like the rest of the coaching.
    left, right = _arm(p, L_SH, L_WR), _arm(p, R_SH, R_WR)
    if left is None or right is None:
        return None
    if left == right:
        return {"up": "Arms up", "out": "Arms out", "down": "Arms down"}[left]
    if left == "down":
        return f"Right arm {right}"
    if right == "down":
        return f"Left arm {left}"
    return f"Left arm {left}, right {right}"


def _legs(p: np.ndarray, prev: np.ndarray | None, leg_len: float) -> str | None:
    hip_y = (p[L_HIP, 1] + p[R_HIP, 1]) / 2
    # Both legs bent (even the lower foot is close to the hips): a drop / squat.
    lower_foot = np.nanmax([p[L_AN, 1], p[R_AN, 1]]) - hip_y if np.isfinite(p[[L_AN, R_AN], 1]).any() else np.nan
    if np.isfinite(lower_foot) and lower_foot < 0.8 * leg_len:
        return "Drop"
    for kn, an, side in ((L_KN, L_AN, "Left"), (R_KN, R_AN, "Right")):
        if not np.isnan(p[kn]).any() and p[kn, 1] < hip_y + 0.4 * leg_len:
            # Foot up near hip height too: the leg is extended, a kick rather than a knee lift.
            kicked = not np.isnan(p[an]).any() and p[an, 1] < hip_y + 0.6 * leg_len
            return f"{side} leg kick" if kicked else f"{side} knee up"
    if prev is None or np.isnan(p[[L_AN, R_AN]]).any() or np.isnan(prev[[L_AN, R_AN]]).any():
        return None
    spread, before = abs(p[L_AN, 0] - p[R_AN, 0]), abs(prev[L_AN, 0] - prev[R_AN, 0])
    # A clear change in stance width, measured against leg length so it's camera-independent.
    if spread - before > 0.3 * leg_len:
        moved_left = abs(p[L_AN, 0] - prev[L_AN, 0]) >= abs(p[R_AN, 0] - prev[R_AN, 0])
        return "Step left" if moved_left else "Step right"
    if before - spread > 0.3 * leg_len and spread < 0.3 * leg_len:
        return "Feet together"
    return None


def name_counts(norm: np.ndarray, fps: float, ec: dict) -> list[dict]:
    """[{count: 1..8, name: str}] for one analysed 8-count (from segment.analyse)."""
    times = ec["counts"]
    ankles = norm[:, [L_AN, R_AN], 1] - ((norm[:, L_HIP, 1] + norm[:, R_HIP, 1]) / 2)[:, None]
    leg_len = float(np.nanmedian(ankles)) if np.isfinite(ankles).any() else 2.0
    moments: dict[int, list[str]] = {}
    for m in ec.get("key_moments", []):
        moments.setdefault(m["count"], []).append(m["type"])
    out = []
    prev_pose, prev_arms = None, None
    for k, t in enumerate(times[:8], start=1):
        p = _pose_at(norm, fps, t)
        if p is None:
            out.append({"count": k, "name": "—"})
            continue
        parts = []
        kinds = moments.get(k, [])
        if "turn" in kinds:
            parts.append("Turn")
        legs = _legs(p, prev_pose, leg_len)
        if legs:
            parts.append(legs)
        arms = _arms(p)
        # Arms down is only worth saying when the arms were somewhere else on the last count.
        if arms and (arms != "Arms down" or (prev_arms and prev_arms != "Arms down")):
            parts.append(arms)
        if "freeze" in kinds and not parts:
            parts.append("Freeze")
        name = " + ".join(parts[:2]) or "Groove"
        if "hit" in kinds:
            name += " (hit)"
        elif "freeze" in kinds and parts and parts[0] != "Freeze":
            name += " (hold)"
        out.append({"count": k, "name": name})
        prev_pose, prev_arms = p, arms or prev_arms
    return out


def summary(moves: list[dict]) -> str:
    """'Step right → Arms up → Turn': the distinct, notable moves in order, at most three."""
    seq: list[str] = []
    for m in moves:
        for part in m["name"].replace(" (hit)", "").replace(" (hold)", "").split(" + "):
            if part in ("Groove", "—", "Arms down", "Feet together") or part in seq:
                continue
            seq.append(part)
    return " → ".join(seq[:3]) or "Groove"
