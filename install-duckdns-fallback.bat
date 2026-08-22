@echo off
REM Double-click this to install the DuckDNS fallback task.
REM
REM It exists so the one-time setup step is a double-click and a UAC click,
REM rather than four instructions about opening PowerShell as Administrator.
REM The PowerShell script asks Windows for the rights it needs on its own, so
REM this wrapper does not need to be run as administrator.
REM
REM The PowerShell script holds its own window open to show the result, so a
REM successful run needs no PAUSE here. A failure *before* it gets that far --
REM node missing, execution policy blocked by group policy, a declined UAC
REM prompt -- is reported in THIS window, which would otherwise close on a
REM double-click before anyone could read it. So: pause only when something
REM went wrong.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install-duckdns-fallback.ps1" %*
if errorlevel 1 (
  echo.
  echo Installation did not complete.
  pause
)
