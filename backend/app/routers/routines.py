import io
import tempfile
from pathlib import Path

import numpy as np
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
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
    title: str = Form("My routine", max_length=80),
    style: str = Form("general", max_length=30),
    rights: bool = Form(...),
    user_id: str = User,
) -> dict:
    if not rights:
        raise HTTPException(400, "Please confirm you have the right to use this video")
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(415, "Please upload a video file")
    pool = _pool()
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
            (user_id, title.strip() or "My routine", style if style in STYLES else "general"),
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
        rows = c.execute(
            "SELECT id, title, status, style, tempo_bpm, created_at FROM routines WHERE user_id = %s ORDER BY created_at DESC LIMIT 50",
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
            "SELECT idx, start_s, end_s, count_times, repeat_of, key_moments, difficulty FROM eight_counts WHERE routine_id = %s ORDER BY idx",
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


@router.delete("/routines/{routine_id}", status_code=204)
def delete_routine(routine_id: str, user_id: str = User) -> None:
    with _pool().connection() as c:
        c.execute("DELETE FROM routines WHERE id = %s AND user_id = %s", (routine_id, user_id))
