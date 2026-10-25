import io
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Response, UploadFile
from psycopg.rows import dict_row

from .. import db
from ..auth import User
from .. import usage
from ..config import settings
from ..pipeline.run import process

router = APIRouter(prefix="/api", tags=["routines"])

STYLES = {"general", "bollywood", "hiphop", "kpop", "contemporary", "bharatanatyam"}


def _pool():
    if db.pool is None:
        raise HTTPException(503, "database not configured")
    return db.pool


@router.get("/me")
def me(user_id: str = User) -> dict:
    return {"user_id": user_id}


@router.post("/routines", status_code=202)
async def upload_routine(
    background: BackgroundTasks,
    video: UploadFile = File(...),
    title: str = Form("", max_length=80),
    style: str = Form("general", max_length=30),
    rights: bool = Form(...),
    user_id: str = User,
) -> dict:
    if not rights:
        raise HTTPException(400, "Please confirm you have the right to use this video")
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(415, "Please upload a video file")
    title = " ".join(title.split())
    if not title:
        raise HTTPException(400, "Give the routine a name")
    pool = _pool()
    with pool.connection() as c:
        if c.execute("SELECT 1 FROM routines WHERE user_id = %s AND lower(title) = lower(%s)", (user_id, title)).fetchone():
            raise HTTPException(409, f'You already have a routine called "{title}". Pick another name.')
    with pool.connection() as c:
        busy = c.execute("SELECT count(*) FROM routines WHERE user_id = %s AND status = 'processing'", (user_id,)).fetchone()[0]
    if busy:
        raise HTTPException(429, "Another video is still processing")
    if not usage.spend("upload", user_id):
        raise HTTPException(429, "Daily upload limit reached; try again tomorrow")

    # Stream to a temp file with a size cap; it's deleted as soon as processing has read it.
    limit = settings.max_upload_mb * 1024 * 1024
    tmp = Path(tempfile.mkstemp(prefix="shadow-upload-", suffix=Path(video.filename or "v.mp4").suffix[:8])[1])
    size = 0
    with tmp.open("wb") as f:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                tmp.unlink(missing_ok=True)
                raise HTTPException(413, f"Video is larger than {settings.max_upload_mb} MB")
            f.write(chunk)

    with pool.connection() as c:
        routine_id = c.execute(
            "INSERT INTO routines (user_id, title, style, stages) VALUES (%s, %s, %s, '[{\"stage\": \"received\"}]') RETURNING id",
            (user_id, title, style if style in STYLES else "general"),
        ).fetchone()[0]
    background.add_task(process, str(routine_id), tmp, user_id)
    return {"id": str(routine_id), "status": "processing"}


@router.get("/usage")
def my_usage(user_id: str = User) -> dict:
    """Today's usage of rationed services, for you and the whole app."""
    return usage.today(user_id)


@router.get("/routines")
def list_routines(user_id: str = User) -> list[dict]:
    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        # With learning progress: lesson-tree steps passed (at any speed) out of the total.
        rows = c.execute(
            """SELECT r.id, r.title, r.status, r.style, r.tempo_bpm, r.created_at,
                      coalesce(jsonb_array_length(r.lesson_plan->'steps'), 0) AS steps_total,
                      (SELECT count(DISTINCT s.step_index) FROM rep_scores s
                        WHERE s.routine_id = r.id AND s.user_id = r.user_id AND s.passed) AS steps_passed
               FROM routines r WHERE r.user_id = %s ORDER BY r.created_at DESC LIMIT 50""",
            (user_id,),
        ).fetchall()
    return [{**r, "id": str(r["id"])} for r in rows]


@router.get("/routines/{routine_id}")
def get_routine(routine_id: str, user_id: str = User) -> dict:
    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        r = c.execute(
            """SELECT id, title, status, style, error, stages, tempo_bpm, beats, downbeats, lesson_plan, duration_s, beat_source, created_at
               FROM routines WHERE id = %s AND user_id = %s""",
            (routine_id, user_id),
        ).fetchone()
        if not r:
            raise HTTPException(404, "Routine not found")
        ecs = c.execute(
            "SELECT idx, start_s, end_s, count_times, repeat_of, key_moments, difficulty, moves, name FROM eight_counts WHERE routine_id = %s ORDER BY idx",
            (routine_id,),
        ).fetchall()
    return {**r, "id": str(r["id"]), "eight_counts": ecs}


