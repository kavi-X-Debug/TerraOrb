"""
The farm planner's backend (FastAPI). Run from the repo root:

    backend\\run.ps1                       (sets MC_DEV=1 and starts it on http://localhost:8000)
    .venv\\Scripts\\python -m uvicorn backend.app.main:app --reload --port 8000

Every file backend/app/routes_*.py that defines a FastAPI `router` is included automatically, so each area has its own file.
The website (a static site) calls this API; it must be able to reach it. Allowed web origins: MC_CORS (comma separated),
default http://localhost:8010 and http://127.0.0.1:8010.
"""
import importlib
import os
import pkgutil
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, db

app = FastAPI(title="Monsoon Compass farm planner", version="0.1")
origins = [o.strip() for o in os.environ.get("MC_CORS", "http://localhost:8010,http://127.0.0.1:8010").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

db.init_db()                                         # creates the tables on first start

_failed = {}
for module in pkgutil.iter_modules([str(Path(__file__).parent)]):
    if module.name.startswith("routes_"):
        try:
            router = getattr(importlib.import_module(f"{__package__}.{module.name}"), "router", None)
            if router is not None:
                app.include_router(router)
        except Exception as err:                     # one broken area must not stop the others; /api/health lists it
            _failed[module.name] = f"{type(err).__name__}: {err}"


@app.get("/api/health")
def health():
    return {"ok": True, "dev": auth.dev_mode(), "failed_modules": _failed}
