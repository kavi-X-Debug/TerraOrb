"""
Build the two folders that are uploaded when TerraOrb is hosted for free. Run from the repo root:

    .venv\\Scripts\\python deploy\\make_deploy.py

  _deploy/cloudflare/site        the website (index.html, web/, data/) for Cloudflare Pages
  _deploy/cloudflare/functions   the chat's Pages Function (copied from deploy/cloudflare/functions)
  _deploy/hf-space               the farm planner backend as a Hugging Face "Docker" Space (+ _deploy/hf-space.zip to upload in the browser)

Nothing secret goes into either folder: the Gemini key is a Pages secret (wrangler pages secret put GEMINI_API_KEY).
"""
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_deploy"
SKIP = {"__pycache__", ".pytest_cache"}


def copy(src, dst, ignore=None):
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*(ignore or []), *SKIP), dirs_exist_ok=True)


def main(cors):
    if OUT.exists():
        shutil.rmtree(OUT)
    site = OUT / "cloudflare" / "site"
    site.mkdir(parents=True)
    shutil.copy(ROOT / "index.html", site / "index.html")
    copy(ROOT / "web", site / "web")
    copy(ROOT / "data", site / "data", ignore=["ndvi_cache"])
    copy(ROOT / "deploy" / "cloudflare" / "functions", OUT / "cloudflare" / "functions")

    space = OUT / "hf-space"
    copy(ROOT / "backend", space / "backend", ignore=["tests", "data", "run.ps1", "requirements.txt"])
    copy(ROOT / "data" / "farm", space / "data" / "farm")
    (space / "pipeline").mkdir(parents=True)
    shutil.copy(ROOT / "pipeline" / "config.toml", space / "pipeline" / "config.toml")
    # A "Gradio" Space is used (the "Docker" choice can be locked on a new account): it runs app.py, and app.py starts the FastAPI backend
    # on port 7860 itself, so no Gradio screen is shown. Environment settings come from this file's variables.
    (space / "README.md").write_text(f"""---
title: TerraOrb API
emoji: 🌧
colorFrom: green
colorTo: blue
sdk: gradio
sdk_version: 5.49.1
python_version: 3.12
app_file: app.py
pinned: false
---

Farm planner backend of TerraOrb (FastAPI + SQLite). Not a public product: it serves the TerraOrb website at {cors}.
Farm and officer sign-in needs an SMS service that is not built yet, so sign-in is switched off here (no MC_DEV).
""", encoding="utf-8")
    (space / "requirements.txt").write_text("\n".join(["fastapi", "uvicorn", "pydantic", "httpx", "numpy"]) + "\n", encoding="utf-8")
    (space / "app.py").write_text(f"""# Starts the TerraOrb farm planner backend (FastAPI) on the port Hugging Face expects.
import os

os.environ.setdefault("MC_DB", "/tmp/terraorb.db")           # the free disk is reset on restart; sign-in is off anyway
os.environ.setdefault("MC_CORS", "{cors}")

import uvicorn

from backend.app.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
""", encoding="utf-8")
    zpath = OUT / "hf-space.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in space.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(space).as_posix())
    n = sum(1 for _ in site.rglob("*") if _.is_file())
    print(f"site: {n} files, {sum(f.stat().st_size for f in site.rglob('*') if f.is_file()) // 1_000_000} MB; hf-space.zip {zpath.stat().st_size // 1000} KB; CORS {cors}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "https://terraorb.pages.dev")
