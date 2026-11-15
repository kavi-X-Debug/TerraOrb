"""
Login with a phone number and a one-time code (no passwords, for farmers who find passwords hard).

  request_code(db, phone)  -> a 6-digit code is made and stored (hashed). With MC_DEV=1 it is also returned, so the demo works
                              without an SMS service (SMS delivery is on the roadmap). At most 5 codes per phone per hour.
  verify_code(db, phone, code) -> checks the code (valid 10 minutes, at most 5 tries), creates the farmer if new, returns a session token.
  current_farmer(...)      -> FastAPI dependency: the logged-in farmer from "Authorization: Bearer <token>", or 401.
  require_role(*roles)     -> dependency for officer / researcher / admin only routes.

Tokens are random and only their SHA-256 hash is stored.
"""
import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException

from .db import get_db, now_iso, row_to_dict

CODE_MINUTES = 10
MAX_TRIES = 5
MAX_CODES_PER_HOUR = 5


def dev_mode():
    return os.environ.get("MC_DEV", "0") == "1"


def officer_phones():
    """Phone numbers allowed to be officers: MC_OFFICERS="0771234567,0712345678" (set on the server, never in the website)."""
    out = set()
    for raw in os.environ.get("MC_OFFICERS", "").split(","):
        raw = raw.strip()
        if raw:
            try:
                out.add(normalise_phone(raw))
            except HTTPException:
                pass
    return out


def normalise_phone(phone):
    """Digits only, with an optional leading +. Sri Lankan numbers are kept as typed (0771234567 or +94771234567)."""
    p = re.sub(r"[^\d+]", "", str(phone or ""))
    digits = p.lstrip("+")
    if not (8 <= len(digits) <= 15):
        raise HTTPException(status_code=422, detail="phone number must have 8 to 15 digits")
    return ("+" if p.startswith("+") else "") + digits


def _hash(value, salt=""):
    return hashlib.sha256((salt + value).encode("utf-8")).hexdigest()


def _utc(iso):
    return datetime.fromisoformat(iso).astimezone(timezone.utc)


def request_code(db, phone):
    phone = normalise_phone(phone)
    now = datetime.now(timezone.utc)
    row = db.execute("SELECT * FROM otp WHERE phone = ?", (phone,)).fetchone()
    count = 1
    if row and _utc(row["asked_at"]) > now - timedelta(hours=1):
        if row["asked_count"] >= MAX_CODES_PER_HOUR:
            raise HTTPException(status_code=429, detail="too many codes asked for this number; try again in an hour")
        count = row["asked_count"] + 1
        asked_at = row["asked_at"]
    else:
        asked_at = now_iso()
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.execute("INSERT OR REPLACE INTO otp (phone, code_hash, expires_at, tries, asked_at, asked_count) VALUES (?, ?, ?, 0, ?, ?)",
               (phone, _hash(code, phone), (now + timedelta(minutes=CODE_MINUTES)).replace(microsecond=0).isoformat(), asked_at, count))
    db.commit()
    return {"ok": True, **({"dev_code": code} if dev_mode() else {})}


def verify_code(db, phone, code, language=None):
    phone = normalise_phone(phone)
    row = db.execute("SELECT * FROM otp WHERE phone = ?", (phone,)).fetchone()
    if not row or _utc(row["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="the code has expired; ask for a new one")
    if row["tries"] >= MAX_TRIES:
        raise HTTPException(status_code=429, detail="too many wrong tries; ask for a new code")
    if not secrets.compare_digest(row["code_hash"], _hash(str(code or ""), phone)):
        db.execute("UPDATE otp SET tries = tries + 1 WHERE phone = ?", (phone,))
        db.commit()
        raise HTTPException(status_code=400, detail="wrong code")
    db.execute("DELETE FROM otp WHERE phone = ?", (phone,))
    farmer = db.execute("SELECT * FROM farmer WHERE phone = ?", (phone,)).fetchone()
    if not farmer:
        db.execute("INSERT INTO farmer (phone, language, role, created_at) VALUES (?, ?, 'farmer', ?)",
                   (phone, language if language in ("si", "en", "ta") else "si", now_iso()))
        farmer = db.execute("SELECT * FROM farmer WHERE phone = ?", (phone,)).fetchone()
    elif language in ("si", "en", "ta") and farmer["language"] != language:
        db.execute("UPDATE farmer SET language = ? WHERE id = ?", (language, farmer["id"]))
        farmer = db.execute("SELECT * FROM farmer WHERE id = ?", (farmer["id"],)).fetchone()
    if phone in officer_phones() and farmer["role"] == "farmer":          # listed numbers become officers (admins stay admins)
        db.execute("UPDATE farmer SET role = 'officer' WHERE id = ?", (farmer["id"],))
        farmer = db.execute("SELECT * FROM farmer WHERE id = ?", (farmer["id"],)).fetchone()
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO session (token_hash, farmer_id, created_at) VALUES (?, ?, ?)", (_hash(token), farmer["id"], now_iso()))
    db.commit()
    return {"token": token, "farmer": row_to_dict(farmer)}


def current_farmer(authorization: str = Header(default=""), db=Depends(get_db)):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="log in first")
    row = db.execute("SELECT f.* FROM session s JOIN farmer f ON f.id = s.farmer_id WHERE s.token_hash = ?", (_hash(token),)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="the login has expired; log in again")
    return row_to_dict(row)


def require_role(*roles):
    def check(farmer=Depends(current_farmer)):
        if farmer["role"] not in roles:
            raise HTTPException(status_code=403, detail="this needs a different role")
        return farmer
    return check


def own_farm(db, farm_id, farmer):
    """The farm row if it belongs to this farmer, else 404 (a farmer never learns that another farm exists)."""
    row = db.execute("SELECT * FROM farm WHERE id = ? AND farmer_id = ?", (farm_id, farmer["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="farm not found")
    return row_to_dict(row)
