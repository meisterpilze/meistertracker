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
  healthy: the script reads one row, sees a recent server update and exits
  without opening a socket.

  Run ONCE. Double-click install-duckdns-fallback.bat, or from any PowerShell:

      powershell -ExecutionPolicy Bypass -File .\install-duckdns-fallback.ps1

  It asks Windows for administrator rights itself, so an ordinary shell is
  fine — answer the UAC prompt and it carries on in an elevated window.

  Administrator is needed to REGISTER the task and for nothing else: a task
  registered by an ordinary user runs only while that user is signed in, which
  misses the case this exists for — the machine rebooted and nobody logged in.
  Running without a session, and the at-boot trigger, both need S4U, and S4U
  needs an elevated shell to register. The task itself is registered
  -RunLevel Limited, so the recurring job runs unprivileged.

  This is the Windows counterpart of scripts/install-duckdns-fallback.sh.
  It is separate from install-autostart.ps1 and does not replace it: that one
  starts the server, this one covers the times it is not started.

.NOTES
  Uninstall with:
      install-duckdns-fallback.bat -Uninstall
#>

param(
    [switch]$Uninstall,
    # Set by the elevated copy this script starts of itself.
    [switch]$Elevated,
    # Skip the "press Enter" at the end. For scripted installs.
    [switch]$NoPause,
    # Who the task should run as, carried across the elevation boundary.
    #
    # Not a refinement: UAC can be answered with a *different* account's
    # credentials, and then $env:USERNAME in the elevated child is that
    # administrator rather than the person who owns meistertracker.db. The task
    # would be registered for someone with no business reading it, and would
    # fail every five minutes for a reason nothing on screen explains.
    [string]$TargetUser,
    # And which node to run, for exactly the same reason. Node installed
    # per-user (nvm-windows, fnm, Volta, or the installer's "just for me"
    # option) lives under one profile and is on one account's PATH only, so
    # resolving it after elevation pins the administrator's copy into a task
    # that runs as somebody else — which then fails with 0x2, silently, forever.
    [string]$TargetNode
)

$ErrorActionPreference = 'Stop'

$TaskName = 'MeisterTrackerDuckDNS'
$Script   = Join-Path $PSScriptRoot 'scripts\duckdns-fallback.js'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

# ── Unelevated half: work out who and what, then ask for rights ──────────────
#
# Ask for the rights rather than telling the reader to go and find them. A
# one-time setup step that begins "right-click PowerShell as Administrator" is a
# step people postpone, and this one is postponed precisely until the outage it
# prevents. On Windows the elevation is a UAC prompt, not a password at a
# terminal, so the honest cost is a single click.
if (-not $isAdmin) {
    $me = "$env:USERDOMAIN\$env:USERNAME"
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        Write-Host ""
        Write-Host "  node was not found on your PATH." -ForegroundColor Red
        Write-Host "  The scheduled task needs an absolute path to it, and it has to be one"
        Write-Host "  this account can read. Install Node 22+ and run this again."
        exit 1
    }

    $argv = @('-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', "`"$PSCommandPath`"",
              '-Elevated', '-TargetUser', "`"$me`"", '-TargetNode', "`"$node`"")
    if ($Uninstall) { $argv += '-Uninstall' }
    if ($NoPause)   { $argv += '-NoPause' }
    try {
        $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $argv -Verb RunAs -PassThru -Wait
    } catch {
        # Declining the UAC prompt lands here. That is a decision, not a fault.
        Write-Host ""
        Write-Host "  Cancelled - nothing was installed." -ForegroundColor Yellow
        Write-Host "  Administrator rights are needed to register a task that runs without a login."
        exit 1
    }
    if ($null -eq $child) { exit 1 }
    exit $child.ExitCode
}

