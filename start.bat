@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 20 LTS from https://nodejs.org/ and run install.bat again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dependencies are missing. Running install first...
  call install.bat
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
)

start "" "http://127.0.0.1:3000"
echo.
echo Starting WA-bot...
echo Keep this window open while scheduled messages need to be sent.
echo Close this window to stop the app.
echo.
npm start

echo.
echo WA-bot stopped.
pause
