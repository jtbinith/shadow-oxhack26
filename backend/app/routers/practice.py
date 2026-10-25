import json

from fastapi import APIRouter, HTTPException, Request
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from .. import db
from ..auth import User
from ..coach import clusters as habits_mod
from ..coach import engine
from ..pipeline import sync as mic_sync

router = APIRouter(prefix="/api/routines/{routine_id}", tags=["practice"])


def _pool():
    if db.pool is None:
        raise HTTPException(503, "database not configured")
    return db.pool


def _owned(c, routine_id: str, user_id: str) -> None:
    if not c.execute("SELECT 1 FROM routines WHERE id = %s AND user_id = %s", (routine_id, user_id)).fetchone():
        raise HTTPException(404, "Routine not found")


class RepIn(BaseModel):
    step_index: int = Field(ge=0)
    eight_counts: list[int] = Field(min_length=1, max_length=32)
    speed: float = Field(ge=0.25, le=1.0)
    drill: str = Field(default="full", pattern="^(full|freeze|arms|legs|half)$")
    similarity: float = Field(ge=0, le=100)
    shape: float | None = Field(default=None, ge=0, le=100)
    timing: float | None = Field(default=None, ge=0, le=100)
    per_count: list[float] = Field(default_factory=list, max_length=256)
    timing_bias_ms: float | None = None
    top_fault: dict | None = None


@router.post("/sessions")
def start_session(routine_id: str, user_id: str = User) -> dict:
    with _pool().connection() as c:
        _owned(c, routine_id, user_id)
        sid = c.execute("INSERT INTO sessions (user_id, routine_id) VALUES (%s, %s) RETURNING id", (user_id, routine_id)).fetchone()[0]
    return {"id": str(sid)}


@router.post("/sessions/{session_id}/reps")
def record_rep(routine_id: str, session_id: str, rep: RepIn, user_id: str = User) -> dict:
    """Store a rep, update mastery and the review schedule, and say what to do next."""
    passed = rep.similarity >= engine.PASS and rep.drill == "full"
    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        _owned(c, routine_id, user_id)
        if not c.execute("SELECT 1 FROM sessions WHERE id = %s AND user_id = %s", (session_id, user_id)).fetchone():
            raise HTTPException(404, "Session not found")
        c.execute(
            """INSERT INTO rep_scores (user_id, session_id, routine_id, step_index, eight_counts, drill, speed, similarity, shape, timing,
                                       per_count, timing_bias_ms, passed, top_fault)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (user_id, session_id, routine_id, rep.step_index, rep.eight_counts, rep.drill, rep.speed, rep.similarity, rep.shape, rep.timing,
             rep.per_count, rep.timing_bias_ms, passed, json.dumps(rep.top_fault) if rep.top_fault else None),
        )
        diffs = {r["idx"]: r["difficulty"] or 0.5 for r in c.execute(
            "SELECT idx, difficulty FROM eight_counts WHERE routine_id = %s AND idx = ANY(%s)", (routine_id, rep.eight_counts)).fetchall()}
        # Every 8-count in the rep gets its mastery updated (a chained run practises all of them).
        for idx in rep.eight_counts:
            row = c.execute("SELECT rating, reps, passes, best_speed, stability FROM ec_mastery WHERE user_id=%s AND routine_id=%s AND idx=%s",
                            (user_id, routine_id, idx)).fetchone()
            m = engine.Mastery(**row) if row else engine.Mastery()
            m = engine.update(m, diffs.get(idx, 0.5), rep.speed, rep.similarity, rep.drill)
            c.execute(
                """INSERT INTO ec_mastery (user_id, routine_id, idx, rating, reps, passes, best_speed, stability, due_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now() + make_interval(secs => %s), now())
                   ON CONFLICT (user_id, routine_id, idx) DO UPDATE SET rating=EXCLUDED.rating, reps=EXCLUDED.reps, passes=EXCLUDED.passes,
                     best_speed=EXCLUDED.best_speed, stability=EXCLUDED.stability, due_at=EXCLUDED.due_at, updated_at=now()""",
                (user_id, routine_id, idx, m.rating, m.reps, m.passes, m.best_speed, m.stability, engine.review_due_in_days(m) * 86400),
            )
        recent = [engine.Rep(r["speed"], r["similarity"], r["passed"], r["drill"], r["top_fault"]) for r in reversed(c.execute(
            """SELECT speed, similarity, passed, drill, top_fault FROM rep_scores
               WHERE user_id=%s AND routine_id=%s AND step_index=%s ORDER BY time DESC LIMIT 6""",
            (user_id, routine_id, rep.step_index)).fetchall())]
        main = rep.eight_counts[-1]
        m_row = c.execute("SELECT rating, reps, passes, best_speed, stability FROM ec_mastery WHERE user_id=%s AND routine_id=%s AND idx=%s",
                          (user_id, routine_id, main)).fetchone()
        # Re-cluster this learner's faults on this routine into habits.
        all_reps = c.execute(
            "SELECT top_fault, passed FROM rep_scores WHERE user_id=%s AND routine_id=%s ORDER BY time DESC LIMIT 200",
            (user_id, routine_id)).fetchall()
        found = habits_mod.cluster(all_reps)
        c.execute("DELETE FROM error_clusters WHERE user_id=%s AND routine_id=%s", (user_id, routine_id))
        for k, h in enumerate(found):
            c.execute(
                """INSERT INTO error_clusters (user_id, routine_id, cluster_id, label, body_part, count, share, fault, centroid)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, '{}')""",
                (user_id, routine_id, k, h["label"], h["body_part"], h["count"], h["share"], json.dumps(h["fault"])))
    habit = found[0] if found and found[0]["share"] >= 0.5 else None
    nxt = engine.next_drill(diffs.get(main, 0.5), engine.Mastery(**m_row), recent, rep.speed, habit)
    return {"passed": passed, "next": nxt, "habit": habit["label"] if habit else None}


@router.get("/progress")
def progress(routine_id: str, user_id: str = User) -> dict:
    """Per step: best speed passed (bronze/silver/gold) and whether it's unlocked; per 8-count: mastery."""
    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        _owned(c, routine_id, user_id)
        plan = c.execute("SELECT lesson_plan FROM routines WHERE id = %s", (routine_id,)).fetchone()["lesson_plan"]
        passes = c.execute(
            """SELECT step_index, max(speed) FILTER (WHERE passed) AS best, count(*) AS reps
               FROM rep_scores WHERE user_id=%s AND routine_id=%s GROUP BY step_index""",
            (user_id, routine_id)).fetchall()
        mastery = c.execute("SELECT idx, rating, reps, passes, best_speed, due_at FROM ec_mastery WHERE user_id=%s AND routine_id=%s ORDER BY idx",
                            (user_id, routine_id)).fetchall()
    best = {p["step_index"]: p["best"] for p in passes}
    steps = []
    for i, _ in enumerate(plan.get("steps", [])):
        unlocked = i == 0 or best.get(i - 1) is not None
        steps.append({"index": i, "best_speed": best.get(i), "unlocked": unlocked})
    return {"steps": steps, "mastery": mastery}


