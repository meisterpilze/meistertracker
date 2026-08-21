@echo off
REM Launched by the "MeisterTracker" scheduled task at system startup, so the
REM server comes back after a reboot or a crash without anyone logging in.
REM Register the task once with: install-autostart.ps1 (admin PowerShell).
REM
REM stdin from NUL because START.bat ends in `pause` — with no console attached
REM that would leave the task stuck in "Running" forever and block the next run.
REM
REM The log file is the other half of that: under the task the console is hidden,
REM so START.bat's warnings reached nobody. "WARNING: git fetch failed.
REM Continuing with local code." means the machine is running yesterday's code
REM from then on, and "Server will start in HTTP-only mode" means the phones
REM cannot use the camera. Both used to vanish.
cd /d "%~dp0"
call "%~dp0START.bat" <NUL >>"%~dp0autostart.log" 2>&1

REM Pass the exit code on. `exit /b 0` reported every failed boot to Task
REM Scheduler as success, so -RestartCount 3 had nothing to react to: cold WLAN,
REM npm install fails, START.bat exits 1, the task says 0x0, and the farm is down
REM with nobody logged in to notice.
exit /b %errorlevel%
