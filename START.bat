@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Meistertracker

REM ============================================================
REM  Phase 1 (outer wrapper): Update code from git FIRST, then
REM  copy the now-updated START.bat to a temp file and re-execute
REM  from there. This ensures the temp copy always has the latest
REM  code, and git reset can never corrupt the running script.
REM ============================================================
if not "%~1"=="--relaunched" (
    echo.
    echo  ========================================
    echo    Meistertracker
    echo  ========================================
    echo.
    echo [1/5] Updating code from git...
    set "IS_WORKTREE=0"
    where git >nul 2>&1
    if !errorlevel! equ 0 (
        set "GIT_DIR_VAL="
        for /f "tokens=*" %%G in ('git rev-parse --git-dir 2^>nul') do set "GIT_DIR_VAL=%%G"
        if defined GIT_DIR_VAL (
            set "WKT_CHECK=!GIT_DIR_VAL:.git/worktrees/=!"
            if not "!WKT_CHECK!"=="!GIT_DIR_VAL!" set "IS_WORKTREE=1"
        )
        if "!IS_WORKTREE!"=="1" (
            REM Auto-configure so a worktree run lives alongside prod:
            REM   - different PORT (default 3001) so prod on 3000 keeps serving
            REM   - different PM2 name so 'pm2 delete' won't touch prod
            REM   - WORKTREE_MODE flag so the server can render a UI warning
            REM Env vars set here are inherited by the Phase 2 temp copy via cmd /c.
            if not defined PORT set "PORT=3001"
            REM Always append -worktree so forks with a custom PM2_PROCESS_NAME
            REM still get isolation. Skip if already suffixed (re-entrant runs).
            if not defined PM2_PROCESS_NAME (
                set "PM2_PROCESS_NAME=meisterpilze-worktree"
            ) else (
                set "PM2_NAME_TAIL=!PM2_PROCESS_NAME:~-9!"
                if not "!PM2_NAME_TAIL!"=="-worktree" set "PM2_PROCESS_NAME=!PM2_PROCESS_NAME!-worktree"
            )
            set "WORKTREE_MODE=1"
            echo.
            echo  +------------------------------------------+
            echo  ^|  Running in git worktree                 ^|
            echo  ^|  Git pull will be skipped                ^|
            echo  +------------------------------------------+
            echo   -^> Port:     !PORT!
            echo   -^> PM2 name: !PM2_PROCESS_NAME!
            echo   -^> Production on port 3000 will NOT be touched.
        ) else if exist ".git" (
            git fetch origin >nul 2>&1
            if !errorlevel! equ 0 (
                git reset --hard origin/main <nul 2>&1
                if !errorlevel! neq 0 (
                    echo  WARNING: git reset had errors ^(locked files?^). Continuing with local code.
                )
            ) else (
                echo  WARNING: git fetch failed. Continuing with local code.
            )
        ) else (
            echo  WARNING: No .git directory found ^(ZIP download?^). Auto-update disabled.
            echo  For auto-updates, re-download with: git clone https://github.com/loewenmaehne/meistertracker.git
        )
    ) else (
        echo  WARNING: Git not found, skipping code update.
    )
    REM Now copy the (possibly updated) START.bat to temp and run from there
    set "TMPBAT=%TEMP%\meisterpilze_start_%RANDOM%.bat"
    copy /y "%~f0" "!TMPBAT!" >nul
    cmd /c ""!TMPBAT!" --relaunched "%~dp0""
    set "RC=!errorlevel!"
    del "!TMPBAT!" >nul 2>&1
    if !RC! neq 0 ( pause )
    exit /b !RC!
)

REM ============================================================
REM  Phase 2 (temp copy): Everything after git update
REM ============================================================
cd /d "%~2"

REM ---- Configuration ----
REM Override via env to run multiple instances under distinct PM2 names
REM or to match a fork's branding. Must match the value server.js reads
REM from PM2_PROCESS_NAME.
if not defined PM2_PROCESS_NAME set "PM2_PROCESS_NAME=meisterpilze"
if not defined PORT set "PORT=3000"
set "NEED_PATH_REFRESH=0"

REM ============================================================
REM  Check and auto-install prerequisites
REM ============================================================

