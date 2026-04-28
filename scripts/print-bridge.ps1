# MeisterTracker Print Bridge for Windows
#
# Runs a small HTTP listener on a Windows PC that has the Zebra GK420d
# attached, accepting ZPL print jobs and printer-status queries from the
# (Linux) MeisterTracker server. Lets you keep the Linux server stack
# while still printing labels directly to the Zebra without manual
# ZPL-download workflows.
#
# Endpoints
#   GET  /health   liveness probe; always responds {"ok":true}
#   GET  /status   {"ok":true,"printer":{"name":"...","online":true|false}}
#   POST /print    body = raw ZPL; sends bytes to the Windows print spooler
#                  via winspool.drv. Response: {"ok":true,"bytes":N}
#
# Authentication
#   If $Token is set (or PRINT_BRIDGE_TOKEN env var), every request must
#   include header "X-Bridge-Token: <token>" or the bridge returns 401.
#
# Quick install (recommended) — auto-elevates if needed:
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1 -Install
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1 -Uninstall
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1 -Status
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1 -Disable
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1 -Enable
#
# Manual run (foreground, for testing):
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1
#
# What -Install does:
#   1. Adds an HTTP URL ACL so the bridge can bind without admin every time
#   2. Adds an inbound TCP firewall rule for the bridge port
#   3. Registers a Windows Scheduled Task ("MeisterTracker Print Bridge")
#      that runs this script hidden at every user logon
#   4. Starts the task immediately
#
# What -Uninstall does:
#   Reverses every step from -Install in the right order, then stops the
#   running listener if any.

param(
    [int]    $Port        = 9100,
    [string] $PrinterName = $(if ($env:PRINT_BRIDGE_PRINTER_NAME) { $env:PRINT_BRIDGE_PRINTER_NAME } else { 'ZDesigner GK420d' }),
    [string] $Token       = $env:PRINT_BRIDGE_TOKEN,
    [switch] $Install,
    [switch] $Uninstall,
    [switch] $Enable,
    [switch] $Disable,
    [switch] $Status
)

$ErrorActionPreference = 'Stop'

# ── Constants used by the management subcommands ───────────────────────────
$TaskName     = 'MeisterTracker Print Bridge'
$FirewallName = 'MeisterTracker Print Bridge'
$UrlAclPrefix = "http://+:$Port/"

# ── Helpers ────────────────────────────────────────────────────────────────

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

function Get-UrlAclState {
    $output = & netsh http show urlacl url=$UrlAclPrefix 2>&1 | Out-String
    return ($output -match [regex]::Escape($UrlAclPrefix))
}

function Add-UrlAcl {
    if (Get-UrlAclState) {
        Write-Host "  URL ACL already present for $UrlAclPrefix" -ForegroundColor DarkGray
        return
    }
    & netsh http add urlacl url=$UrlAclPrefix user=Everyone | Out-Null
    Write-Host "  + URL ACL added for $UrlAclPrefix"
}

function Remove-UrlAcl {
    if (-not (Get-UrlAclState)) {
        Write-Host '  URL ACL not present' -ForegroundColor DarkGray
        return
    }
    & netsh http delete urlacl url=$UrlAclPrefix | Out-Null
    Write-Host "  - URL ACL removed for $UrlAclPrefix"
}

function Get-FirewallRuleState {
    return [bool] (Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue)
}

function Add-FirewallRule {
    if (Get-FirewallRuleState) {
        Write-Host "  Firewall rule '$FirewallName' already present" -ForegroundColor DarkGray
        return
    }
    New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    Write-Host "  + Firewall rule '$FirewallName' added (TCP $Port inbound)"
}

function Remove-FirewallRule {
    if (-not (Get-FirewallRuleState)) {
        Write-Host '  Firewall rule not present' -ForegroundColor DarkGray
        return
    }
    Remove-NetFirewallRule -DisplayName $FirewallName | Out-Null
    Write-Host "  - Firewall rule '$FirewallName' removed"
}

