"""Browser integration tests: the real built React app served by the real backend.

Run: (cd frontend && npm run build) && backend/.venv/bin/python -m pytest backend/tests/e2e
Starts uvicorn on 127.0.0.1 only, with no Clerk or database configured.
"""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

playwright = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / "frontend" / "dist"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server():
    if not DIST.is_dir():
        pytest.skip("frontend not built (run npm run build in frontend/)")
    port = _free_port()
    env = {**os.environ, "STATIC_DIR": str(DIST), "DATABASE_URL": "", "CLERK_PUBLISHABLE_KEY": "", "CLERK_SECRET_KEY": ""}
    env.pop("AUTH_TEST_BYPASS", None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT / "backend",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    yield url
    proc.terminate()
    proc.wait(5)


def test_app_loads_and_says_login_is_not_configured(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server)
        page.get_by_text("Login isn't configured yet").wait_for(timeout=10_000)
        assert page.title() == "Shadow"
        assert errors == []
        browser.close()


def test_api_refuses_anonymous_calls_from_the_browser(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(server)
        status = page.evaluate("fetch('/api/me').then(r => r.status)")
        assert status == 401
        browser.close()


def test_osnet_model_is_served(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(server)
        size = page.evaluate("fetch('/models/osnet_x0_25_msmt17.onnx').then(r => r.arrayBuffer()).then(b => b.byteLength)")
        assert size > 500_000
        browser.close()
