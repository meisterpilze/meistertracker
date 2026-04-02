@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Meisterpilze Lab Tracker
echo.
echo  ========================================
echo    Meisterpilze Lab Tracker
echo  ========================================
echo.

REM ---- Configuration ----
set "PM2_PROCESS_NAME=meisterpilze"
set "NEED_PATH_REFRESH=0"

REM ============================================================
REM  Check and auto-install prerequisites
REM ============================================================

REM ---- Check winget availability (needed for auto-install) ----
where winget >nul 2>&1
if %errorlevel% neq 0 (
    set "HAS_WINGET=0"
) else (
    set "HAS_WINGET=1"
)

REM ---- Check / Install Node.js ----
call :check_node
if %errorlevel% neq 0 (
    echo.
    echo  Node.js is not installed.
    if "!HAS_WINGET!"=="1" (
        echo  Installing Node.js automatically via winget...
        echo.
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if !errorlevel! neq 0 (
            echo.
            echo  ERROR: Automatic Node.js installation failed.
            echo  Please install manually from https://nodejs.org
            pause
            exit /b 1
        )
        set "NEED_PATH_REFRESH=1"
    ) else (
        echo  ERROR: Cannot auto-install ^(winget not available^).
        echo  Please install Node.js manually from https://nodejs.org
        echo  Then run this script again.
        echo.
        pause
        exit /b 1
    )
)

REM ---- Check / Install Git ----
call :check_git
if %errorlevel% neq 0 (
    echo.
    echo  Git is not installed.
    if "!HAS_WINGET!"=="1" (
        echo  Installing Git automatically via winget...
        echo.
        winget install Git.Git --accept-source-agreements --accept-package-agreements
        if !errorlevel! neq 0 (
            echo.
            echo  ERROR: Automatic Git installation failed.
            echo  Please install manually from https://git-scm.com
            pause
            exit /b 1
        )
        set "NEED_PATH_REFRESH=1"
    ) else (
        echo  WARNING: Git not available. Skipping code update.
    )
)

REM ---- Refresh PATH if we installed anything ----
if "!NEED_PATH_REFRESH!"=="1" (
    echo.
    echo  Refreshing system PATH...
    call :refresh_path
)

REM ---- Verify Node.js is now available ----
call :check_node
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Node.js is still not found after installation.
    echo  Please close this window, open a NEW command prompt, and run START.bat again.
    echo  ^(Windows needs a new terminal to pick up the new PATH.^)
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo  -^> Node.js %NODE_VER% found.

REM ---- Ensure PM2 ----
call :check_pm2
if %errorlevel% neq 0 (
    echo  PM2 not found, installing globally...
    call npm install -g pm2
    if !errorlevel! neq 0 (
        echo  ERROR: Failed to install PM2.
        pause
        exit /b 1
    )
    call :refresh_path
)
call :check_pm2
if %errorlevel% neq 0 (
    echo  ERROR: PM2 is still not found after installation.
    echo  Please close this window, open a NEW command prompt, and run START.bat again.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('pm2 --version 2^>nul') do set "PM2_VER=%%v"
echo  -^> PM2 %PM2_VER% found.

REM ============================================================
REM  Step 1: Update code from git
REM ============================================================
echo.
echo [1/4] Updating code from git...
call :check_git
if %errorlevel% neq 0 (
    echo  WARNING: Git not found, skipping code update.
    goto :skip_git
)
git fetch origin
if %errorlevel% neq 0 (
    echo  WARNING: git fetch failed ^(no network?^). Continuing with local code.
    goto :skip_git
)
git reset --hard origin/main
if %errorlevel% neq 0 (
    echo  WARNING: git reset failed. Continuing with local code.
)
:skip_git

REM ============================================================
REM  Step 2: Install dependencies
REM ============================================================
echo.
echo [2/4] Installing dependencies...
call npm install --production
if %errorlevel% neq 0 (
    echo  ERROR: npm install failed.
    pause
    exit /b 1
)

REM ============================================================
REM  Step 3: Backup data
REM ============================================================
echo.
echo [3/4] Backing up data...
if not exist "backups" mkdir "backups"
if exist "data.json" (
    REM Use wmic for locale-independent timestamp
    for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set "DT=%%I"
    if defined DT (
        set "TIMESTAMP=!DT:~0,4!!DT:~4,2!!DT:~6,2!_!DT:~8,2!!DT:~10,2!!DT:~12,2!"
    ) else (
        set "TIMESTAMP=backup"
    )
    copy /y "data.json" "backups\data_!TIMESTAMP!.json" >nul
    echo  -^> data.json backed up.
) else (
    echo  -^> No data.json found, skipping backup.
)

REM ============================================================
REM  Step 4: Start / Restart server via PM2
REM ============================================================
echo.
echo [4/4] Starting server...
pm2 describe %PM2_PROCESS_NAME% >nul 2>&1
if %errorlevel% equ 0 (
    echo  -^> Process found, restarting...
    pm2 restart %PM2_PROCESS_NAME%
    if !errorlevel! neq 0 (
        echo  -^> Restart failed, deleting and re-creating...
        pm2 delete %PM2_PROCESS_NAME% >nul 2>&1
        pm2 start server.js --name %PM2_PROCESS_NAME%
    )
) else (
    echo  -^> Starting new instance...
    pm2 start server.js --name %PM2_PROCESS_NAME%
)
pm2 save >nul 2>&1

REM Wait briefly for the process to initialize, then verify it stayed up
timeout /t 3 /nobreak >nul
pm2 describe %PM2_PROCESS_NAME% 2>nul | findstr /i "online" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Server process crashed on startup.
    echo.
    echo  To see the error run:
    echo    pm2 logs %PM2_PROCESS_NAME%
    echo.
    pause
    exit /b 1
)

echo.
echo  ========================================
echo    Server started successfully!
echo    Open http://localhost:3000 in your browser.
echo    Run 'pm2 logs %PM2_PROCESS_NAME%' to see output.
echo  ========================================
echo.
pause
exit /b 0

REM ============================================================
REM  Helper functions
REM ============================================================

:check_node
where node >nul 2>&1
exit /b %errorlevel%

:check_git
where git >nul 2>&1
exit /b %errorlevel%

:check_pm2
where pm2 >nul 2>&1
exit /b %errorlevel%

:refresh_path
REM Rebuild PATH from registry (Machine + User) so newly installed tools are found
REM without needing to restart the terminal
set "NEWPATH="
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "NEWPATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do (
    if defined NEWPATH (
        set "NEWPATH=!NEWPATH!;%%B"
    ) else (
        set "NEWPATH=%%B"
    )
)
if defined NEWPATH (
    set "PATH=!NEWPATH!;%SystemRoot%\system32;%SystemRoot%"
)
exit /b 0
