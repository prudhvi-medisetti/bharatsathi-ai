@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title BharatSathi AI - Launcher

echo.
echo ================================================
echo        BharatSathi AI - Local Launcher
echo ================================================
echo.

where node >nul 2>&1 || (echo [ERROR] Node.js is not installed. Install Node.js 20+ and run again.&pause&exit /b 1)
where npm >nul 2>&1 || (echo [ERROR] npm is not available.&pause&exit /b 1)
where py >nul 2>&1 || (echo [ERROR] Python launcher is not installed.&pause&exit /b 1)

if not exist "node_modules" (
  echo [1/4] Installing frontend dependencies...
  npm install --cache "%LOCALAPPDATA%\npm-cache" --prefix "%CD%"
  if errorlevel 1 (
    echo.
    echo [ERROR] Frontend installation failed.
    echo Try opening PowerShell and running: npm config delete prefix --location=user
    pause
    exit /b 1
  )
) else (
  echo [1/4] Frontend dependencies already installed.
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo [2/4] Creating Python 3.13 backend environment...
  py -3.13 -m venv "backend\.venv"
  if errorlevel 1 (
    echo [ERROR] Python 3.13 is required. Install Python 3.13 and run again.
    pause
    exit /b 1
  )
) else (
  echo [2/4] Backend environment already exists.
)

if not exist "backend\.venv\.requirements-installed" (
  echo [3/4] Installing backend dependencies...
  "backend\.venv\Scripts\python.exe" -m pip install --upgrade pip
  "backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
  if errorlevel 1 (
    echo [ERROR] Backend dependency installation failed.
    pause
    exit /b 1
  )
  type nul > "backend\.venv\.requirements-installed"
) else (
  echo [3/4] Backend dependencies already installed.
)

if not exist ".env.local" (
  if exist ".env.example" copy /y ".env.example" ".env.local" >nul
)

if not exist "backend\.env" (
  if exist "backend\.env.example" copy /y "backend\.env.example" "backend\.env" >nul
)

if not exist ".env.local" echo VITE_API_BASE_URL=http://localhost:8000>>".env.local"
findstr /b /c:"VITE_API_BASE_URL=" ".env.local" >nul 2>&1 || echo VITE_API_BASE_URL=http://localhost:8000>>".env.local"

echo [4/4] Starting FastAPI and React...
echo.
echo Backend:  http://127.0.0.1:8000/health
echo Frontend: http://localhost:5173/
echo.

start "BharatSathi AI - Backend" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app:app --reload --host 127.0.0.1 --port 8000"
timeout /t 2 /nobreak >nul
start "BharatSathi AI - Frontend" cmd /k "cd /d "%~dp0" && npm run dev -- --host localhost"

timeout /t 4 /nobreak >nul
start "" "http://localhost:5173/"

echo.
echo ================================================
echo BharatSathi AI is starting.
echo Keep both terminal windows open.
echo ================================================
echo.
endlocal
