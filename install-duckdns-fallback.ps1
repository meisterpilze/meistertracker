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

  Run ONCE. Double-click install-duckdns-fallback.bat, or from any PowerShell:

      powershell -ExecutionPolicy Bypass -File .\install-duckdns-fallback.ps1

  It asks Windows for administrator rights itself, so an ordinary shell is
  fine — answer the UAC prompt and it carries on in an elevated window.

  Administrator is needed for the part that matters, and only that part: a task
  registered by an ordinary user runs only while that user is signed in, which
  misses the case this exists for — the machine rebooted and nobody logged in.
  Running without a session, and the at-boot trigger, both need S4U, and S4U
  needs an elevated shell to register. Nothing here runs elevated afterwards;
  the script itself only reads a database file and makes one HTTPS request.

  This is the Windows counterpart of scripts/install-duckdns-fallback.sh.
  It is separate from install-autostart.ps1 and does not replace it: that one
  starts the server, this one covers the times it is not started.

.NOTES
  Uninstall with:
      powershell -ExecutionPolicy Bypass -File .\install-duckdns-fallback.ps1 -Uninstall
#>

param(
    [switch]$Uninstall,
    # Set by the elevated copy this script starts of itself. It means "you are
    # the child in a window the user did not open", which is the only reason to
    # hold that window open at the end — otherwise the result flashes past and
    # nobody ever learns whether it worked.
    [switch]$Elevated,
    # Who the task should run as, carried across the elevation boundary.
    #
    # Not a refinement: UAC can be answered with a *different* account's
    # credentials, and then $env:USERNAME in the elevated child is that
    # administrator rather than the person who owns meistertracker.db. The task
    # would be registered for someone with no business reading it, and would
    # fail every five minutes for a reason nothing on screen explains. The
    # unelevated parent is the one that knows the right answer, so it says.
    [string]$TargetUser
)

$ErrorActionPreference = 'Stop'

$TaskName = 'MeisterTrackerDuckDNS'
$Script   = Join-Path $PSScriptRoot 'scripts\duckdns-fallback.js'
$User     = if ($TargetUser) { $TargetUser } else { "$env:USERDOMAIN\$env:USERNAME" }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

# Ask for the rights rather than telling the reader to go and find them. A
# one-time setup step that begins "right-click PowerShell as Administrator" is a
# step people postpone, and this one is postponed precisely until the outage it
# prevents. On Windows the elevation is a UAC prompt, not a password at a
# terminal, so the honest cost is a single click.
if (-not $isAdmin) {
    $argv = @('-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', "`"$PSCommandPath`"",
              '-Elevated', '-TargetUser', "`"$User`"")
    if ($Uninstall) { $argv += '-Uninstall' }
    try {
        $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $argv -Verb RunAs -PassThru -Wait
    } catch {
        # Declining the UAC prompt lands here. That is a decision, not a fault.
        Write-Host ""
        Write-Host "  Cancelled - nothing was installed." -ForegroundColor Yellow
        Write-Host "  Administrator rights are needed to register a task that runs without a login."
        exit 1
    }
    # -PassThru with -Wait gives an exited process whose code we can pass on.
    # Guarded because a null here would turn "cancelled" into a confusing
    # property-on-null error.
    if ($null -eq $child) { exit 1 }
    exit $child.ExitCode
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  Removed scheduled task '$TaskName'." -ForegroundColor Green
    if ($Elevated) { Read-Host "Press Enter to close" | Out-Null }
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

if ($Elevated) { Read-Host "Press Enter to close" | Out-Null }
