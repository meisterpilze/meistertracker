@echo off
title Meisterpilze Lab Tracker
echo.
echo  Meisterpilze Lab Tracker
echo  ========================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed.
    echo  Download it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

where bash >nul 2>&1
if %errorlevel% equ 0 (
    echo  Running update_server.sh ...
    cd /d "%~dp0"
    bash update_server.sh
) else (
    echo  bash not found, falling back to Git Bash...
    where git >nul 2>&1
    if %errorlevel% equ 0 (
        cd /d "%~dp0"
        "C:\Program Files\Git\bin\bash.exe" update_server.sh
    ) else (
        echo  ERROR: Neither bash nor Git Bash found.
        echo  Install Git for Windows from https://git-scm.com
        echo.
        pause
        exit /b 1
    )
)

pause
