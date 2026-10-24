from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import db
from .config import settings
from .routers import routines


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    yield
    db.close_pool()


app = FastAPI(title="Shadow", lifespan=lifespan)
app.include_router(routines.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "db": db.pool is not None}


@app.get("/api/config")
def public_config() -> dict:
    # Only values that are safe for the browser. Never add secret keys here.
    return {"clerkPublishableKey": settings.clerk_publishable_key}


# The built React app; mounted last so /api routes win.
if Path(settings.static_dir).is_dir():
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="static")