@router.get("/stats")
def stats(routine_id: str, user_id: str = User) -> dict:
    """Everything the progress page shows, from the rep time series."""
    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        _owned(c, routine_id, user_id)
        totals = c.execute(
            """SELECT count(*) AS reps, count(*) FILTER (WHERE passed) AS passes, round(avg(similarity)) AS avg_score,
                      max(similarity) AS best_score, round(avg(timing_bias_ms)) AS timing_bias_ms,
                      round(extract(epoch FROM max(time) - min(time)) / 60) AS minutes
               FROM rep_scores WHERE user_id=%s AND routine_id=%s""", (user_id, routine_id)).fetchone()
        daily = c.execute(
            """SELECT time_bucket('1 day', time) AS day, round(avg(similarity)) AS avg_score, max(similarity) AS best_score, count(*) AS reps
               FROM rep_scores WHERE user_id=%s AND routine_id=%s GROUP BY day ORDER BY day""", (user_id, routine_id)).fetchall()
        recent = c.execute(
            """SELECT time, step_index, speed, drill, similarity, passed FROM rep_scores
               WHERE user_id=%s AND routine_id=%s ORDER BY time DESC LIMIT 30""", (user_id, routine_id)).fetchall()
        # Reps it took to first pass each step.
        to_learn = c.execute(
            """SELECT step_index, count(*) FILTER (WHERE time <= coalesce(first_pass, 'infinity')) AS reps, first_pass IS NOT NULL AS learnt
               FROM (SELECT step_index, time, min(time) FILTER (WHERE passed) OVER (PARTITION BY step_index) AS first_pass
                     FROM rep_scores WHERE user_id=%s AND routine_id=%s) t GROUP BY step_index, first_pass ORDER BY step_index""",
            (user_id, routine_id)).fetchall()
        habits = c.execute(
            """SELECT label, count AS times, share, body_part FROM error_clusters
               WHERE user_id=%s AND routine_id=%s ORDER BY count DESC""", (user_id, routine_id)).fetchall()
        mastery = c.execute(
            "SELECT idx, round(rating) AS rating, reps, passes, best_speed, due_at FROM ec_mastery WHERE user_id=%s AND routine_id=%s ORDER BY idx",
            (user_id, routine_id)).fetchall()
        days = c.execute("SELECT DISTINCT time_bucket('1 day', time) AS d FROM rep_scores WHERE user_id=%s ORDER BY d DESC", (user_id,)).fetchall()
    # Streak: consecutive days with practice, counting back from today or yesterday.
    import datetime as dt
    streak, day = 0, dt.datetime.now(dt.timezone.utc).date()
    practised = {d["d"].date() for d in days}
    if day not in practised:
        day -= dt.timedelta(days=1)
    while day in practised:
        streak += 1
        day -= dt.timedelta(days=1)
    xp = int((totals["reps"] or 0) * 10 + (totals["passes"] or 0) * 25)
    return {"totals": totals, "daily": daily, "recent": recent, "reps_to_learn": to_learn, "habits": habits, "mastery": mastery, "streak": streak, "xp": xp}


