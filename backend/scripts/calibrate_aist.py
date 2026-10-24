"""Calibrate D_EXPERT / D_NOVICE in frontend/src/coach/score.ts from AIST++.

Expert pairs: two professional dancers performing the SAME choreography
(same genre, situation, music, choreo; different dancer id).
Novice proxy pairs: same genre but DIFFERENT choreography (wrong moves).

The distance maths replicates frontend/src/coach/score.ts exactly:
normaliseFrame (centre mid-hip, scale by torso length), boneDirs over the
same BONES list (mapped BlazePose-33 -> COCO-17), frameCost with the same
BONE_WEIGHT (limbs 1, torso/head 0.2), dtw() with a Sakoe-Chiba band of 0.2
and mean cost along the best path.

Run with:  backend/.venv/bin/python -I backend/scripts/calibrate_aist.py \
               --data data/aist [--n-pairs 60] [--seed 7]
"""

import argparse
import math
import pickle
import random
import re
from collections import defaultdict
from pathlib import Path

import numpy as np

# score.ts BONES use BlazePose-33 indices; these are the COCO-17 equivalents,
# in the SAME order so BONE_WEIGHT lines up (first 8 = limbs, weight 1).
# COCO-17: 0 nose, 5 Lsho, 6 Rsho, 7 Lelb, 8 Relb, 9 Lwri, 10 Rwri,
#          11 Lhip, 12 Rhip, 13 Lknee, 14 Rknee, 15 Lank, 16 Rank.
BONES = [
    (5, 7), (7, 9), (6, 8), (8, 10),      # arms (sho->elb, elb->wri)
    (11, 13), (13, 15), (12, 14), (14, 16),  # legs (hip->knee, knee->ank)
    (5, 6), (11, 12),                      # shoulder line, hip line
    (5, 11), (6, 12),                      # torso sides
    (0, 5), (0, 6),                        # head (nose->sho)
]
BONE_WEIGHT = np.array([1.0] * 8 + [0.2] * 6)

L_SHO, R_SHO, L_HIP, R_HIP = 5, 6, 11, 12

NAME_RE = re.compile(r"g(\w+)_s(\w+)_cAll_d(\d+)_m(\w+)_ch(\d+)")

# AIST++ is 60 fps; the app scores at 30 fps. 4 s window from a consistent
# offset: frames 120..360 at 60 fps, downsampled by 2 -> 120 frames.
WIN_START, WIN_END, STEP = 120, 360, 2


def parse_name(stem):
    m = NAME_RE.fullmatch(stem)
    if not m:
        return None
    g, s, d, mu, ch = m.groups()
    return {"genre": g, "situation": s, "dancer": d, "music": mu, "choreo": ch}


def load_window(path):
    """Load keypoints3d, take the calibration window, project 3D->2D (x, -y).

    AIST++ world coords are y-up (ankles ~75, nose ~200); x is lateral so the
    x-y plane is the frontal plane. We keep x and flip y so shoulders sit
    above hips in screen convention, and keep aspect (same unit both axes).
    Returns (F, 17, 2) or None if the clip is too short or has bad frames.
    """
    with open(path, "rb") as f:
        d = pickle.load(f)
    kp = np.asarray(d["keypoints3d"], dtype=np.float64)
    if kp.ndim != 3 or kp.shape[1] != 17 or kp.shape[0] < WIN_END:
        return None
    win = kp[WIN_START:WIN_END:STEP]
    if not np.isfinite(win).all():
        return None
    return np.stack([win[:, :, 0], -win[:, :, 1]], axis=-1)


def bone_dirs_seq(pts2d):
    """normaliseFrame + boneDirs for a whole sequence.

    Mirrors score.ts: centre on mid-hip, scale by torso length (mid-shoulder
    to mid-hip, || 1); then unit bone direction per BONES entry (null -> NaN
    if the bone is degenerate). Returns (F, nbones, 2).
    """
    hip = (pts2d[:, L_HIP] + pts2d[:, R_HIP]) / 2
    sho = (pts2d[:, L_SHO] + pts2d[:, R_SHO]) / 2
    torso = np.linalg.norm(sho - hip, axis=1)
    torso[torso == 0] = 1.0
    norm = (pts2d - hip[:, None, :]) / torso[:, None, None]

    a = np.array([b[0] for b in BONES])
    b = np.array([b[1] for b in BONES])
    v = norm[:, b, :] - norm[:, a, :]
    n = np.linalg.norm(v, axis=2)
    dirs = np.full_like(v, np.nan)
    ok = n > 1e-6
    dirs[ok] = v[ok] / n[ok][:, None]
    return dirs


def cost_matrix(u_dirs, r_dirs):
    """frameCost for every (i, j): weighted mean of 1 - dot(bone dirs)."""
    dots = np.einsum("ibk,jbk->ijb", u_dirs, r_dirs)
    valid = np.isfinite(dots)
    w = np.where(valid, BONE_WEIGHT[None, None, :], 0.0)
    num = np.where(valid, w * (1.0 - np.nan_to_num(dots)), 0.0).sum(axis=2)
    den = w.sum(axis=2)
    return np.where(den > 0, num / np.maximum(den, 1e-12), 1.0)


