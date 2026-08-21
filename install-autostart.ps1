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
  -Uninstall removes the task again. -Status shows whether it is registered.
#>

param(
    [switch] $Uninstall,
    [switch] $Status
)

$ErrorActionPreference = 'Stop'

$TaskName = 'MeisterTracker'
$Wrapper  = Join-Path $PSScriptRoot 'autostart.bat'
$User     = "$env:USERDOMAIN\$env:USERNAME"

# Same shape as scripts/print-bridge.ps1, which has done this for a while:
# elevate rather than tell the operator to start over in a different window, and
# offer the way back out. Telling someone to type
# `Unregister-ScheduledTask ...` from a comment they can only read by opening
# the file is not an uninstall path.
function Test-IsAdmin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$current).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-AsAdmin {
    param([string[]] $ForwardedArgs)
    Write-Host 'Re-launching with administrator privileges...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"") + $ForwardedArgs
    Start-Process powershell -ArgumentList $argList -Verb RunAs
    exit 0
}

if ($Status) {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($t) {
        Write-Host "Registered. RunLevel: $($t.Principal.RunLevel), LogonType: $($t.Principal.LogonType)"
        Get-ScheduledTaskInfo -TaskName $TaskName | Format-List TaskName, LastRunTime, LastTaskResult, NumberOfMissedRuns
    } else {
        Write-Host "Not registered."
    }
    exit 0
}

if (-not (Test-IsAdmin)) {
    $forward = @()
    if ($Uninstall) { $forward += '-Uninstall' }
    Invoke-AsAdmin -ForwardedArgs $forward
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Task '$TaskName' removed. The server will not come back at the next boot."
    exit 0
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
