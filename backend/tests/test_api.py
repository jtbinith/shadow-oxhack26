import base64

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.config import settings
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_config_exposes_only_the_public_key(client, monkeypatch):
    monkeypatch.setattr(settings, "clerk_publishable_key", "pk_test_public")
    monkeypatch.setattr(settings, "clerk_secret_key", "sk_test_SECRET")
    monkeypatch.setattr(settings, "gemini_api_key", "GEMINI_SECRET")
    r = client.get("/api/config")
    assert r.json() == {"clerkPublishableKey": "pk_test_public"}
    assert "SECRET" not in r.text


def test_protected_route_rejects_anonymous(client):
    assert client.get("/api/me").status_code == 401


def test_protected_route_fails_closed_without_clerk(client):
    # A token is present but Clerk isn't configured: still refused, never let through.
    r = client.get("/api/me", headers={"Authorization": "Bearer anything"})
    assert r.status_code == 401


def test_garbage_token_rejected(client, monkeypatch):
    domain = base64.b64encode(b"example.clerk.accounts.dev$").decode().rstrip("=")
    monkeypatch.setattr(settings, "clerk_publishable_key", f"pk_test_{domain}")
    auth._jwks_client.cache_clear()
    r = client.get("/api/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401
    auth._jwks_client.cache_clear()


def test_test_bypass_is_off_by_default():
    assert settings.auth_test_bypass is False


def test_publishable_key_decodes_to_frontend_api(monkeypatch):
    domain = base64.b64encode(b"example-app-123.clerk.accounts.dev$").decode().rstrip("=")
    monkeypatch.setattr(settings, "clerk_publishable_key", f"pk_test_{domain}")
    assert auth._frontend_api() == "example-app-123.clerk.accounts.dev"


def test_coach_actions_are_validated():
    from app.agent.coach import _actions
    acts = _actions([
        {"type": "speed", "value": "0.5"},
        {"type": "demo", "value": "2:5"},
        {"type": "redo", "value": ""},  # second movement action: dropped
    ])
    assert acts == [{"type": "speed", "speed": 0.5}, {"type": "demo", "eight_count": 2, "count": 5}]
    assert _actions([{"type": "speed", "value": "3"}, {"type": "nuke", "value": ""}, {"type": "show_pose", "value": "9"}]) == []
    assert _actions([{"type": "show_pose", "value": "4"}]) == [{"type": "show_pose", "count": 4}]
