@echo off
rem CCTV Platform - double-click to update on Windows (runs install\update.ps1 as administrator).
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\update.ps1" %*
echo.
pause
