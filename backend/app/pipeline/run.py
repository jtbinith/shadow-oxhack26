"""Processing an upload, start to finish. Audio and video are deleted as soon as they've been used."""
import io
import json
import logging
import shutil
import tempfile
from pathlib import Path

import numpy as np

from .. import db
from ..config import settings
from ..agent import plan as lesson_plan
from . import audio, features, media, moves, pose, segment

log = logging.getLogger(__name__)


def _stage(routine_id: str, name: str, **extra) -> None:
    with db.pool.connection() as c:
        c.execute(
            "UPDATE routines SET stages = stages || %s::jsonb WHERE id = %s",
            (json.dumps([{"stage": name, **extra}]), routine_id),
        )


def _reference_bytes(norm: np.ndarray, world: np.ndarray) -> bytes:
    buf = io.BytesIO()
    np.savez_compressed(buf, points=norm.astype(np.float16), world=world.astype(np.float16))
    return buf.getvalue()


def process(routine_id: str, upload: Path, user_id: str) -> None:
    work = Path(tempfile.mkdtemp(prefix="shadow-"))
    try:
        info = media.probe(upload)
        if info["duration"] > settings.max_video_minutes * 60:
            raise ValueError(f"Video is longer than {settings.max_video_minutes} minutes")
        video, wav = media.split(upload, work)
        upload.unlink(missing_ok=True)
        _stage(routine_id, "converted", duration=round(info["duration"], 1))

        grid = audio.beat_grid(wav, info["duration"])
        if wav is not None:
            wav.unlink(missing_ok=True)
        _stage(routine_id, "beats", tempo=round(grid["tempo"]), source=grid["source"])
        _stage(routine_id, "audio_deleted")

        def progress(p: float) -> None:
            if int(p * 100) % 25 == 0:
                _stage(routine_id, "pose_progress", percent=int(p * 100))

        raw = pose.extract(video, progress)
        # Keep the silent 30 fps video for the in-app preview (the learner asked to see the
        # original moves). The AUDIO stays deleted — the recording of the song is never stored.
        video_bytes = video.read_bytes()
        shutil.rmtree(work, ignore_errors=True)
        _stage(routine_id, "pose", frames=int(len(raw["image"])))
        _stage(routine_id, "video_kept", mb=round(len(video_bytes) / 1e6, 1))

        norm = features.normalise(raw["image"], raw["width"], raw["height"])
        world = features.fill_gaps(raw["world"])
        if grid["source"] == "default":
            # No music: take the beat from the movement itself.
            grid = audio.motion_grid(features.limb_speed(norm, raw["fps"]), raw["fps"], info["duration"])
            _stage(routine_id, "beats", tempo=round(grid["tempo"]), source=grid["source"])
        counts = audio.eight_counts(grid["beats"], grid["downbeats"], info["duration"], grid.get("end"))
        analysed = segment.analyse(norm, raw["fps"], counts)
        for e in analysed:
            e["moves"] = moves.name_counts(norm, raw["fps"], e)
            e["name"] = moves.summary(e["moves"])
        repeats = sum(1 for e in analysed if e["repeat_of"] is not None)
        _stage(routine_id, "segmented", eight_counts=len(analysed), repeats=repeats)

        plan, source = lesson_plan.build(analysed, grid["tempo"], user_id)
        _stage(routine_id, "planned", source=source, steps=len(plan.steps))

        fps = raw["fps"]
        with db.pool.connection() as c:
            for e in analysed:
                a, b = int(e["start"] * fps), int(e["end"] * fps)
                c.execute(
                    """INSERT INTO eight_counts (routine_id, idx, start_s, end_s, count_times, repeat_of, key_moments, difficulty, reference, moves, name)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (routine_id, e["index"], e["start"], e["end"], e["counts"], e["repeat_of"], json.dumps(e["key_moments"]), e["difficulty"], _reference_bytes(norm[a:b], world[a:b]), json.dumps(e["moves"]), e["name"]),
                )
            c.execute(
                """UPDATE routines SET status = 'ready', tempo_bpm = %s, beats = %s, downbeats = %s, fingerprint = %s,
                   lesson_plan = %s, duration_s = %s, beat_source = %s, video = %s WHERE id = %s""",
                (grid["tempo"], grid["beats"], grid["downbeats"], grid["fingerprint"], json.dumps(plan.model_dump() | {"source": source}), info["duration"], grid["source"], video_bytes, routine_id),
            )
    except Exception as e:
        log.exception("processing failed")
        with db.pool.connection() as c:
            c.execute("UPDATE routines SET status = 'failed', error = %s WHERE id = %s", (str(e)[:300], routine_id))
    finally:
        upload.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)
