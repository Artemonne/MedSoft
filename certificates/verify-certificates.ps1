$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-OpenSsl {
  $command = Get-Command openssl -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $gitOpenSsl = 'C:\Program Files\Git\usr\bin\openssl.exe'
  if (Test-Path -LiteralPath $gitOpenSsl) {
    return $gitOpenSsl
  }

  throw 'OpenSSL was not found. Install OpenSSL or Git for Windows and add it to PATH.'
}

function Invoke-OpenSsl([string[]]$Arguments) {
  $output = & $script:openSsl @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($output -join [Environment]::NewLine)
  }
  return $output -join [Environment]::NewLine
}

function Assert-Matches([string]$Actual, [string]$Pattern, [string]$Description) {
  if ($Actual -notmatch $Pattern) {
    throw "$Description check failed."
  }
}

$script:openSsl = Find-OpenSsl
$certificateDirectory = Join-Path $PSScriptRoot 'local'
$caCertificate = Join-Path $certificateDirectory 'ca.cert.pem'
$serverCertificate = Join-Path $certificateDirectory 'server.cert.pem'

$verification = Invoke-OpenSsl @('verify', '-purpose', 'sslserver', '-CAfile', $caCertificate, $serverCertificate)
Assert-Matches $verification ': OK$' 'CA signature'

$caDetails = Invoke-OpenSsl @('x509', '-in', $caCertificate, '-noout', '-subject', '-issuer', '-text', '-nameopt', 'RFC2253')
$serverDetails = Invoke-OpenSsl @('x509', '-in', $serverCertificate, '-noout', '-subject', '-issuer', '-text', '-nameopt', 'RFC2253')
Assert-Matches $caDetails 'O=ITMO' 'CA organization'
Assert-Matches $caDetails 'OU=MedSoft 2026/27 370553' 'CA organizational unit'
Assert-Matches $caDetails 'CA:TRUE' 'CA basic constraints'
Assert-Matches $serverDetails 'O=ITMO' 'Server organization'
Assert-Matches $serverDetails 'OU=MedSoft 2026/27 370553' 'Server organizational unit'
Assert-Matches $serverDetails 'CA:FALSE' 'Server basic constraints'
Assert-Matches $serverDetails 'TLS Web Server Authentication' 'Server extended key usage'
Assert-Matches $serverDetails 'DNS:localhost' 'localhost SAN'
Assert-Matches $serverDetails 'IP Address:127\.0\.0\.1' '127.0.0.1 SAN'

$caSubject = Invoke-OpenSsl @('x509', '-in', $caCertificate, '-noout', '-subject', '-nameopt', 'RFC2253')
$serverIssuer = Invoke-OpenSsl @('x509', '-in', $serverCertificate, '-noout', '-issuer', '-nameopt', 'RFC2253')
if (($caSubject -replace '^subject=', '') -ne ($serverIssuer -replace '^issuer=', '')) {
  throw 'The server issuer does not match the CA subject.'
}

Invoke-OpenSsl @('x509', '-in', $serverCertificate, '-noout', '-checkhost', 'localhost') | Out-Null
Invoke-OpenSsl @('x509', '-in', $serverCertificate, '-noout', '-checkip', '127.0.0.1') | Out-Null

Write-Output 'Certificate chain, identity, extensions, and SAN checks passed.'
