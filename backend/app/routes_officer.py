"""/api/officer/check: succeeds only for a signed-in officer or admin (the officer dashboard asks this before it opens)."""
from fastapi import APIRouter, Depends

from . import auth

router = APIRouter(prefix="/api")


@router.get("/officer/check")
def officer_check(farmer=Depends(auth.require_role("officer", "admin"))):
    return {"ok": True, "role": farmer["role"]}
