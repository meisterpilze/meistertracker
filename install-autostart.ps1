<#
.SYNOPSIS
  Make MeisterTracker start at system boot, without waiting for a Windows login.

.DESCRIPTION
  The Startup-folder shortcut only fires after someone signs in, so after a
  reboot or a crash the server stays down until a human sits at the machine.
  This registers a scheduled task that starts it at boot instead.

  Run ONCE, from an elevated PowerShell:

      powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1

  Afterwards you can delete the Startup-folder entry:
      "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Meisterpilze_Server.bat"
  Leaving it in place is harmless — it just restarts the server once more at
  each login.

.NOTES
  Uninstall with:  Unregister-ScheduledTask -TaskName MeisterTracker -Confirm:$false
#>

$ErrorActionPreference = 'Stop'

$TaskName = 'MeisterTracker'
$Wrapper  = Join-Path $PSScriptRoot 'autostart.bat'
$User     = "$env:USERDOMAIN\$env:USERNAME"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "This needs an elevated shell. Right-click PowerShell -> 'Als Administrator ausfuehren', then run it again."
}
if (-not (Test-Path $Wrapper)) {
    throw "autostart.bat not found next to this script (expected at $Wrapper)."
}

$action = New-ScheduledTaskAction -Execute $Wrapper -WorkingDirectory $PSScriptRoot

# One minute of grace so the WLAN is associated before the server binds and
# tries its first DuckDNS update.
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'

# S4U runs as this user with the profile loaded but needs no stored password.
# The server needs the user profile for the pm2 home and the printer spooler.
#
# RunLevel Limited, not Highest, and the reason is pm2 rather than security.
#
# pm2 talks to its daemon over \\.\pipe\rpc.sock. A pipe created by an elevated
# process cannot be opened by a non-elevated one, so a boot instance started at
# Highest is unreachable from an ordinary START.bat window: `pm2 describe` and
# `pm2 start` both fail with EPERM, and taskkill cannot stop the process either.
# The result is a machine where the server runs but can never be updated, and
# START.bat reports "Server process crashed on startup" while the healthy
# instance it could not replace keeps serving yesterday's code.
#
# Nothing in START.bat needs administrator rights. The only privileged-looking
# thing the server does is bind port 80 for the HTTP→HTTPS redirect, which
# Windows permits unprivileged and which already degrades cleanly — server.js
# catches EACCES and EADDRINUSE there and continues in HTTPS-only mode.
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2)

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Starts MeisterTracker (pm2) at system boot, before any user logs in.' `
    -Force | Out-Null

Write-Host ""
Write-Host "  Registered scheduled task '$TaskName' -> $Wrapper" -ForegroundColor Green
Write-Host "  Runs as $User at boot, 1 min delay, no login required."
Write-Host ""
Write-Host "  Test it now (restarts the server, ~10 s downtime):" -ForegroundColor Yellow
Write-Host "      Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Then check:  pm2 list"
Write-Host ""
