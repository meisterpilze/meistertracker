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

REM ---- Drop administrator rights before anything can start pm2 ----
REM
REM pm2's daemon, its pipe and the server it starts all inherit the token of
REM whatever starts pm2 first. Started with administrator rights, they belong
REM to Administrators, and an ordinary window can then neither stop the server
REM nor send pm2 a command: taskkill is refused, and pm2 fails with
REM "connect EPERM //./pipe/rpc.sock".
REM
REM The boot task is where that comes from. It runs this script through an
REM S4U logon, and Windows does not apply a task's RunLevel to S4U: registered
REM Limited, the boot run still gets the full administrator token. So neither
REM re-registering the task nor asking the scheduler to end it could help --
REM and the task had long finished anyway, leaving pm2 behind.
REM
REM A run that finds itself elevated therefore hands itself to
REM scripts\unelevated.ps1, which runs it again as a standard user. Not when
REM Node.js or Git is missing: installing those is the one thing here that
REM does need administrator rights.
REM
REM The second run deletes the marker file first thing. If it is still there
REM afterwards, the helper never got as far as starting it -- and this run
REM carries on with its rights rather than leave the machine without a server.
REM
REM Keep `exit /b` the last command of every block it sits in. Anything after
REM it in the same block, even a line that never runs, makes cmd /c exit 0 --
REM and then Phase 1 takes a failed second run for a good one and does not
REM stop to show the error.
set "SELF=%~f0"
set "HERE=%~2"
if "%~3"=="--unelevated" (
    if defined UNELEVATED_MARK del "!UNELEVATED_MARK!" >nul 2>&1
) else (
    call :check_admin
    if !errorlevel! equ 0 (
        call :check_node
        if !errorlevel! equ 0 call :check_git
        if !errorlevel! equ 0 (
            set "UNELEVATED_ARGS=/d /c ""!SELF!" --relaunched "!HERE!" --unelevated""
            set "UNELEVATED_MARK=!TEMP!\meisterpilze_unelevated_!RANDOM!.mark"
            type nul > "!UNELEVATED_MARK!"
            powershell -NoProfile -ExecutionPolicy Bypass -File "!HERE!scripts\unelevated.ps1"
            set "UNELEVATED_RC=!errorlevel!"
            if exist "!UNELEVATED_MARK!" (
                del "!UNELEVATED_MARK!" >nul 2>&1
                echo  WARNING: could not drop administrator rights; continuing with them.
            ) else (
                exit /b !UNELEVATED_RC!
            )
        )
    )
)

REM ============================================================
REM  Check and auto-install prerequisites
REM ============================================================

REM ---- Check for admin rights (needed for winget installs) ----
call :check_admin
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
REM The version comes from pm2's package.json, not from `pm2 --version`. Every
REM pm2 command, --version included, connects to the daemon first and starts
REM one when it cannot -- so with the boot instance's daemon out of reach, each
REM run left a second daemon behind that could never take over the pipe. Step 5
REM checks the daemon before the first pm2 command.
set "PM2_VER="
set "PM2_PKG="
for /f "delims=" %%P in ('where pm2.cmd 2^>nul') do if not defined PM2_PKG set "PM2_PKG=%%~dpPnode_modules\pm2\package.json"
if defined PM2_PKG if exist "!PM2_PKG!" (
    for /f "delims=" %%v in ('node -p "require(process.argv[1]).version" "!PM2_PKG!" 2^>nul') do set "PM2_VER=%%v"
)
if defined PM2_VER (
    echo  -^> PM2 !PM2_VER! found.
) else (
    echo  -^> PM2 found.
)

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
    REM node runs the server, so it is always here. The sqlite3 CLI is not:
    REM Git for Windows does not ship it, so the raw-copy branch below was not
    REM a fallback at all, it was the path that always ran. And `copy` takes
    REM meistertracker.db alone: in WAL mode that file is only as current as the
    REM last checkpoint, so every snapshot silently dropped whatever was still
    REM sitting in meistertracker.db-wal.
    node "scripts\backup-db.js" "meistertracker.db" "!BACKUP_FILE!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo  -^> meistertracker.db backed up ^(WAL-consistent^).
        set "BACKUP_OK=1"
    )
    if "!BACKUP_OK!"=="0" (
        where sqlite3 >nul 2>&1
        if !errorlevel! equ 0 (
            sqlite3 meistertracker.db ".backup '!BACKUP_FILE!'" >nul 2>&1
            if !errorlevel! equ 0 (
                echo  -^> meistertracker.db backed up ^(WAL-consistent via sqlite3^).
                set "BACKUP_OK=1"
            )
        )
    )
    if "!BACKUP_OK!"=="0" (
        copy /y "meistertracker.db" "!BACKUP_FILE!" >nul
        echo  -^> WARNING: raw file copy only. Anything still in meistertracker.db-wal
        echo     is NOT in this snapshot. Check that scripts\backup-db.js is present.
    )
) else (
    echo  -^> No meistertracker.db found, skipping backup.
)
REM The photos are not zipped here any more. Every start zipped all of
REM data\photos again, onto this same disk, and no zip was ever deleted:
REM the same pictures piling up until the disk is full. The server keeps a
REM second copy under backups\photos as hard links, which cost no space, and
REM the USB stick backup copies each photo once. An update does not touch
REM photo files anyway; what it changes is the database, saved above.

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