@router.get("/routines/{routine_id}/eight-counts/{idx}/reference")
def get_reference(routine_id: str, idx: int, user_id: str = User) -> dict:
    """The reference skeleton for one 8-count: normalised points per frame (for the ghost and scoring)."""
    with _pool().connection() as c:
        row = c.execute(
            """SELECT e.reference, e.start_s, e.end_s, e.count_times FROM eight_counts e
               JOIN routines r ON r.id = e.routine_id WHERE e.routine_id = %s AND e.idx = %s AND r.user_id = %s""",
            (routine_id, idx, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "8-count not found")
    data = np.load(io.BytesIO(row[0]))
    pts = np.nan_to_num(data["points"].astype(np.float32), nan=0.0).round(4)
    world = np.nan_to_num(data["world"].astype(np.float32), nan=0.0).round(4)
    return {"fps": 30, "start": row[1], "end": row[2], "counts": row[3], "points": pts.tolist(), "world": world.tolist()}


@router.get("/routines/{routine_id}/video")
def get_video(routine_id: str, user_id: str = User) -> Response:
    """The processed routine video (silent, 30 fps), for the side-by-side practice preview."""
    with _pool().connection() as c:
        row = c.execute("SELECT video FROM routines WHERE id = %s AND user_id = %s", (routine_id, user_id)).fetchone()
    if not row or row[0] is None:
        raise HTTPException(404, "No preview video for this routine")
    return Response(bytes(row[0]), media_type="video/mp4", headers={"Cache-Control": "private, max-age=3600"})


@router.delete("/routines/{routine_id}", status_code=204)
def delete_routine(routine_id: str, user_id: str = User) -> None:
    with _pool().connection() as c:
        c.execute("DELETE FROM routines WHERE id = %s AND user_id = %s", (routine_id, user_id))


_thumbs: dict[tuple[str, int], bytes] = {}


@router.get("/routines/{routine_id}/eight-counts/{idx}/thumb")
def get_thumb(routine_id: str, idx: int, user_id: str = User) -> Response:
    """A still from the routine video near the start of one phrase (for the lesson blocks)."""
    key = (routine_id, idx)
    if key not in _thumbs:
        with _pool().connection() as c:
            row = c.execute(
                """SELECT r.video, e.start_s, e.end_s FROM eight_counts e JOIN routines r ON r.id = e.routine_id
                   WHERE e.routine_id = %s AND e.idx = %s AND r.user_id = %s""", (routine_id, idx, user_id)).fetchone()
        if not row or row[0] is None:
            raise HTTPException(404, "No thumbnail")
        at = row[1] + 0.3 * (row[2] - row[1])
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            f.write(bytes(row[0]))
            f.flush()
            out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.2f}", "-i", f.name, "-frames:v", "1",
                                  "-vf", "scale=320:-2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], capture_output=True, timeout=20)
        if out.returncode or not out.stdout:
            raise HTTPException(404, "No thumbnail")
        if len(_thumbs) > 500:
            _thumbs.clear()
        _thumbs[key] = out.stdout
    return Response(_thumbs[key], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


def streak_days(c, user_id: str) -> int:
    """Consecutive days with practice, counting back from today (or yesterday)."""
    import datetime as dt
    days = c.execute("SELECT DISTINCT time_bucket('1 day', time) AS d FROM rep_scores WHERE user_id=%s", (user_id,)).fetchall()
    practised = {(d["d"] if isinstance(d, dict) else d[0]).date() for d in days}
    streak, day = 0, dt.datetime.now(dt.timezone.utc).date()
    if day not in practised:
        day -= dt.timedelta(days=1)
    while day in practised:
        streak += 1
        day -= dt.timedelta(days=1)
    return streak


@router.get("/me/stats")
def my_stats(user_id: str = User) -> dict:
    """Progress across all routines: totals, streak, practice per day, each routine, top habits."""
    with _pool().connection() as conn, conn.cursor(row_factory=dict_row) as c:
        totals = c.execute(
            """SELECT count(*) AS reps, count(*) FILTER (WHERE passed) AS passes, round(avg(similarity)) AS avg_score,
                      count(DISTINCT time_bucket('1 day', time)) AS days_practised,
                      count(DISTINCT session_id) AS sessions
               FROM rep_scores WHERE user_id = %s""", (user_id,)).fetchone()
        # Minutes: sum of each session's span (first to last rep), so idle gaps between sessions don't count.
        minutes = c.execute(
            """SELECT round(coalesce(sum(extract(epoch FROM t1 - t0)), 0) / 60) AS m FROM
               (SELECT min(time) AS t0, max(time) AS t1 FROM rep_scores WHERE user_id = %s GROUP BY session_id) s""", (user_id,)).fetchone()["m"]
        daily = c.execute(
            """SELECT time_bucket('1 day', time) AS day, count(*) AS reps, round(avg(similarity)) AS avg_score
               FROM rep_scores WHERE user_id = %s AND time > now() - interval '30 days' GROUP BY day ORDER BY day""", (user_id,)).fetchall()
        routines = c.execute(
            """SELECT r.id, r.title, r.status, coalesce(jsonb_array_length(r.lesson_plan->'steps'), 0) AS steps_total,
                      (SELECT count(DISTINCT s.step_index) FROM rep_scores s WHERE s.routine_id = r.id AND s.user_id = r.user_id AND s.passed) AS steps_passed,
                      (SELECT count(*) FROM rep_scores s WHERE s.routine_id = r.id AND s.user_id = r.user_id) AS reps,
                      (SELECT round(avg(similarity)) FROM rep_scores s WHERE s.routine_id = r.id AND s.user_id = r.user_id) AS avg_score,
                      (SELECT max(speed) FROM rep_scores s WHERE s.routine_id = r.id AND s.user_id = r.user_id AND s.passed) AS best_speed,
                      (SELECT max(time) FROM rep_scores s WHERE s.routine_id = r.id AND s.user_id = r.user_id) AS last_practised
               FROM routines r WHERE r.user_id = %s ORDER BY last_practised DESC NULLS LAST, r.created_at DESC""", (user_id,)).fetchall()
        faults = c.execute(
            "SELECT routine_id, top_fault FROM rep_scores WHERE user_id = %s AND NOT passed AND top_fault IS NOT NULL", (user_id,)).fetchall()
        streak = streak_days(c, user_id)
    return {"totals": {**totals, "minutes": minutes}, "streak": streak, "daily": daily,
            "routines": [{**r, "id": str(r["id"])} for r in routines], "patterns": patterns(faults)}


NEEDS = {"higher": "too low", "lower": "too high", "out wider": "too close in", "in closer": "too wide"}


def patterns(faults: list[dict]) -> list[dict]:
    """What keeps going wrong across ALL routines: missed reps grouped by the kind of mistake
    (which limb and which way, or late / early / soft / stiff), ignoring the count and the routine."""
    from collections import Counter, defaultdict
    groups: Counter = Counter()
    where: dict = defaultdict(set)
    for f in faults:
        t = f["top_fault"] or {}
        kind = t.get("type")
        if kind == "shape":
            part = (t.get("body_part") or "").replace("_", " ")
            how = (t.get("direction") or "").replace("a touch ", "").replace("much ", "")
            how = next((d for d in NEEDS if d in how), "")
            if not part or not how:
                continue
            key = f"{part[0].upper()}{part[1:]} {NEEDS[how]}"
        elif kind in ("late", "early", "soft", "stiff"):
            key = {"late": "Late on the beat", "early": "Rushing ahead of the beat", "soft": "Hits too soft", "stiff": "Forcing it (too stiff)"}[kind]
        else:
            continue
        groups[key] += 1
        where[key].add(str(f["routine_id"]))
    total = sum(groups.values()) or 1
    return [{"label": k, "times": n, "share": round(n / total, 2), "routines": len(where[k])} for k, n in groups.most_common(5)]
