"""/api/auth/request, /api/auth/verify and /api/me (the login of the farm planner)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import auth
from .db import get_db

router = APIRouter(prefix="/api")


class PhoneIn(BaseModel):
    phone: str


class VerifyIn(BaseModel):
    phone: str
    code: str
    language: str | None = None


@router.post("/auth/request")
def request_code(body: PhoneIn, db=Depends(get_db)):
    return auth.request_code(db, body.phone)


@router.post("/auth/verify")
def verify(body: VerifyIn, db=Depends(get_db)):
    return auth.verify_code(db, body.phone, body.code, body.language)


@router.get("/me")
def me(farmer=Depends(auth.current_farmer)):
    return farmer
