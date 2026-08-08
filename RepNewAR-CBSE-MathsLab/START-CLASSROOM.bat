@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 18+ and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run verify
if errorlevel 1 (
  echo Verification failed. Do not start the classroom session.
  pause
  exit /b 1
)
echo Starting RepNewAR classroom server...
call npm run dev
