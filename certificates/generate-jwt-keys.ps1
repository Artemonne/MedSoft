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
$privateKey = Join-Path $outputDirectory 'jwt-private.key.pem'
$publicKey = Join-Path $outputDirectory 'jwt-public.pem'
$generatedFiles = @($privateKey, $publicKey)

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

if ($env:OS -eq 'Windows_NT') {
  & icacls.exe $outputDirectory '/inheritance:r' '/grant:r' "$($env:USERNAME):(OI)(CI)F" | Out-Null
  Assert-LastCommand 'Restricting the key directory ACL'
} else {
  & chmod 700 $outputDirectory
  Assert-LastCommand 'Restricting the key directory permissions'
}

$existingFiles = @($generatedFiles | Where-Object { Test-Path -LiteralPath $_ })
if ($existingFiles.Count -gt 0 -and -not $Force) {
  throw "JWT key files already exist in $outputDirectory. Use -Force to regenerate them."
}
if ($Force) {
  $generatedFiles | Where-Object { Test-Path -LiteralPath $_ } | Remove-Item -Force
}

& $openSsl genpkey -algorithm ED25519 -out $privateKey
Assert-LastCommand 'Generating the Ed25519 private key'
& $openSsl pkey -in $privateKey -pubout -out $publicKey
Assert-LastCommand 'Deriving the Ed25519 public key'

if ($env:OS -ne 'Windows_NT') {
  & chmod 600 $privateKey
  Assert-LastCommand 'Restricting private-key permissions'
}

Write-Output "Ed25519 JWT keys generated in $outputDirectory."
