@echo off
rem Unwrapped at a stand: runs the built game from this laptop, no Wi-Fi needed.
rem Double-click it. Close this window to stop the game.
rem
rem   The key left of 1 (the º key on a Spanish keyboard) resets everything
rem   for the next visitor.
rem   Pass a world to open a different song:  event.cmd my-way

set WORLD=%1
cd /d "%~dp0..\dist_static"
if not exist index.html (
  echo dist_static is missing. Build it first:  bash scripts/deploy_pages.sh
  pause
  exit /b 1
)
start "Unwrapped server" /min python -m http.server 8080 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
if "%WORLD%"=="" (
  start "" "http://localhost:8080/?event"
) else (
  start "" "http://localhost:8080/?event&world=%WORLD%"
)
echo Unwrapped is running at http://localhost:8080/?event
echo Close the "Unwrapped server" window to stop it.
