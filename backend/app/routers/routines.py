from fastapi import APIRouter

from ..auth import User

router = APIRouter(prefix="/api", tags=["routines"])


@router.get("/me")
def me(user_id: str = User) -> dict:
    return {"user_id": user_id}
