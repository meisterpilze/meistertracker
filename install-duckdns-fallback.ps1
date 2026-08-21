<#
.SYNOPSIS
  Install the DuckDNS fallback task (Windows), so the record keeps moving while
  the server is down.

.DESCRIPTION
  The server updates its own DuckDNS record while it runs. The gap it cannot
  close is the one where it is not running — a failed update, a reboot where pm2
  never came back, a crash nobody saw. The address changes anyway, and by the
  time somebody starts the server again the name it answers on points at
  somebody else.

  This registers a scheduled task that runs scripts/duckdns-fallback.js every
  five minutes, and two minutes after boot. It costs nothing while the server is
  healthy: the script reads one row, sees a recent update and exits without
  opening a socket. Only a timestamp older than twelve minutes makes it act, so
  the two never both update.

  Run ONCE, from an elevated PowerShell:

      powershell -ExecutionPolicy Bypass -File .\install-duckdns-fallback.ps1

  This is the Windows counterpart of scripts/install-duckdns-fallback.sh.
  It is separate from install-autostart.ps1 and does not replace it: that one
  starts the server, this one covers the times it is not started.

.NOTES
  Uninstall with:
      powershell -ExecutionPolicy Bypass -File .\install-duckdns-fallback.ps1 -Uninstall
#>

param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$TaskName = 'MeisterTrackerDuckDNS'
$Script   = Join-Path $PSScriptRoot 'scripts\duckdns-fallback.js'
$User     = "$env:USERDOMAIN\$env:USERNAME"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "This needs an elevated shell. Right-click PowerShell -> 'Als Administrator ausfuehren', then run it again."
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  Removed scheduled task '$TaskName'." -ForegroundColor Green
    return
}

if (-not (Test-Path $Script)) {
    throw "duckdns-fallback.js not found (expected at $Script)."
}

# A worktree carries the same token and would fight the real instance over the
# external record. The script refuses to run from one; refuse to install it
# there too, so the mistake surfaces now instead of in a task history nobody
# opens. A worktree's .git is a file pointing at the parent repository.
$GitPath = Join-Path $PSScriptRoot '.git'
if ((Test-Path $GitPath) -and -not (Get-Item $GitPath).PSIsContainer) {
    throw "$PSScriptRoot is a git worktree. Install this from the deployment checkout."
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
    throw "node not found in PATH. A scheduled task needs an absolute path to it."
}

$action = New-ScheduledTaskAction -Execute $Node `
    -Argument "`"$Script`" --quiet" -WorkingDirectory $PSScriptRoot

# Two minutes after boot: late enough that the server has had its chance to
# start and update the record itself, early enough to cover the reboot where it
# did not come back at all.
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT2M'

# And every five minutes thereafter, matching the server's own cadence.
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)

# S4U runs as this user with the profile loaded but needs no stored password.
# It has to be the user that owns meistertracker.db, because writing the
# updated timestamp back is half the job.
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Highest

# A run that stalls must not keep the next one out, and a laptop on battery is
# exactly the machine whose address has just changed.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger @($boot, $repeat) -Principal $principal -Settings $settings `
    -Description 'Updates the DuckDNS record while the MeisterTracker server is not running.' `
    -Force | Out-Null

Write-Host ""
Write-Host "  Registered scheduled task '$TaskName'." -ForegroundColor Green
Write-Host "  Runs as $User, every 5 min and 2 min after boot."
Write-Host "  It stands down whenever the server is updating the record itself."
Write-Host ""
Write-Host "  Prove it works without waiting for a real outage:" -ForegroundColor Yellow
Write-Host "      node `"$Script`" --force"
Write-Host "  See when it last ran and what it returned (0 is good):"
Write-Host "      Get-ScheduledTaskInfo -TaskName $TaskName"
Write-Host ""
