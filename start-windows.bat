@echo off
rem Double-click to start Overlay Studio. Keep this window open while you use it.
cd /d "%~dp0"
set OPEN_BROWSER=1
where node >nul 2>nul || (echo Node.js is not installed. Install it from nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules call npm install --no-audit --no-fund
:loop
node src\server.js
if %errorlevel%==75 (echo Restarting with the new version... & goto loop)
pause
