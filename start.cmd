@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting local panel...
node src\main.js
if errorlevel 1 pause