# ── Elevated half ────────────────────────────────────────────────────────────
#
# Everything below runs inside a window the user did not open, so every exit
# from here has to hold that window open first. The previous version paused only
# on the two paths that succeeded, and every `throw` — no node, a worktree, a
# rejected S4U principal — closed instantly. The user saw a UAC prompt, a flash,
# and nothing else, and reasonably concluded the install had worked.
try {
    $User = if ($TargetUser) { $TargetUser } else { "$env:USERDOMAIN\$env:USERNAME" }

    if ($Uninstall) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "  Removed scheduled task '$TaskName'." -ForegroundColor Green
        return
    }

    if (-not (Test-Path $Script)) {
        throw "duckdns-fallback.js not found (expected at $Script)."
    }

    # A worktree carries the same token and would fight the real instance over
    # the external record. The script refuses to run from one; refuse to install
    # it there too. A worktree's .git is a file pointing at the parent repo.
    #
    # -Force is load-bearing: git marks .git hidden on Windows, and Get-Item
    # does not return hidden items without it. Test-Path finds the entry, the
    # Get-Item beside it throws "Could not find item", and under
    # $ErrorActionPreference = 'Stop' that ends the install — on every ordinary
    # checkout, not just on a worktree.
    $GitPath = Join-Path $PSScriptRoot '.git'
    if ((Test-Path $GitPath) -and -not (Get-Item $GitPath -Force).PSIsContainer) {
        throw "$PSScriptRoot is a git worktree. Install this from the deployment checkout."
    }

    $Node = if ($TargetNode) { $TargetNode } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
    if (-not $Node) {
        throw "node not found. A scheduled task needs an absolute path to it."
    }
    if (-not (Test-Path $Node)) {
        throw "node was reported at '$Node' but nothing is there."
    }

    $action = New-ScheduledTaskAction -Execute $Node `
        -Argument "`"$Script`" --quiet" -WorkingDirectory $PSScriptRoot

    # Two minutes after boot: late enough that the server has had its chance to
    # start and update the record itself, early enough to cover the reboot where
    # it did not come back at all.
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Delay = 'PT2M'

    # And every five minutes thereafter, matching the server's own cadence.
    #
    # No -RepetitionDuration. An absent Duration is what the task XML means by
    # "indefinitely", and every way of spelling it explicitly is worse:
    # [TimeSpan]::MaxValue serialises to P99999999DT23H59M59S, which
    # Register-ScheduledTask rejects outright with "incorrectly formatted or out
    # of range" — and it rejects it at *registration*, not at trigger
    # construction, so wrapping the New-ScheduledTaskTrigger call in a try/catch
    # catches nothing and the task simply fails to install. (Measured on
    # windows-latest; see the scheduler-windows job in CI.)
    #
    # What the folklore is right about is that omitting it has been reported to
    # register as a single non-repeating run on some builds. That is not
    # something this script can settle by choosing a better constant, so it does
    # not guess: it registers, reads the task back, and says so if the
    # repetition did not survive. A wrong answer here is otherwise invisible —
    # Get-ScheduledTaskInfo reports LastTaskResult 0 from the one run that did
    # happen, so the documented health check calls a dead timer healthy.
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 5)

    # S4U runs as this user with the profile loaded but needs no stored
    # password. It has to be the user that owns meistertracker.db, because
    # writing the run back is half the job.
    #
    # -RunLevel Limited, deliberately. Elevation is needed to *register* an S4U
    # task, not to run one, and the job reads a database file and makes one
    # HTTPS request. Registering it Highest would run node with an administrator
    # token every five minutes against a script in a directory the same user can
    # edit without elevation — a standing escalation for no benefit.
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited

    # A run that stalls must not eat the next one's slot. The script's own HTTP
    # timeout is 30 s, so two minutes is a generous backstop that still leaves
    # three minutes clear before the next trigger; setting it to the full five
    # meant a hang was killed at the same instant the next run fired, and
    # IgnoreNew then dropped whichever lost the race.
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $TaskName `
        -Action $action -Trigger @($boot, $repeat) -Principal $principal -Settings $settings `
        -Description 'Updates the DuckDNS record while the MeisterTracker server is not running.' `
        -Force | Out-Null

    # Read it back rather than trusting that it took. This is the one thing
    # about Windows task registration that varies by build, so it is checked on
    # the machine it has to work on instead of assumed here.
    [xml]$registered = Export-ScheduledTask -TaskName $TaskName
    $rep = $registered.Task.Triggers.TimeTrigger.Repetition
    if (-not $rep -or $rep.Interval -ne 'PT5M') {
        throw ("the task registered without a five-minute repetition (got '" +
               $(if ($rep) { $rep.Interval } else { 'none' }) +
               "'). It would run once and stop, so it has been left in place " +
               "for inspection but must not be relied on. Please report this " +
               "with your Windows version.")
    }

    Write-Host ""
    Write-Host "  Registered scheduled task '$TaskName'." -ForegroundColor Green
    Write-Host "  Runs as $User, unelevated, every 5 min and 2 min after boot."
    Write-Host "  Node:  $Node"
    Write-Host "  It stands down whenever the server is updating the record itself."
    Write-Host ""
    Write-Host "  Prove it works without waiting for a real outage:" -ForegroundColor Yellow
    Write-Host "      node `"$Script`" --force"
    Write-Host "  See when it last ran and what it returned (0 is good):"
    Write-Host "      Get-ScheduledTaskInfo -TaskName $TaskName"
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "  Install failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    $failed = $true
} finally {
    # One pause, covering success, failure and the uninstall path alike. `return`
    # from inside the try still runs a finally, which is why it lives here rather
    # than after the block.
    if (-not $NoPause) { Read-Host "Press Enter to close" | Out-Null }
}

if ($failed) { exit 1 }
