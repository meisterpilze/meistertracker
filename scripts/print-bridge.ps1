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
# One-time setup (admin)
#   # Allow the listener to bind without admin every time:
#   netsh http add urlacl url=http://+:9100/ user=Everyone
#   # Open the firewall:
#   New-NetFirewallRule -DisplayName "MeisterTracker Print Bridge" `
#     -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9100
#
# Run on logon (no admin needed after the setup above)
#   Open Task Scheduler -> Create Basic Task
#     Trigger: At log on
#     Action:  powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass `
#                -File "C:\meistertracker-bridge\print-bridge.ps1"
#
# Manual run (for testing)
#   powershell -ExecutionPolicy Bypass -File .\print-bridge.ps1

param(
    [int]    $Port        = 9100,
    [string] $PrinterName = $(if ($env:PRINT_BRIDGE_PRINTER_NAME) { $env:PRINT_BRIDGE_PRINTER_NAME } else { 'ZDesigner GK420d' }),
    [string] $Token       = $env:PRINT_BRIDGE_TOKEN
)

$ErrorActionPreference = 'Stop'

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
$prefix = "http://+:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    Write-Host "Cannot bind to $prefix" -ForegroundColor Red
    Write-Host "  Run this once as Administrator to grant the URL ACL:" -ForegroundColor Yellow
    Write-Host "    netsh http add urlacl url=$prefix user=Everyone" -ForegroundColor Yellow
    throw
}

Write-Host "MeisterTracker Print Bridge listening on $prefix" -ForegroundColor Green
Write-Host "  Printer: $PrinterName"
if ($Token) { Write-Host "  Auth:    enabled (X-Bridge-Token required)" } else { Write-Host "  Auth:    disabled — set PRINT_BRIDGE_TOKEN to require a token" -ForegroundColor Yellow }

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
