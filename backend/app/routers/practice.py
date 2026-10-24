import json

from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from .. import db
from ..auth import User
from ..coach import engine

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
    drill: str = Field(default="full", pattern="^(full|freeze|arms|legs)$")
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
    nxt = engine.next_drill(diffs.get(main, 0.5), engine.Mastery(**m_row), recent, rep.speed)
    return {"passed": passed, "next": nxt}


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
