@echo off
cd /d "%~dp0"
echo Starting MILO at http://127.0.0.1:5173
echo Keep this window open while using the demo. Press Ctrl+C to stop.
node scripts\serve.mjs
pause
