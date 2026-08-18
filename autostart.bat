@echo off
REM Launched by the "MeisterTracker" scheduled task at system startup, so the
REM server comes back after a reboot or a crash without anyone logging in.
REM Register the task once with: install-autostart.ps1 (admin PowerShell).
REM
REM stdin from NUL because START.bat ends in `pause` — with no console attached
REM that would leave the task stuck in "Running" forever and block the next run.
cd /d "%~dp0"
call "%~dp0START.bat" <NUL
exit /b 0
