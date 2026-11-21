[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateLength(3, 64)]
  [string]$ServiceAccountName,
  [string]$OutputDirectory,
  [switch]$Force
)

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

function Assert-LastCommand([string]$Description) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

if ($ServiceAccountName -notmatch '^[\p{L}\p{N} ._-]+$') {
  throw 'ServiceAccountName may contain only letters, digits, spaces, dots, underscores, and hyphens.'
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $hash = [Convert]::ToHexString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($ServiceAccountName))).Substring(0, 8).ToLowerInvariant()
} finally {
  $sha256.Dispose()
}
$directoryName = (($ServiceAccountName -replace '[^\p{L}\p{N}._-]', '_').Trim('_'))
if ([string]::IsNullOrWhiteSpace($directoryName)) {
  $directoryName = 'service-account'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot "local\clients\$directoryName-$hash"
}

$openSsl = Find-OpenSsl
$caKey = Join-Path $PSScriptRoot 'local\ca.key.pem'
$caCertificate = Join-Path $PSScriptRoot 'local\ca.cert.pem'
$clientConfig = Join-Path $PSScriptRoot 'openssl-client.cnf'
$clientKey = Join-Path $OutputDirectory 'client.key.pem'
$clientRequest = Join-Path $OutputDirectory 'client.csr.pem'
$clientCertificate = Join-Path $OutputDirectory 'client.cert.pem'
$serialFile = Join-Path (Split-Path -Parent $caCertificate) 'ca.cert.srl'
$passphraseFile = Join-Path $OutputDirectory '.ca-passphrase.tmp'
$generatedFiles = @($clientKey, $clientRequest, $clientCertificate)

if (!(Test-Path -LiteralPath $caKey) -or !(Test-Path -LiteralPath $caCertificate)) {
  throw 'The local CA is missing. Run npm run certs:generate first.'
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if ($env:OS -eq 'Windows_NT') {
  & icacls.exe $OutputDirectory '/inheritance:r' "/grant:r" "$($env:USERNAME):(OI)(CI)F" | Out-Null
  Assert-LastCommand 'Restricting the client certificate directory ACL'
} else {
  & chmod 700 $OutputDirectory
  Assert-LastCommand 'Restricting the client certificate directory permissions'
}

$existingFiles = @($generatedFiles | Where-Object { Test-Path -LiteralPath $_ })
if ($existingFiles.Count -gt 0 -and -not $Force) {
  throw "Client certificate files already exist in $OutputDirectory. Use -Force to regenerate them."
}
if ($Force) {
  $generatedFiles | Where-Object { Test-Path -LiteralPath $_ } | Remove-Item -Force
}

$securePassphrase = if ($env:MEDSOFT_CA_PASSPHRASE) {
  ConvertTo-SecureString $env:MEDSOFT_CA_PASSPHRASE -AsPlainText -Force
} else {
  Read-Host 'Enter the passphrase for the educational CA key' -AsSecureString
}

$passphrasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassphrase)
try {
  $plainPassphrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passphrasePointer)
  if ([string]::IsNullOrWhiteSpace($plainPassphrase)) {
    throw 'The CA passphrase must not be empty.'
  }
  [IO.File]::WriteAllText($passphraseFile, $plainPassphrase, [Text.UTF8Encoding]::new($false))
  $plainPassphrase = $null

  & $openSsl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $clientKey
  Assert-LastCommand 'Generating the client private key'

  & $openSsl req -new -sha384 -utf8 -config $clientConfig -key $clientKey -subj "/C=RU/O=ITMO/OU=MedSoft 2026-27 370553/CN=$ServiceAccountName" -out $clientRequest
  Assert-LastCommand 'Generating the client certificate request'

  & $openSsl x509 -req -sha384 -days 825 -in $clientRequest -CA $caCertificate -CAkey $caKey -passin "file:$passphraseFile" -CAcreateserial -extfile $clientConfig -extensions v3_client -out $clientCertificate
  Assert-LastCommand 'Signing the client certificate'

  & $openSsl verify -purpose sslclient -CAfile $caCertificate $clientCertificate
  Assert-LastCommand 'Verifying the client certificate'
} finally {
  if ($passphrasePointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passphrasePointer)
  }
  Remove-Item -LiteralPath $passphraseFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $clientRequest -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $serialFile -Force -ErrorAction SilentlyContinue
}

if ($env:OS -ne 'Windows_NT') {
  & chmod 600 $clientKey
  Assert-LastCommand 'Restricting the client private-key permissions'
}

Write-Output "Client certificate for '$ServiceAccountName' generated in $OutputDirectory."
Write-Output 'Keep client.key.pem private. Configure the importer with client.cert.pem, client.key.pem, and ca.cert.pem.'
