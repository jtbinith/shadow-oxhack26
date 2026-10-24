"""Rationing for free-tier services. Every paid-per-use call goes through `spend()` first:
it records the usage and refuses once a daily per-user or whole-app limit is reached,
so the app degrades gracefully (rule-based plans, cached audio) instead of exhausting a quota."""
from . import db
from .config import settings

# Daily limits: (per user, whole app).
LIMITS = {
    "gemini": (settings.limit_gemini_per_user, settings.limit_gemini_total),
    "tts_chars": (settings.limit_tts_chars_per_user, settings.limit_tts_chars_total),
    "upload": (settings.limit_uploads_per_user, settings.limit_uploads_total),
}


def spend(kind: str, user_id: str, amount: int = 1) -> bool:
    """Reserve `amount` of today's allowance. Returns False (and records nothing) if over a limit."""
    if db.pool is None:
        return False
    per_user, total = LIMITS[kind]
    with db.pool.connection() as c:
        used_user, used_total = c.execute(
            """SELECT coalesce(sum(amount) FILTER (WHERE user_id = %s), 0), coalesce(sum(amount) FILTER (WHERE user_id = '*'), 0)
               FROM usage WHERE day = current_date AND kind = %s""",
            (user_id, kind),
        ).fetchone()
        if used_user + amount > per_user or used_total + amount > total:
            return False
        for who in (user_id, "*"):
            c.execute(
                """INSERT INTO usage (user_id, kind, amount) VALUES (%s, %s, %s)
                   ON CONFLICT (day, user_id, kind) DO UPDATE SET amount = usage.amount + EXCLUDED.amount""",
                (who, kind, amount),
            )
    return True


def today(user_id: str) -> dict:
    """Usage so far today, for the user and the whole app, with the limits."""
    if db.pool is None:
        return {}
    with db.pool.connection() as c:
        rows = c.execute("SELECT user_id, kind, amount FROM usage WHERE day = current_date AND user_id IN (%s, '*')", (user_id,)).fetchall()
    used = {(u, k): a for u, k, a in rows}
    return {
        kind: {"you": used.get((user_id, kind), 0), "you_limit": lim[0], "app": used.get(("*", kind), 0), "app_limit": lim[1]}
        for kind, lim in LIMITS.items()
    }