REM ---- Check for admin rights (needed for winget installs) ----
net session >nul 2>&1
if !errorlevel! neq 0 (
    call :check_node
    if !errorlevel! neq 0 (
        echo.
        echo  ERROR: Node.js is missing and this terminal is not running as Administrator.
        echo  winget install requires admin rights. Please right-click START.bat
        echo  and choose "Run as administrator", then try again.
        echo.
        exit /b 1
    )
)

where winget >nul 2>&1
if !errorlevel! neq 0 (
    set "HAS_WINGET=0"
) else (
    set "HAS_WINGET=1"
)

REM ---- Check / Install Node.js ----
call :check_node
if !errorlevel! neq 0 (
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
            exit /b 1
        )
        set "NEED_PATH_REFRESH=1"
    ) else (
        echo  ERROR: Cannot auto-install ^(winget not available^).
        echo  Please install Node.js manually from https://nodejs.org
        echo  Then run this script again.
        echo.
        exit /b 1
    )
)

REM ---- Check / Install Git ----
call :check_git
if !errorlevel! neq 0 (
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
            exit /b 1
        )
        set "NEED_PATH_REFRESH=1"
    ) else (
        echo  WARNING: Git not available.
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
if !errorlevel! neq 0 (
    echo.
    echo  ERROR: Node.js is still not found after installation.
    echo  Please close this window, open a NEW command prompt, and run START.bat again.
    echo  ^(Windows needs a new terminal to pick up the new PATH.^)
    echo.
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo  -^> Node.js %NODE_VER% found.

REM ---- Ensure PM2 ----
call :check_pm2
if !errorlevel! neq 0 (
    echo  PM2 not found, installing globally...
    call npm install -g pm2
    if !errorlevel! neq 0 (
        echo  ERROR: Failed to install PM2.
        exit /b 1
    )
    call :refresh_path
)
call :check_pm2
if !errorlevel! neq 0 (
    echo  ERROR: PM2 is still not found after installation.
    echo  Please close this window, open a NEW command prompt, and run START.bat again.
    exit /b 1
)
for /f "tokens=*" %%v in ('call pm2 --version 2^>nul') do set "PM2_VER=%%v"
echo  -^> PM2 %PM2_VER% found.

REM ============================================================
REM  Step 2: Install dependencies
REM ============================================================
echo.
echo [2/5] Installing dependencies...
call npm install --omit=dev
if !errorlevel! neq 0 (
    echo  ERROR: npm install failed.
    exit /b 1
)

REM ============================================================
REM  Step 3: Backup data
REM ============================================================
echo.
echo [3/5] Backing up data...
if not exist "backups" mkdir "backups"
for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%T"
if not defined TIMESTAMP set "TIMESTAMP=backup"
if exist "meistertracker.db" (
    set "BACKUP_FILE=backups\meistertracker_!TIMESTAMP!.db"
    set "BACKUP_OK=0"
    REM Prefer sqlite3 .backup for a WAL-consistent snapshot. Git for Windows
    REM ships sqlite3 in PATH; fall back to a raw file copy if unavailable.
    where sqlite3 >nul 2>&1
    if !errorlevel! equ 0 (
        sqlite3 meistertracker.db ".backup '!BACKUP_FILE!'" >nul 2>&1
        if !errorlevel! equ 0 (
            echo  -^> meistertracker.db backed up ^(WAL-consistent via sqlite3^).
            set "BACKUP_OK=1"
        )
    )
    if "!BACKUP_OK!"=="0" (
        copy /y "meistertracker.db" "!BACKUP_FILE!" >nul
        echo  -^> meistertracker.db backed up ^(file copy^).
    )
) else (
    echo  -^> No meistertracker.db found, skipping backup.
)
REM Contamination photos (audit Section 2). PowerShell Compress-Archive is
REM available on Windows 10+ by default and matches the tar.gz on Linux.
if exist "data\photos" (
    set "PHOTO_BACKUP=backups\photos_!TIMESTAMP!.zip"
    powershell -NoProfile -Command "try { Compress-Archive -Path 'data\photos\*' -DestinationPath '!PHOTO_BACKUP!' -Force -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
        echo  -^> data\photos archived to !PHOTO_BACKUP!
    ) else (
        echo  -^> WARNING: photo archive failed.
    )
)

REM ============================================================
REM  Step 4: Ensure TLS certificates
REM ============================================================
echo.
echo [4/5] Ensuring TLS certificates...
call :ensure_certs

REM ============================================================
REM  Step 5: Start / Restart server via PM2
REM ============================================================
echo.
echo [5/5] Starting server...

REM Kill stale node processes on our port before starting.
REM In worktree mode skip this entirely so a parallel run never reaches
REM across into the production instance on a different port.
if "%WORKTREE_MODE%"=="1" (
    echo  -^> Worktree mode: skipping stale-port cleanup ^(prod on 3000 untouched^).
) else (
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r "0.0.0.0:%PORT%.*LISTENING"') do (
        echo  -^> Killing stale process on port %PORT% ^(PID %%P^)...
        taskkill /PID %%P /F >nul 2>&1
    )
)

