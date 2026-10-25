"""Demo data: a few routines with ~3 weeks of realistic practice, so the app looks like it's in use.

Usage (from backend/, with .env loaded):
  python -m scripts.seed_demo            # seed for the account that owns the most routines
  python -m scripts.seed_demo --user ID  # seed for a specific Clerk user id
  python -m scripts.seed_demo --wipe     # remove all demo routines (and their history)

Demo routines are copies of already-processed routines (video, beats, skeletons, moves), named
"Demo · …". The history goes through the same engine and clustering as real practice: Elo
mastery per phrase, review schedule, passes at 0.5/0.75/1×, and habits from missed reps.
"""
import argparse
import datetime as dt
import json
import random
import uuid

from app import db
from app.coach import clusters, engine

DEMO = "Demo · "
# title, style, source routine (by title), how far through the plan, practice days, seed
PLANS = [
    ("Contemporary solo", "contemporary", "triasl 3", 0.7, 14, 1),
    ("Hip-hop groove", "hiphop", "solo_dance", 0.3, 6, 2),
    ("Quick 4-count", "kpop", "aaditya", 1.0, 4, 3),
]
# Missed reps lean towards a couple of habits, so clustering finds them.
HABITS = [
    ({"type": "shape", "body_part": "right_arm", "direction": "higher", "count": 3}, 0.45),
    ({"type": "late", "count": 7}, 0.3),
    ({"type": "shape", "body_part": "left_thigh", "direction": "out wider", "count": 5}, 0.15),
]


def wipe(c, user_id: str | None) -> int:
    q = "SELECT id FROM routines WHERE title LIKE %s" + (" AND user_id = %s" if user_id else "")
    ids = [r[0] for r in c.execute(q, (DEMO + "%",) + ((user_id,) if user_id else ())).fetchall()]
    for t in ("rep_scores", "sessions", "ec_mastery", "error_clusters"):
        c.execute(f"DELETE FROM {t} WHERE routine_id = ANY(%s)", (ids,))
    c.execute("DELETE FROM routines WHERE id = ANY(%s)", (ids,))
    return len(ids)


def copy_routine(c, src_title: str, user_id: str, title: str, style: str) -> tuple[str, dict, dict, int] | None:
    src = c.execute("SELECT id FROM routines WHERE title = %s AND status = 'ready' ORDER BY created_at LIMIT 1", (src_title,)).fetchone()
    if not src:
        return None
    rid = c.execute(
        """INSERT INTO routines (user_id, title, status, style, tempo_bpm, beats, downbeats, fingerprint, lesson_plan, duration_s,
                                 beat_source, video, stages, created_at)
           SELECT %s, %s, 'ready', %s, tempo_bpm, beats, downbeats, fingerprint, lesson_plan, duration_s, beat_source, video, stages,
                  now() - interval '22 days'
           FROM routines WHERE id = %s RETURNING id, lesson_plan""",
        (user_id, DEMO + title, style, src[0])).fetchone()
    c.execute(
        """INSERT INTO eight_counts (routine_id, idx, start_s, end_s, count_times, repeat_of, key_moments, difficulty, reference, moves, name)
           SELECT %s, idx, start_s, end_s, count_times, repeat_of, key_moments, difficulty, reference, moves, name
           FROM eight_counts WHERE routine_id = %s""", (rid[0], src[0]))
    rows = c.execute("SELECT idx, difficulty, cardinality(count_times) FROM eight_counts WHERE routine_id = %s", (rid[0],)).fetchall()
    diffs = {i: d or 0.5 for i, d, _ in rows}
    counts = max((n for _, _, n in rows), default=8)
    return str(rid[0]), rid[1], diffs, counts


