# Start the farm planner backend for local development (from the repo root: backend\run.ps1).
# MC_DEV=1 returns the one-time login code in the reply so no SMS service is needed.
$env:MC_DEV = "1"
# Development officer number (real officers: set MC_OFFICERS on the server to their phone numbers, comma separated)
if (-not $env:MC_OFFICERS) { $env:MC_OFFICERS = "0770000000" }
$env:PYTHONIOENCODING = "utf-8"
& "$PSScriptRoot\..\.venv\Scripts\python.exe" -m uvicorn backend.app.main:app --reload --port 8000
