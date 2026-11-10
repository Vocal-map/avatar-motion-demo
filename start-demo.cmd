@echo off
cd /d "%~dp0"
if not exist node_modules\pinyin-pro\package.json (
  echo Installing required dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Starting MILO at http://127.0.0.1:5173
echo Keep this window open while using the demo. Press Ctrl+C to stop.
node scripts\serve.mjs
pause
