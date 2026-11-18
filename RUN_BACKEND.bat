@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Backend environment not found. Run START_BHARATSATHI.bat first.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