class ReplanIn(BaseModel):
    request: str = Field(min_length=3, max_length=300)


@router.post("/replan")
def replan(routine_id: str, body: ReplanIn, user_id: str = User) -> dict:
    """The learner talks to the coach in their own words ("I have two weeks", "I keep messing up the turn").
    An agent (Gemini + tools over their progress, habits and plan) rewrites the plan and explains itself;
    the rule-based planner takes over if the agent fails."""
    from ..agent import coach

    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        _owned(c, routine_id, user_id)
        tempo = c.execute("SELECT tempo_bpm FROM routines WHERE id=%s", (routine_id,)).fetchone()["tempo_bpm"] or 100
        ecs = c.execute("SELECT idx AS index, repeat_of, difficulty, key_moments FROM eight_counts WHERE routine_id=%s ORDER BY idx", (routine_id,)).fetchall()
    for e in ecs:
        e["visible"] = 1.0
        e["difficulty"] = e["difficulty"] or 0.5
        e["hits"] = sum(1 for m in (e.pop("key_moments") or []) if m.get("type") == "hit")
    return coach.run(routine_id, user_id, body.request, ecs, tempo)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=300)
    step_index: int = Field(ge=0, default=0)
    rep_context: dict | None = None
    state: dict | None = None  # where the learner is in practice (phase, speed, 8-count, moves)


@router.post("/ask")
def ask_coach(routine_id: str, body: AskIn, user_id: str = User) -> dict:
    """Mid-practice questions ("am I lifting my arm high enough?"), answered from the learner's data."""
    from ..agent import coach

    with _pool().connection() as c:
        _owned(c, routine_id, user_id)
    try:
        return coach.ask(routine_id, user_id, body.question, body.step_index, body.rep_context, body.state)
    except Exception:
        return {
            "answer": "I couldn't reach my notes just now, so let's take it slower and go again.",
            "actions": [{"type": "speed", "speed": 0.5}, {"type": "redo"}],
        }


MAX_SNIPPET_S = 10


@router.post("/sync")
async def sync_to_music(routine_id: str, request: Request, user_id: str = User) -> dict:
    """Mic sync. Body: raw 16-bit mono PCM at 22050 Hz, a few seconds of the learner's own copy of the
    song. Returns where in the song the snippet ended. The audio is matched in memory, never stored."""
    body = await request.body()
    if len(body) > MAX_SNIPPET_S * mic_sync.SR * 2 or len(body) < mic_sync.SR:  # 0.5 s .. 10 s
        raise HTTPException(413, f"Send 1-{MAX_SNIPPET_S} seconds of audio")
    with _pool().connection() as c:
        _owned(c, routine_id, user_id)
        row = c.execute("SELECT fingerprint FROM routines WHERE id = %s", (routine_id,)).fetchone()
    if not row or row[0] is None:
        raise HTTPException(409, "This routine was uploaded without music, so there's nothing to sync to")
    import numpy as np

    pcm = np.frombuffer(body[: len(body) // 2 * 2], dtype="<i2").astype(np.float32) / 32768
    return mic_sync.locate(bytes(row[0]), pcm)
