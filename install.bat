@echo off
setlocal
cd /d "%~dp0"

echo.
echo Installing WA-bot dependencies...
echo This can take a few minutes the first time.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 20 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example
)

rem The app uses the installed Chrome/Edge; skip puppeteer's own Chrome download.
set PUPPETEER_SKIP_DOWNLOAD=true
npm install
if errorlevel 1 (
  echo.
  echo Install failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo Done. Next, double-click start.bat.
pause
