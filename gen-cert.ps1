# Generate a self-signed TLS certificate for local/LAN HTTPS.
# Required for camera access (getUserMedia) on iOS Safari.
#
# Usage: powershell -ExecutionPolicy Bypass -File gen-cert.ps1
#
# Tries openssl first (ships with Git for Windows), falls back to
# PowerShell's New-SelfSignedCertificate + PEM export.

$ErrorActionPreference = 'Stop'
$certDir = Join-Path $PSScriptRoot 'certs'

if ((Test-Path "$certDir\server.key") -and (Test-Path "$certDir\server.crt")) {
    Write-Host '  -> TLS certificates found.'
    exit 0
}

# Detect LAN IP
$lanIp = '192.168.1.100'
try {
    $addr = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.' -and $_.IPAddress -ne '127.0.0.1' } |
        Select-Object -First 1
    if ($addr) { $lanIp = $addr.IPAddress }
} catch {}
Write-Host "  -> LAN IP: $lanIp"

if (-not (Test-Path $certDir)) { New-Item -ItemType Directory -Path $certDir | Out-Null }

# --- Method 1: openssl (preferred, ships with Git for Windows) ---
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue
if ($opensslPath) {
    Write-Host '  -> Generating with openssl...'
    $cnf = Join-Path $env:TEMP 'meisterpilze_cert.cnf'
    @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ext

[dn]
CN = Meisterpilze Lab Tracker

[v3_ext]
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:$lanIp
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
"@ | Set-Content -Path $cnf -Encoding ASCII

    # openssl prints key-generation progress to stderr; suppress it
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    & openssl req -x509 -newkey rsa:2048 -nodes `
        -keyout "$certDir\server.key" `
        -out "$certDir\server.crt" `
        -days 365 `
        -config $cnf 2>&1 | Out-Null
    $ErrorActionPreference = $prev

    Remove-Item $cnf -ErrorAction SilentlyContinue

    if ((Test-Path "$certDir\server.key") -and (Test-Path "$certDir\server.crt")) {
        Write-Host '  -> TLS certificate generated.'
        exit 0
    }
    Write-Host '  -> openssl failed, trying PowerShell fallback...'
}

# --- Method 2: PowerShell New-SelfSignedCertificate ---
try {
    Write-Host '  -> Generating with PowerShell...'
    $cert = New-SelfSignedCertificate `
        -Subject 'CN=Meisterpilze Lab Tracker' `
        -TextExtension @("2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=$lanIp") `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -KeyExportPolicy Exportable `
        -KeySpec KeyExchange `
        -NotAfter (Get-Date).AddDays(365)

    # Export private key via CNG — works on Windows PowerShell 5.1 / .NET Framework
    $rsaKey = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    $keyBytes = $rsaKey.Key.Export([System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
    $keyPem = "-----BEGIN PRIVATE KEY-----`n" +
        [Convert]::ToBase64String($keyBytes, 'InsertLineBreaks') +
        "`n-----END PRIVATE KEY-----"
    [IO.File]::WriteAllText("$certDir\server.key", $keyPem)

    $certPem = "-----BEGIN CERTIFICATE-----`n" +
        [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks') +
        "`n-----END CERTIFICATE-----"
    [IO.File]::WriteAllText("$certDir\server.crt", $certPem)

    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
    Write-Host '  -> TLS certificate generated.'
    exit 0
} catch {
    Write-Host "  -> WARNING: Certificate generation failed: $($_.Exception.Message)"
    Write-Host '     Server will start in HTTP-only mode (iOS camera will not work).'
    exit 1
}
