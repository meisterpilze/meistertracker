@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Meisterpilze Lab Tracker
echo.
echo  Meisterpilze Lab Tracker
echo  ========================
echo.

REM ---- Configuration ----
set "PM2_PROCESS_NAME=meisterpilze"

REM ---- Check Node.js ----
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed or not in PATH.
    echo  Download it from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo  -^> Node.js %NODE_VER% found.

REM ---- Ensure PM2 ----
where pm2 >nul 2>&1
if %errorlevel% neq 0 (
    echo  PM2 not found, installing globally...
    call npm install -g pm2
    if %errorlevel% neq 0 (
        echo  ERROR: Failed to install PM2.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('pm2 --version') do set "PM2_VER=%%v"
echo  -^> PM2 %PM2_VER% found.

REM ---- Step 1: Update code from git ----
echo.
echo [1/4] Updating code from git (reset to origin/main)...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  WARNING: Git not found, skipping code update.
    goto :skip_git
)
git fetch origin
if %errorlevel% neq 0 (
    echo  ERROR: git fetch failed.
    pause
    exit /b 1
)
git reset --hard origin/main
if %errorlevel% neq 0 (
    echo  ERROR: git reset --hard origin/main failed.
    pause
    exit /b 1
)
:skip_git

REM ---- Step 2: Install dependencies ----
echo.
echo [2/4] Installing dependencies...
call npm install --production
if %errorlevel% neq 0 (
    echo  ERROR: npm install failed.
    pause
    exit /b 1
)

REM ---- Step 3: Backup data ----
echo.
echo [3/4] Backing up data...
if not exist "backups" mkdir "backups"
if exist "data.json" (
    set "TIMESTAMP=%date:~-4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
    set "TIMESTAMP=!TIMESTAMP: =0!"
    copy /y "data.json" "backups\data_!TIMESTAMP!.json" >nul
    echo  -^> data.json backed up.
) else (
    echo  -^> No data.json found, skipping backup.
)

REM ---- Step 4: Restart server via PM2 ----
echo.
echo [4/4] Restarting server...
pm2 describe %PM2_PROCESS_NAME% >nul 2>&1
if %errorlevel% equ 0 (
    echo  -^> Process found, attempting reload...
    pm2 reload %PM2_PROCESS_NAME% 2>nul || pm2 restart %PM2_PROCESS_NAME%
) else (
    echo  -^> Process not found in PM2, starting new instance...
    pm2 start server.js --name %PM2_PROCESS_NAME%
    pm2 save
)

echo.
echo ==== Update Completed Successfully ====
echo Run 'pm2 logs %PM2_PROCESS_NAME%' to see output.
echo.
pause
