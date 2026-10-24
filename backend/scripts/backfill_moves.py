"""Name the moves for routines processed before move naming existed (reads the stored reference skeletons)."""
import io
import json
import os

import numpy as np
import psycopg

from app.pipeline import moves

with psycopg.connect(os.environ["DATABASE_URL"]) as c:
    rows = c.execute("SELECT routine_id, idx, start_s, end_s, count_times, key_moments, reference FROM eight_counts WHERE moves IS NULL").fetchall()
    for rid, idx, start, end, counts, km, refb in rows:
        pts = np.load(io.BytesIO(refb))["points"].astype(np.float32)
        ec = {"start": 0.0, "end": end - start, "counts": [t - start for t in counts],
              "key_moments": km or []}
        ms = moves.name_counts(pts, 30, ec)
        c.execute("UPDATE eight_counts SET moves = %s, name = %s WHERE routine_id = %s AND idx = %s",
                  (json.dumps(ms), moves.summary(ms), rid, idx))
        print(idx, moves.summary(ms))