def simulate(plan: dict, reach: float, days: int, rng: random.Random, counts: int = 8) -> list[dict]:
    """Reps over the last ~3 weeks: skill per step grows with practice; passing unlocks the next step
    and earns faster speeds; misses carry a (mostly habitual) fault."""
    steps = plan.get("steps", [])
    target = max(1, round(reach * len(steps)))
    skill = [38 + 14 * rng.random() - 8 * (s["type"] == "chain") for s in steps]
    speed = [s.get("start_speed", 0.75) for s in steps]
    best = [0.0 for _ in steps]
    reps: list[dict] = []
    today = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    day_list = sorted(rng.sample(range(1, 21), k=min(days - 1, 20)), reverse=True) + [0]  # always ends today
    cur = 0
    for d in day_list:
        t = today - dt.timedelta(days=d) + dt.timedelta(hours=rng.randint(-4, 3))
        session = str(uuid.uuid4())
        for _ in range(rng.randint(8, 16)):
            if cur >= len(steps):
                cur = rng.randrange(len(steps))  # revision once the plan is done
            s = steps[cur]
            sp = speed[cur]
            score = max(5.0, min(98.0, skill[cur] + rng.gauss(0, 8) - 18 * (sp - 0.5)))
            passed = score >= engine.PASS
            fault = None
            if not passed:
                r = rng.random()
                acc = 0.0
                for f, w in HABITS:
                    acc += w
                    if r < acc:
                        fault = dict(f)
                        break
                fault = fault or {"type": "shape", "body_part": rng.choice(["left_arm", "right_shin", "left_forearm"]),
                                  "direction": rng.choice(["higher", "lower", "in closer"]), "count": rng.randint(1, 8)}
            if fault:
                fault["count"] = (fault["count"] - 1) % counts + 1  # habits only on counts the phrase has
            n = counts * len(s["eight_counts"])
            reps.append({
                "time": t, "session": session, "step": cur, "eight_counts": s["eight_counts"], "speed": sp, "similarity": round(score, 1),
                "shape": round(min(99, score + rng.gauss(3, 4)), 1), "timing": round(min(99, score + rng.gauss(-2, 6)), 1),
                "per_count": [round(max(0, min(100, score + rng.gauss(0, 10)))) for _ in range(n)],
                "timing_bias_ms": round(rng.gauss(180, 40) if fault and fault["type"] == "late" else rng.gauss(30, 50)),
                "passed": passed, "top_fault": fault,
            })
            t += dt.timedelta(seconds=rng.randint(45, 110))
            skill[cur] += max(1.0, 7 - 0.25 * len([r for r in reps if r["step"] == cur]))
            if passed:
                best[cur] = max(best[cur], sp)
                if sp < 1 and rng.random() < 0.55:
                    speed[cur] = {0.5: 0.75, 0.75: 1.0}.get(sp, 1.0)
                elif cur < target - 1 or rng.random() < 0.3:
                    cur = min(cur + 1, target - 1) if cur < target - 1 else cur
                    if cur == target - 1 and best[cur] >= 1:
                        cur = len(steps)  # done: revise
    return reps


def seed(c, user_id: str) -> None:
    for title, style, src, reach, days, seed_n in PLANS:
        made = copy_routine(c, src, user_id, title, style)
        if not made:
            print(f"skip {title}: source routine '{src}' not found")
            continue
        rid, plan, diffs, counts = made
        reps = simulate(plan, reach, days, random.Random(seed_n), counts)
        for sid in {r["session"] for r in reps}:
            first = min(r["time"] for r in reps if r["session"] == sid)
            last = max(r["time"] for r in reps if r["session"] == sid)
            c.execute("INSERT INTO sessions (id, user_id, routine_id, started_at, ended_at) VALUES (%s, %s, %s, %s, %s)",
                      (sid, user_id, rid, first, last))
        mastery: dict[int, engine.Mastery] = {}
        for r in reps:
            c.execute(
                """INSERT INTO rep_scores (time, user_id, session_id, routine_id, step_index, eight_counts, drill, speed, similarity, shape,
                                           timing, per_count, timing_bias_ms, passed, top_fault)
                   VALUES (%s, %s, %s, %s, %s, %s, 'full', %s, %s, %s, %s, %s, %s, %s, %s)""",
                (r["time"], user_id, r["session"], rid, r["step"], r["eight_counts"], r["speed"], r["similarity"], r["shape"], r["timing"],
                 r["per_count"], r["timing_bias_ms"], r["passed"], json.dumps(r["top_fault"]) if r["top_fault"] else None))
            for idx in r["eight_counts"]:
                mastery[idx] = engine.update(mastery.get(idx, engine.Mastery()), diffs.get(idx, 0.5), r["speed"], r["similarity"])
        for idx, m in mastery.items():
            c.execute(
                """INSERT INTO ec_mastery (user_id, routine_id, idx, rating, reps, passes, best_speed, stability, due_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now() + make_interval(secs => %s), now())""",
                (user_id, rid, idx, m.rating, m.reps, m.passes, m.best_speed, m.stability, engine.review_due_in_days(m) * 86400 - 2 * 86400))
        found = clusters.cluster([{"top_fault": r["top_fault"], "passed": r["passed"]} for r in reps[-200:]])
        for k, h in enumerate(found):
            c.execute(
                """INSERT INTO error_clusters (user_id, routine_id, cluster_id, label, body_part, count, share, fault, centroid)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, '{}')""",
                (user_id, rid, k, h["label"], h["body_part"], h["count"], h["share"], json.dumps(h["fault"])))
        passed_steps = len({r["step"] for r in reps if r["passed"]})
        print(f"{DEMO}{title}: {len(reps)} reps over {days} days, {passed_steps}/{len(plan.get('steps', []))} steps passed, "
              f"{len(found)} habit(s): {[h['label'] for h in found]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--user")
    ap.add_argument("--wipe", action="store_true")
    a = ap.parse_args()
    db.open_pool()
    with db.pool.connection() as c:
        user = a.user or c.execute(
            "SELECT user_id FROM routines WHERE user_id <> 'test-user' AND title NOT LIKE %s GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
            (DEMO + "%",)).fetchone()[0]
        n = wipe(c, user)
        if n:
            print(f"removed {n} demo routine(s)")
        if not a.wipe:
            seed(c, user)
    db.close_pool()