function Get-BridgeTask {
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Add-BridgeTask {
    if (Get-BridgeTask) {
        Write-Host "  Scheduled task '$TaskName' already present — re-creating to pick up latest path" -ForegroundColor DarkGray
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    $argParts = @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Port -ne 9100)                { $argParts += @('-Port', $Port) }
    if ($PrinterName -ne 'ZDesigner GK420d') { $argParts += @('-PrinterName', "`"$PrinterName`"") }
    if ($Token)                        { $argParts += @('-Token', "`"$Token`"") }
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($argParts -join ' ')
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
    Write-Host "  + Scheduled task '$TaskName' registered (At Logon, hidden)"
}

function Remove-BridgeTask {
    $task = Get-BridgeTask
    if (-not $task) {
        Write-Host '  Scheduled task not present' -ForegroundColor DarkGray
        return
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  - Scheduled task '$TaskName' removed"
}

function Stop-BridgeProcess {
    # Kill any powershell process that is currently running this script — used
    # before reinstalling and during -Uninstall.
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -like "*$PSCommandPath*" -and $_.ProcessId -ne $PID } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "  - Stopped running bridge process (PID $($_.ProcessId))"
        }
}

# ── Management subcommands ────────────────────────────────────────────────

function Invoke-Install {
    if (-not (Test-IsAdmin)) { Invoke-AsAdmin -ForwardedArgs @('-Install') }
    Write-Host '== Installing MeisterTracker Print Bridge ==' -ForegroundColor Cyan
    Stop-BridgeProcess
    Add-UrlAcl
    Add-FirewallRule
    Add-BridgeTask
    Write-Host ''
    Write-Host '  Starting task now...'
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 1
    Show-Status -BriefHeader $false
    Write-Host ''
    Write-Host 'Done. The bridge will now start automatically at every logon.' -ForegroundColor Green
}

function Invoke-Uninstall {
    if (-not (Test-IsAdmin)) { Invoke-AsAdmin -ForwardedArgs @('-Uninstall') }
    Write-Host '== Uninstalling MeisterTracker Print Bridge ==' -ForegroundColor Cyan
    Remove-BridgeTask
    Stop-BridgeProcess
    Remove-FirewallRule
    Remove-UrlAcl
    Write-Host ''
    Write-Host 'Done. The bridge is fully removed.' -ForegroundColor Green
}

function Invoke-Enable {
    if (-not (Test-IsAdmin)) { Invoke-AsAdmin -ForwardedArgs @('-Enable') }
    if (-not (Get-BridgeTask)) {
        Write-Host "Scheduled task '$TaskName' not installed. Run with -Install first." -ForegroundColor Red
        exit 1
    }
    Enable-ScheduledTask -TaskName $TaskName | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Bridge enabled and started." -ForegroundColor Green
}

function Invoke-Disable {
    if (-not (Test-IsAdmin)) { Invoke-AsAdmin -ForwardedArgs @('-Disable') }
    if (-not (Get-BridgeTask)) {
        Write-Host "Scheduled task '$TaskName' not installed." -ForegroundColor Yellow
        exit 0
    }
    Disable-ScheduledTask -TaskName $TaskName | Out-Null
    Stop-BridgeProcess
    Write-Host "Bridge disabled and any running instance stopped." -ForegroundColor Green
}

function Show-Status {
    param([bool] $BriefHeader = $true)
    if ($BriefHeader) { Write-Host '== MeisterTracker Print Bridge status ==' -ForegroundColor Cyan }
    $task = Get-BridgeTask
    $running = [bool] (Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -like "*$PSCommandPath*" -and $_.ProcessId -ne $PID })
    Write-Host ('  URL ACL ({0,-22})  : {1}' -f $UrlAclPrefix, $(if (Get-UrlAclState) { 'present' } else { 'missing' }))
    Write-Host ('  Firewall rule           : {0}' -f $(if (Get-FirewallRuleState) { 'present' } else { 'missing' }))
    if ($task) {
        Write-Host ('  Scheduled task          : present (state: {0})' -f $task.State)
    } else {
        Write-Host '  Scheduled task          : missing'
    }
    Write-Host ('  Bridge process running  : {0}' -f $(if ($running) { 'yes' } else { 'no' }))
    Write-Host ('  Printer name            : {0}' -f $PrinterName)
    Write-Host ('  Token auth              : {0}' -f $(if ($Token) { 'enabled' } else { 'disabled' }))
}

# Dispatch to the management subcommand if any flag is present, otherwise
# fall through to the listener loop.
if ($Install)   { Invoke-Install;   exit 0 }
if ($Uninstall) { Invoke-Uninstall; exit 0 }
if ($Enable)    { Invoke-Enable;    exit 0 }
if ($Disable)   { Invoke-Disable;   exit 0 }
if ($Status)    { Show-Status;      exit 0 }

# ── Win32 raw-printing wrapper ─────────────────────────────────────────────
# Same approach the MeisterTracker server uses on Windows: open the printer
# via winspool.drv and write bytes directly so the Zebra interprets them as
# ZPL instead of as a graphic.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
public class DOCINFO {
  [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
  [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
  [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
"@

function Send-Zpl {
    param([string] $Zpl)
    $bytes    = [System.Text.Encoding]::UTF8.GetBytes($Zpl -replace '\r?\n', "`r`n")
    $hPrinter = [IntPtr]::Zero
    $di       = New-Object DOCINFO
    $di.pDocName    = 'ZPL Label'
    $di.pOutputFile = $null
    $di.pDataType   = 'RAW'

    if (-not [RawPrinter]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)) {
        throw "OpenPrinter failed for '$PrinterName' — is the driver installed and the printer powered on?"
    }
    try {
        if ([RawPrinter]::StartDocPrinter($hPrinter, 1, $di) -eq 0) { throw 'StartDocPrinter failed' }
        [RawPrinter]::StartPagePrinter($hPrinter) | Out-Null
        $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
        try {
            [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
            $written = 0
            [RawPrinter]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written) | Out-Null
            [RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
            [RawPrinter]::EndDocPrinter($hPrinter) | Out-Null
            return $written
        } finally {
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
        }
    } finally {
        [RawPrinter]::ClosePrinter($hPrinter) | Out-Null
    }
}

function Test-PrinterOnline {
    try {
        $p = Get-Printer -Name $PrinterName -ErrorAction Stop
        # PrinterStatus 0 = Idle/OK, 3 = Offline. Treat anything but Offline as online.
        return @{ ok = $true; printer = @{ name = $PrinterName; online = ($p.PrinterStatus -ne 'Offline'); status = "$($p.PrinterStatus)" } }
    } catch {
        return @{ ok = $false; error = "Printer '$PrinterName' not found"; printer = @{ name = $PrinterName; online = $false } }
    }
}

function Write-Json {
    param($Response, $Object, [int] $StatusCode = 200)
    $json = $Object | ConvertTo-Json -Compress -Depth 8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

function Test-Auth {
    param($Request)
    if (-not $Token) { return $true }
    $hdr = $Request.Headers['X-Bridge-Token']
    return $hdr -and ($hdr -eq $Token)
}

# ── HTTP listener ──────────────────────────────────────────────────────────
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($UrlAclPrefix)
try {
    $listener.Start()
} catch {
    Write-Host "Cannot bind to $UrlAclPrefix" -ForegroundColor Red
    Write-Host '  Run this once to grant the URL ACL and set up auto-start:' -ForegroundColor Yellow
    Write-Host "    powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Install" -ForegroundColor Yellow
    throw
}

Write-Host "MeisterTracker Print Bridge listening on $UrlAclPrefix" -ForegroundColor Green
Write-Host "  Printer: $PrinterName"
if ($Token) { Write-Host '  Auth:    enabled (X-Bridge-Token required)' } else { Write-Host '  Auth:    disabled — pass -Token or set PRINT_BRIDGE_TOKEN to require a token' -ForegroundColor Yellow }

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $ts  = Get-Date -Format 'HH:mm:ss'
    $route = "$($req.HttpMethod) $($req.Url.AbsolutePath)"
    try {
        if (-not (Test-Auth $req)) {
            Write-Host "[$ts] $route -> 401 unauthorized"
            Write-Json $res @{ ok = $false; error = 'unauthorized' } 401
            continue
        }

        switch ($route) {
            'GET /health' {
                Write-Host "[$ts] $route -> 200"
                Write-Json $res @{ ok = $true }
            }
            'GET /status' {
                $status = Test-PrinterOnline
                $code = if ($status.ok) { 200 } else { 503 }
                Write-Host "[$ts] $route -> $code printer=$($status.printer.online)"
                Write-Json $res $status $code
            }
            'POST /print' {
                $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
                $zpl = $reader.ReadToEnd()
                $reader.Close()
                if ([string]::IsNullOrWhiteSpace($zpl)) {
                    Write-Host "[$ts] $route -> 400 empty body"
                    Write-Json $res @{ ok = $false; error = 'empty body' } 400
                    continue
                }
                try {
                    $written = Send-Zpl -Zpl $zpl
                    Write-Host "[$ts] $route -> 200 sent=$written"
                    Write-Json $res @{ ok = $true; bytes = $written }
                } catch {
                    Write-Host "[$ts] $route -> 500 $($_.Exception.Message)" -ForegroundColor Red
                    Write-Json $res @{ ok = $false; error = $_.Exception.Message } 500
                }
            }
            default {
                Write-Host "[$ts] $route -> 404"
                Write-Json $res @{ ok = $false; error = 'not found' } 404
            }
        }
    } catch {
        Write-Host "[$ts] $route -> 500 (handler crashed): $($_.Exception.Message)" -ForegroundColor Red
        try { Write-Json $res @{ ok = $false; error = 'internal error' } 500 } catch { }
    }
}