def dtw_mean(C, band=0.2):
    """Exact port of score.ts dtw(): Sakoe-Chiba band, same tie-breaking,
    returns D[n][m] / path length L[n][m] (mean cost along the best path)."""
    n, m = C.shape
    w = max(math.ceil(band * max(n, m)), abs(n - m))
    INF = float("inf")
    D = np.full((n + 1, m + 1), INF)
    L = np.zeros((n + 1, m + 1), dtype=np.int64)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        jc = math.floor(i * m / n + 0.5)  # JS Math.round
        for j in range(max(1, jc - w), min(m, jc + w) + 1):
            o0, o1, o2 = D[i - 1, j - 1], D[i - 1, j], D[i, j - 1]
            if o0 <= o1 and o0 <= o2:
                best, li = o0, L[i - 1, j - 1]
            elif o1 <= o2:
                best, li = o1, L[i - 1, j]
            else:
                best, li = o2, L[i, j - 1]
            D[i, j] = C[i - 1, j - 1] + best
            L[i, j] = li + 1
    return D[n, m] / max(1, L[n, m])


def pair_distance(cache, fa, fb):
    return dtw_mean(cost_matrix(cache[fa], cache[fb]))


def build_pairs(files, n_pairs, rng):
    """Expert pairs: same (g, s, m, ch), different dancer.
    Novice proxy pairs: same genre, different choreo."""
    by_key = defaultdict(list)
    by_genre = defaultdict(list)
    for f, meta in files.items():
        by_key[(meta["genre"], meta["situation"], meta["music"], meta["choreo"])].append(f)
        by_genre[meta["genre"]].append(f)

    expert_by_genre = defaultdict(list)
    for key, fs in by_key.items():
        fs = sorted(fs)
        for i in range(len(fs)):
            for j in range(i + 1, len(fs)):
                expert_by_genre[key[0]].append((fs[i], fs[j]))
    expert = round_robin(expert_by_genre, n_pairs, rng)

    novice = []
    genres = sorted(by_genre)
    per_genre = max(1, n_pairs // len(genres)) if genres else 0
    for g in genres:
        fs = by_genre[g]
        picked, seen, tries = 0, set(), 0
        while picked < per_genre and tries < 2000:
            tries += 1
            fa, fb = rng.sample(fs, 2)
            if files[fa]["choreo"] == files[fb]["choreo"]:
                continue
            key = tuple(sorted((fa, fb)))
            if key in seen:
                continue
            seen.add(key)
            novice.append((fa, fb))
            picked += 1
    return expert, novice


def round_robin(pools_by_genre, n, rng):
    for fs in pools_by_genre.values():
        rng.shuffle(fs)
    out, genres = [], sorted(pools_by_genre)
    idx = 0
    while len(out) < n and any(pools_by_genre[g] for g in genres):
        g = genres[idx % len(genres)]
        idx += 1
        if pools_by_genre[g]:
            out.append(pools_by_genre[g].pop())
    return out


def stats(xs):
    xs = np.asarray(xs)
    return {
        "n": len(xs),
        "p25": float(np.percentile(xs, 25)),
        "median": float(np.median(xs)),
        "p75": float(np.percentile(xs, 75)),
        "min": float(xs.min()),
        "max": float(xs.max()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="path to data/aist")
    ap.add_argument("--n-pairs", type=int, default=60)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    data = Path(args.data)
    ignore = set()
    ignore_file = data / "ignore_list.txt"
    if ignore_file.exists():
        ignore = {line.strip() for line in ignore_file.read_text().splitlines() if line.strip()}

    files = {}
    for p in sorted((data / "keypoints3d").glob("*.pkl")):
        if p.stem in ignore:
            continue
        meta = parse_name(p.stem)
        if meta:
            files[p.stem] = meta
    print(f"{len(files)} sequences after excluding {len(ignore)} ignore-list entries")

    rng = random.Random(args.seed)
    expert_pairs, novice_pairs = build_pairs(files, args.n_pairs, rng)
    print(f"{len(expert_pairs)} expert pairs, {len(novice_pairs)} novice-proxy pairs")

    needed = sorted({f for pair in expert_pairs + novice_pairs for f in pair})
    cache = {}
    for stem in needed:
        win = load_window(data / "keypoints3d" / f"{stem}.pkl")
        if win is not None:
            cache[stem] = bone_dirs_seq(win)
    print(f"loaded {len(cache)}/{len(needed)} windows (others too short or bad)")

    def run(pairs, label):
        ds = []
        for fa, fb in pairs:
            if fa in cache and fb in cache:
                ds.append(pair_distance(cache, fa, fb))
        s = stats(ds)
        print(f"{label}: n={s['n']} p25={s['p25']:.4f} median={s['median']:.4f} "
              f"p75={s['p75']:.4f} min={s['min']:.4f} max={s['max']:.4f}")
        return np.asarray(ds), s

    e_ds, e_s = run(expert_pairs, "expert        ")
    n_ds, n_s = run(novice_pairs, "novice (proxy)")

    d_expert = e_s["median"]
    d_novice = n_s["p25"]
    print(f"\nD_EXPERT (median expert)      = {d_expert:.3f}")
    print(f"D_NOVICE (p25 novice proxy)   = {d_novice:.3f}")

    overlap = float(((e_ds >= d_novice).mean() + (n_ds <= d_expert).mean()) / 2)
    exp_above = float((e_ds >= d_novice).mean())
    nov_below = float((n_ds <= d_expert).mean())
    print(f"expert dists >= D_NOVICE: {100 * exp_above:.1f}%  "
          f"novice dists <= D_EXPERT: {100 * nov_below:.1f}%  (overlap metric {100 * overlap:.1f}%)")
    if d_expert >= d_novice or overlap > 0.2:
        print("WARNING: poor separation — consider keeping the placeholders.")


if __name__ == "__main__":
    main()