REM Match update_server.sh: always delete + start with --update-env so the
REM new process picks up any .env changes made since the last launch.
call pm2 describe %PM2_PROCESS_NAME% >nul 2>&1
if !errorlevel! equ 0 (
    echo  -^> Process found, deleting for clean restart...
    call pm2 delete %PM2_PROCESS_NAME% >nul 2>&1
)
echo  -^> Starting instance...
call pm2 start server.js --name %PM2_PROCESS_NAME% --update-env
call pm2 save >nul 2>&1

REM Wait briefly for the process to initialize, then verify it stayed up
ping -n 4 127.0.0.1 >nul 2>&1
call pm2 show %PM2_PROCESS_NAME% 2>nul | findstr /i /c:"online" >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  ERROR: Server process crashed on startup.
    echo.
    echo  Recent error log:
    call pm2 logs %PM2_PROCESS_NAME% --lines 15 --nostream --err 2>nul
    echo.
    exit /b 1
)

REM Tag this commit as stable (last known-good deployment).
REM Skip in worktree mode — that tag is for prod only and must not move
REM when running a feature-branch instance.
if not "%WORKTREE_MODE%"=="1" (
    where git >nul 2>&1
    if !errorlevel! equ 0 (
        git tag -f stable HEAD >nul 2>&1
        if !errorlevel! equ 0 (
            echo  -^> Tagged current commit as 'stable'.
        )
    )
)

echo.
echo  ========================================
echo    Server started successfully!
if "%WORKTREE_MODE%"=="1" (
    echo    [WORKTREE INSTANCE - production on 3000 is separate]
)
if exist "certs\server.crt" (
    echo    URL: https://localhost:%PORT%
) else (
    echo    URL: http://localhost:%PORT%
    echo.
    echo    WARNING: No TLS certs found, running HTTP only.
    echo    iOS camera scanning requires HTTPS.
)
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

:ensure_certs
if exist "certs\server.key" if exist "certs\server.crt" (
    echo  -^> TLS certificates found.
    REM LE cert renewal is handled by the server on startup.
    exit /b 0
)
if exist "gen-cert.ps1" (
    echo  -^> TLS certificates missing, generating...
    if defined CERT_DOMAIN (
        echo  -^> Including domain in cert: %CERT_DOMAIN%
        powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\gen-cert.ps1" -Domain "%CERT_DOMAIN%"
    ) else (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\gen-cert.ps1"
    )
    if exist "certs\server.key" if exist "certs\server.crt" (
        echo  -^> TLS certificates generated successfully.
        exit /b 0
    )
    echo  -^> WARNING: Certificate generation failed.
)
if exist "gen-cert.sh" (
    where bash >nul 2>&1
    if !errorlevel! equ 0 (
        echo  -^> Trying gen-cert.sh...
        bash "%CD%/gen-cert.sh"
        if exist "certs\server.key" if exist "certs\server.crt" (
            echo  -^> TLS certificates generated successfully.
            exit /b 0
        )
    )
)
echo  -^> WARNING: Could not generate TLS certificates.
echo     Server will start in HTTP-only mode ^(mobile camera will not work^).
exit /b 0

:refresh_path
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
if exist "%ProgramFiles%\nodejs" set "PATH=!PATH!;%ProgramFiles%\nodejs"
if exist "%ProgramFiles%\Git\cmd" set "PATH=!PATH!;%ProgramFiles%\Git\cmd"
if exist "%ProgramFiles%\Git\usr\bin" set "PATH=!PATH!;%ProgramFiles%\Git\usr\bin"
if exist "%LOCALAPPDATA%\Programs\Git\cmd" set "PATH=!PATH!;%LOCALAPPDATA%\Programs\Git\cmd"
if exist "%APPDATA%\npm" set "PATH=!PATH!;%APPDATA%\npm"
exit /b 0
