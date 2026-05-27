@echo off
setlocal
cd /d "%~dp0"
node signal-lm-telemetry-server.js
pause