REM ---- Can this window send pm2 a command at all? ----
REM Every pm2 command connects to the daemon over a named pipe first. A daemon
REM started with administrator rights owns that pipe as Administrators, and
REM this window may then read it but not write to it: pm2 fails with
REM "connect EPERM //./pipe/rpc.sock" and a stack trace, which reads like the
REM application crashing, after starting a second daemon that can never take
REM the pipe over. So ask before the first pm2 command, and say what it is.
REM Worktree runs ask too -- there is one daemon per machine, and they use it.
set "PM2_ACCESS="
for /f "delims=" %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\pm2-access.ps1" 2^>nul') do set "PM2_ACCESS=%%A"
if "!PM2_ACCESS!"=="denied" (
    echo.
    echo  ERROR: pm2 runs with administrator rights, and this window has none.
    echo.
    echo  Every pm2 command from here is refused, so the server can be neither
    echo  stopped nor updated. Its daemon was started elevated: by the boot
    echo  task, before this script learned to drop those rights, or from a
    echo  window run as administrator.
    echo.
    echo  Once, in an Administrator PowerShell:
    echo      ^& "$env:APPDATA\npm\pm2.cmd" kill
    echo  then run this script again.
    echo.
    echo  If this is back after the next restart, the boot run could not drop
    echo  its rights. It wrote down why in %TEMP%\meistertracker-unelevated.log
    echo.
    pause
    exit /b 1
)

REM Match update_server.sh: always delete + start with --update-env so the
REM new process picks up any .env changes made since the last launch.
REM Through pm2 first, before anything is killed on the port: a process pm2
REM runs, killed from outside, is one pm2 starts straight back up.
call pm2 describe %PM2_PROCESS_NAME% >nul 2>&1
if !errorlevel! equ 0 (
    echo  -^> Process found, deleting for clean restart...
    call pm2 delete %PM2_PROCESS_NAME% >nul 2>&1
)

REM Then kill whatever else still holds our port, and look again rather than
REM assume: taskkill's refusal goes to nul, and a refused kill printed exactly
REM what a successful one does.
REM In worktree mode skip this entirely so a parallel run never reaches
REM across into the production instance on a different port.
if "%WORKTREE_MODE%"=="1" (
    echo  -^> Worktree mode: skipping stale-port cleanup ^(prod on 3000 untouched^).
) else (
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r "0.0.0.0:%PORT%.*LISTENING"') do (
        echo  -^> Killing stale process on port %PORT% ^(PID %%P^)...
        taskkill /PID %%P /F >nul 2>&1
    )
    set "PORT_HOLDER="
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r "0.0.0.0:%PORT%.*LISTENING"') do set "PORT_HOLDER=%%P"
    if defined PORT_HOLDER (
        set "HOLDER_NAME=unknown program"
        for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq !PORT_HOLDER!" /FO CSV /NH 2^>nul') do set "HOLDER_NAME=%%~N"
        echo.
        echo  ERROR: port %PORT% is held by PID !PORT_HOLDER! ^(!HOLDER_NAME!^), and this window cannot stop it.
        echo.
        echo  It is not run by the pm2 this window talks to - that one was asked
        echo  first. To stop it, in an Administrator PowerShell:
        echo      Stop-Process -Id !PORT_HOLDER! -Force
        echo  then run this script again.
        echo.
        pause
        exit /b 1
    )
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

:check_admin
REM Listing file system filters is for administrators only. Unlike
REM `net session`, fltmc does not need the Server service to be running.
fltmc >nul 2>&1
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
