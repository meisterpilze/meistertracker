@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Meisterpilze Lab Tracker

REM ============================================================
REM  Self-relaunch guard: git reset overwrites this file mid-run,
REM  which corrupts the batch interpreter on Windows. We copy
REM  ourselves to a temp file and re-execute from there so the
REM  running script is never modified.
REM ============================================================
if not "%~1"=="--relaunched" (
    set "TMPBAT=%TEMP%\meisterpilze_start_%RANDOM%.bat"
    copy /y "%~f0" "!TMPBAT!" >nul
    cmd /c ""!TMPBAT!" --relaunched "%~dp0""
    set "RC=!errorlevel!"
    del "!TMPBAT!" >nul 2>&1
    if !RC! neq 0 ( pause )
    exit /b !RC!
)

REM When relaunched, the second argument is the original directory
cd /d "%~2"

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
        exit /b 1
    )
    call :refresh_path
)
call :check_pm2
if %errorlevel% neq 0 (
    echo  ERROR: PM2 is still not found after installation.
    echo  Please close this window, open a NEW command prompt, and run START.bat again.
    exit /b 1
)
for /f "tokens=*" %%v in ('pm2 --version 2^>nul') do set "PM2_VER=%%v"
echo  -^> PM2 %PM2_VER% found.

REM ============================================================
REM  Step 1: Update code from git
REM ============================================================
echo.
echo [1/5] Updating code from git...
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
echo [2/5] Installing dependencies...
call npm install --omit=dev
if %errorlevel% neq 0 (
    echo  ERROR: npm install failed.
    exit /b 1
)

REM ============================================================
REM  Step 3: Backup data
REM ============================================================
echo.
echo [3/5] Backing up data...
if not exist "backups" mkdir "backups"
if exist "data.json" (
    REM Use PowerShell for reliable timestamp (wmic is deprecated on Windows 11)
    for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%T"
    if not defined TIMESTAMP set "TIMESTAMP=backup"
    copy /y "data.json" "backups\data_!TIMESTAMP!.json" >nul
    echo  -^> data.json backed up.
) else (
    echo  -^> No data.json found, skipping backup.
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

REM Kill any stale node processes on our port before starting
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r "0.0.0.0:3000.*LISTENING"') do (
    echo  -^> Killing stale process on port 3000 ^(PID %%P^)...
    taskkill /PID %%P /F >nul 2>&1
)

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
pm2 show %PM2_PROCESS_NAME% 2>nul | findstr /i /c:"online" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Server process crashed on startup.
    echo.
    echo  Recent error log:
    pm2 logs %PM2_PROCESS_NAME% --lines 15 --nostream --err 2>nul
    echo.
    exit /b 1
)

echo.
echo  ========================================
echo    Server started successfully!
echo    HTTP:  http://localhost:3000
if exist "certs\server.crt" (
    echo    HTTPS: https://localhost:3443
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
    exit /b 0
)
REM Try openssl first (ships with Git for Windows)
where openssl >nul 2>&1
if %errorlevel% equ 0 (
    echo  -^> TLS certificates missing, generating with openssl...
    if not exist "certs" mkdir "certs"
    REM Detect LAN IP via PowerShell
    set "LAN_IP=192.168.1.100"
    for /f "tokens=*" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress"') do set "LAN_IP=%%I"
    echo  -^> LAN IP: !LAN_IP!
    REM Write temp openssl config
    (
        echo [req]
        echo default_bits = 2048
        echo prompt = no
        echo default_md = sha256
        echo distinguished_name = dn
        echo x509_extensions = v3_ext
        echo.
        echo [dn]
        echo CN = Meisterpilze Lab Tracker
        echo.
        echo [v3_ext]
        echo subjectAltName = DNS:localhost,IP:127.0.0.1,IP:!LAN_IP!
        echo basicConstraints = CA:FALSE
        echo keyUsage = digitalSignature, keyEncipherment
    ) > "%TEMP%\meisterpilze_cert.cnf"
    openssl req -x509 -newkey rsa:2048 -nodes -keyout "certs\server.key" -out "certs\server.crt" -days 365 -config "%TEMP%\meisterpilze_cert.cnf"
    if !errorlevel! equ 0 (
        del "%TEMP%\meisterpilze_cert.cnf" >nul 2>&1
        echo  -^> TLS certificate generated.
    ) else (
        del "%TEMP%\meisterpilze_cert.cnf" >nul 2>&1
        echo  -^> WARNING: Certificate generation failed. Server will start in HTTP-only mode.
    )
    exit /b 0
)
REM Fallback: try PowerShell New-SelfSignedCertificate + export to PEM
powershell -NoProfile -Command "Get-Command New-SelfSignedCertificate" >nul 2>&1
if %errorlevel% equ 0 (
    echo  -^> TLS certificates missing, generating with PowerShell...
    if not exist "certs" mkdir "certs"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress; " ^
        "if (-not $lanIp) { $lanIp = '192.168.1.100' }; " ^
        "Write-Host \"  -> LAN IP: $lanIp\"; " ^
        "$cert = New-SelfSignedCertificate -DnsName 'localhost','Meisterpilze Lab Tracker' -TextExtension @(\"2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=$lanIp\") -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(365); " ^
        "$keyBytes = $cert.PrivateKey.ExportRSAPrivateKey(); " ^
        "$keyPem = '-----BEGIN RSA PRIVATE KEY-----' + [Environment]::NewLine + [Convert]::ToBase64String($keyBytes, 'InsertLineBreaks') + [Environment]::NewLine + '-----END RSA PRIVATE KEY-----'; " ^
        "Set-Content -Path 'certs\server.key' -Value $keyPem -NoNewline; " ^
        "$certPem = '-----BEGIN CERTIFICATE-----' + [Environment]::NewLine + [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks') + [Environment]::NewLine + '-----END CERTIFICATE-----'; " ^
        "Set-Content -Path 'certs\server.crt' -Value $certPem -NoNewline; " ^
        "Remove-Item -Path \"Cert:\CurrentUser\My\$($cert.Thumbprint)\" -ErrorAction SilentlyContinue; " ^
        "Write-Host '  -> TLS certificate generated.'"
    if !errorlevel! neq 0 (
        echo  -^> WARNING: Certificate generation failed. Server will start in HTTP-only mode.
    )
    exit /b 0
)
echo  -^> WARNING: Neither openssl nor PowerShell cert tools available.
echo     Server will start in HTTP-only mode ^(iOS camera will not work^).
echo     Install Git for Windows to get openssl, then run START.bat again.
exit /b 0

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
REM Also add common Node.js and Git paths directly as fallback
if exist "%ProgramFiles%\nodejs" set "PATH=!PATH!;%ProgramFiles%\nodejs"
if exist "%ProgramFiles%\Git\cmd" set "PATH=!PATH!;%ProgramFiles%\Git\cmd"
if exist "%ProgramFiles%\Git\usr\bin" set "PATH=!PATH!;%ProgramFiles%\Git\usr\bin"
if exist "%LOCALAPPDATA%\Programs\Git\cmd" set "PATH=!PATH!;%LOCALAPPDATA%\Programs\Git\cmd"
if exist "%APPDATA%\npm" set "PATH=!PATH!;%APPDATA%\npm"
exit /b 0
