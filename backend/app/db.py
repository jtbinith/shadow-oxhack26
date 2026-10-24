from psycopg_pool import ConnectionPool

from .config import settings

pool: ConnectionPool | None = None


def open_pool() -> None:
    global pool
    if settings.database_url:
        pool = ConnectionPool(settings.database_url, min_size=1, max_size=5, open=True)


def close_pool() -> None:
    if pool is not None:
        pool.close()
