<#
.SYNOPSIS
  Make MeisterTracker start at system boot, without waiting for a Windows login.

.DESCRIPTION
  The Startup-folder shortcut only fires after someone signs in, so after a
  reboot or a crash the server stays down until a human sits at the machine.
  This registers a scheduled task that starts it at boot instead.

  Run ONCE, from an elevated PowerShell:

      powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1

  Afterwards DELETE the Startup-folder entry:
      "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Meisterpilze_Server.bat"

  This is not optional. The trigger waits one minute (PT1M below) and the login
  screen appears well before that, so signing in at boot starts the Startup
  entry's run while the task's run is still to come. Both then execute
  `git reset --hard origin/main` against one working tree (index.lock, and the
  failure path only warns and carries on against a half-reset checkout), both
  run `npm install` against one node_modules, both taskkill whatever is
  listening on PORT -- including the instance the other one just started -- and
  both pm2 delete/start. The likely result is a broken node_modules and no
  server at all, after the boot the task was added to protect.

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
# RunLevel Limited, deliberately. S4U plus the loaded profile is what the two
# stated reasons need; elevation is not. And elevation here is not free: the
# server exposes POST /api/webhook/github, which authenticates with an HMAC
# secret and no session, and that path runs the update chain below --
# `git reset --hard origin/main`, `npm install`, `pm2 start`. With an
# administrator token, anyone holding that secret, or one poisoned dependency
# version, gets unattended local administrator on the farm PC. The certificates
# go through DNS-01, so no privileged port is bound either.
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
