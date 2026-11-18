@echo off
taskkill /FI "WINDOWTITLE eq BharatSathi AI - Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq BharatSathi AI - Frontend*" /T /F >nul 2>&1
echo BharatSathi AI processes stopped.
pause
