"""Re-run the pipeline on a routine's kept (silent) video, e.g. after the pipeline improves.
Usage: python -m scripts.reprocess <routine_id>. Replaces its 8-counts and lesson plan."""
import sys
import tempfile
from pathlib import Path

from app import db
from app.pipeline.run import process

rid = sys.argv[1]
db.open_pool()
with db.pool.connection() as c:
    row = c.execute("SELECT video, user_id FROM routines WHERE id = %s", (rid,)).fetchone()
    if not row or row[0] is None:
        sys.exit("no kept video for that routine")
    c.execute("DELETE FROM eight_counts WHERE routine_id = %s", (rid,))
    c.execute("UPDATE routines SET status = 'processing', stages = '[{\"stage\": \"received\"}]', error = NULL WHERE id = %s", (rid,))
tmp = Path(tempfile.mkstemp(prefix="shadow-reprocess-", suffix=".mp4")[1])
tmp.write_bytes(bytes(row[0]))
process(rid, tmp, row[1])
with db.pool.connection() as c:
    print(c.execute("SELECT status, error, tempo_bpm, beat_source FROM routines WHERE id = %s", (rid,)).fetchone())
    for e in c.execute("SELECT idx, start_s, end_s, count_times, name FROM eight_counts WHERE routine_id = %s ORDER BY idx", (rid,)).fetchall():
        print(e)
db.close_pool()
