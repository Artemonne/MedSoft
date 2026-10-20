[CmdletBinding()]
param(
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

$openSsl = Find-OpenSsl
$outputDirectory = Join-Path $PSScriptRoot 'local'
$caConfig = Join-Path $PSScriptRoot 'openssl-ca.cnf'
$serverConfig = Join-Path $PSScriptRoot 'openssl-server.cnf'
$caKey = Join-Path $outputDirectory 'ca.key.pem'
$caCertificate = Join-Path $outputDirectory 'ca.cert.pem'
$serverKey = Join-Path $outputDirectory 'server.key.pem'
$serverRequest = Join-Path $outputDirectory 'server.csr.pem'
$serverCertificate = Join-Path $outputDirectory 'server.cert.pem'
$serialFile = Join-Path $outputDirectory 'ca.cert.srl'
$passphraseFile = Join-Path $outputDirectory '.ca-passphrase.tmp'
$generatedFiles = @($caKey, $caCertificate, $serverKey, $serverRequest, $serverCertificate, $serialFile)

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

if ($env:OS -eq 'Windows_NT') {
  & icacls.exe $outputDirectory '/inheritance:r' "/grant:r" "$($env:USERNAME):(OI)(CI)F" | Out-Null
  Assert-LastCommand 'Restricting the certificate directory ACL'
} else {
  & chmod 700 $outputDirectory
  Assert-LastCommand 'Restricting the certificate directory permissions'
}

$existingFiles = @($generatedFiles | Where-Object { Test-Path -LiteralPath $_ })
if ($existingFiles.Count -gt 0 -and -not $Force) {
  throw "Certificate files already exist in $outputDirectory. Use -Force to regenerate them."
}
if ($Force) {
  $generatedFiles | Where-Object { Test-Path -LiteralPath $_ } | Remove-Item -Force
}

$securePassphrase = if ($env:MEDSOFT_CA_PASSPHRASE) {
  ConvertTo-SecureString $env:MEDSOFT_CA_PASSPHRASE -AsPlainText -Force
} else {
  Read-Host 'Enter a passphrase for the encrypted educational CA key' -AsSecureString
}

$passphrasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassphrase)
try {
  $plainPassphrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passphrasePointer)
  if ([string]::IsNullOrWhiteSpace($plainPassphrase) -or $plainPassphrase.Length -lt 12) {
    throw 'The CA passphrase must contain at least 12 characters.'
  }
  [IO.File]::WriteAllText($passphraseFile, $plainPassphrase, [Text.UTF8Encoding]::new($false))
  $plainPassphrase = $null

  & $openSsl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -aes-256-cbc -pass "file:$passphraseFile" -out $caKey
  Assert-LastCommand 'Generating the CA private key'

  & $openSsl req -new -x509 -sha384 -days 3650 -config $caConfig -key $caKey -passin "file:$passphraseFile" -out $caCertificate
  Assert-LastCommand 'Generating the CA certificate'

  & $openSsl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $serverKey
  Assert-LastCommand 'Generating the server private key'

  & $openSsl req -new -sha384 -config $serverConfig -key $serverKey -out $serverRequest
  Assert-LastCommand 'Generating the server certificate request'

  & $openSsl x509 -req -sha384 -days 825 -in $serverRequest -CA $caCertificate -CAkey $caKey -passin "file:$passphraseFile" -CAcreateserial -extfile $serverConfig -extensions v3_server -out $serverCertificate
  Assert-LastCommand 'Signing the server certificate'
} finally {
  if ($passphrasePointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passphrasePointer)
  }
  Remove-Item -LiteralPath $passphraseFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $serverRequest -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $serialFile -Force -ErrorAction SilentlyContinue
}

if ($env:OS -ne 'Windows_NT') {
  & chmod 600 $caKey $serverKey
  Assert-LastCommand 'Restricting private-key permissions'
}

Write-Output "Certificates generated in $outputDirectory."
Write-Output 'Install ca.cert.pem as a trusted root before opening the application in a browser.'
