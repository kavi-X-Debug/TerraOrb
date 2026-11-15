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
    (space / "README.md").write_text(f"""---
title: TerraOrb API
emoji: \U0001F327
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

Farm planner backend of TerraOrb (FastAPI + SQLite). Not a public product: it serves the TerraOrb website at {cors}.
Farm and officer sign-in needs an SMS service that is not built yet, so sign-in is switched off here (no MC_DEV).
""", encoding="utf-8")
    (space / "Dockerfile").write_text(f"""FROM python:3.12-slim
RUN useradd -m -u 1000 user
USER user
ENV PATH=/home/user/.local/bin:$PATH MC_DB=/tmp/terraorb.db MC_CORS={cors} PYTHONUNBUFFERED=1
WORKDIR /home/user/app
RUN pip install --no-cache-dir fastapi uvicorn pydantic httpx numpy
COPY --chown=user . .
EXPOSE 7860
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
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
