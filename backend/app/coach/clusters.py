"""Error clustering: group a learner's reps by *what went wrong*, to find habits.

Each failing rep becomes a feature vector — which limb, which way it was off, where in
the 8-count, early/late, soft/stiff — and k-means (k picked by silhouette) groups them.
Each cluster becomes a plain-language habit ("Right arm low around counts 3–4"), its share
of reps, and a representative fault the engine and coach can act on.
"""
from collections import Counter

import numpy as np

LIMBS = ["left_arm", "left_forearm", "right_arm", "right_forearm", "left_thigh", "left_shin", "right_thigh", "right_shin"]
DIRS = ["higher", "lower", "out wider", "in closer"]
TYPES = ["shape", "late", "early", "soft", "stiff"]
MIN_REPS = 4


def _vector(rep: dict) -> np.ndarray | None:
    f = rep.get("top_fault") or {}
    t = f.get("type")
    if t not in TYPES:
        return None
    v = np.zeros(len(TYPES) + len(LIMBS) + len(DIRS) + 2)
    v[TYPES.index(t)] = 2.0  # fault type dominates
    part = f.get("body_part") or ""
    if part in LIMBS:
        v[len(TYPES) + LIMBS.index(part)] = 1.5
    direction = f.get("direction") or ""
    for k, d in enumerate(DIRS):
        if d in direction:
            v[len(TYPES) + len(LIMBS) + k] = 1.0
    count = int(f.get("count") or 1)
    # Where in the 8-count, as a point on a circle (count 8 is next to count 1).
    angle = 2 * np.pi * ((count - 1) % 8) / 8
    v[-2:] = 0.8 * np.cos(angle), 0.8 * np.sin(angle)
    return v


def _label(faults: list[dict]) -> str:
    types = Counter(f.get("type") for f in faults).most_common(1)[0][0]
    faults = [f for f in faults if f.get("type") == types]  # describe the dominant kind of mistake
    counts = sorted({int(f.get("count") or 1) for f in faults})
    where = (f"around count {counts[0]}" if len(counts) == 1
             else f"around counts {counts[0]}–{counts[-1]}" if counts[-1] - counts[0] <= 3 else "across the 8-count")
    if types == "shape":
        part = Counter(f.get("body_part") for f in faults if f.get("body_part")).most_common(1)
        direction = Counter(f.get("direction") for f in faults if f.get("direction")).most_common(1)
        limb = part[0][0].replace("_", " ").capitalize() if part else "Arms"
        how = direction[0][0].replace("a touch ", "").replace("much ", "") if direction else "off"
        needs = {"higher": "too low", "lower": "too high", "out wider": "too close in", "in closer": "too wide"}
        return f"{limb} {needs.get(how, 'off the line')} {where}"
    return {"late": f"Late on the beat {where}", "early": f"Rushing ahead {where}",
            "soft": f"Soft hits {where}", "stiff": f"Forcing it {where}"}.get(types, f"Off {where}")


def cluster(reps: list[dict]) -> list[dict]:
    """reps: dicts with top_fault (and passed). Returns habits sorted by share, biggest first."""
    rows = [(r, _vector(r)) for r in reps if not r.get("passed")]
    rows = [(r, v) for r, v in rows if v is not None]
    if len(rows) < MIN_REPS:
        return []
    X = np.stack([v for _, v in rows])
    labels = np.zeros(len(rows), dtype=int)
    best_k = 1
    if len(rows) >= 6:
        from sklearn.cluster import KMeans
        from sklearn.metrics import silhouette_score

        best_score = 0.25  # a split must be clearly better than "one habit"
        for k in range(2, min(4, len(rows) - 1) + 1):
            km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(X)
            if len(set(km.labels_)) < 2:
                continue
            score = silhouette_score(X, km.labels_)
            if score > best_score:
                best_score, best_k, labels = score, k, km.labels_
    out = []
    for c in range(best_k):
        members = [r for (r, _), lab in zip(rows, labels) if lab == c]
        if not members:
            continue
        faults = [m["top_fault"] for m in members]
        rep_fault = Counter((f.get("type"), f.get("body_part"), f.get("direction")) for f in faults).most_common(1)[0][0]
        out.append({
            "label": _label(faults),
            "count": len(members),
            "share": round(len(members) / len(rows), 2),
            "fault": {"type": rep_fault[0], "body_part": rep_fault[1], "direction": rep_fault[2]},
            "body_part": rep_fault[1],
        })
    return sorted(out, key=lambda h: -h["count"])
