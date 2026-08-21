@echo off
REM Double-click this to install the DuckDNS fallback task.
REM
REM It exists so the one-time setup step is a double-click and a UAC click,
REM rather than four instructions about opening PowerShell as Administrator.
REM The PowerShell script asks Windows for the rights it needs on its own, so
REM this wrapper does not need to be run as administrator.
REM
REM No PAUSE here on purpose: when elevation happens, the elevated window is
REM the one that holds itself open to show the result, and pausing here as well
REM would mean two "press a key" prompts for one install.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install-duckdns-fallback.ps1" %*
