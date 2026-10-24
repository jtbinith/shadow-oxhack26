"""Clerk session verification. Fails closed: with no Clerk key configured,
every protected route is rejected (unless AUTH_TEST_BYPASS is explicitly on)."""
import base64
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, Request, WebSocket, status

from .config import settings


def _frontend_api() -> str:
    # pk_test_<base64("<frontend-api-domain>$")>
    key = settings.clerk_publishable_key
    if not key.startswith(("pk_test_", "pk_live_")):
        return ""
    encoded = key.split("_", 2)[2]
    encoded += "=" * (-len(encoded) % 4)
    return base64.b64decode(encoded).decode().rstrip("$")


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient | None:
    domain = _frontend_api()
    return jwt.PyJWKClient(f"https://{domain}/.well-known/jwks.json") if domain else None


def _verify(token: str) -> str:
    client = _jwks_client()
    if client is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auth not configured")
    try:
        key = client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=f"https://{_frontend_api()}",
            options={"require": ["exp", "sub", "iss"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session")
    return claims["sub"]


def current_user(request: Request) -> str:
    if settings.auth_test_bypass:
        return "test-user"
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing session")
    return _verify(header[7:])


async def ws_user(websocket: WebSocket) -> str:
    """Browsers can't set headers on WebSockets, so the token comes as ?token=."""
    if settings.auth_test_bypass:
        return "test-user"
    token = websocket.query_params.get("token", "")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing session")
    return _verify(token)


User = Depends(current_user)
