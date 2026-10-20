[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$outputDirectory = Join-Path $PSScriptRoot 'local'
$hashPath = Join-Path $outputDirectory 'admin-bootstrap.sha256'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

if ($env:OS -eq 'Windows_NT') {
  & icacls.exe $outputDirectory '/inheritance:r' '/grant:r' "$($env:USERNAME):(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to restrict the bootstrap-secret directory ACL.'
  }
} else {
  & chmod 700 $outputDirectory
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to restrict the bootstrap-secret directory permissions.'
  }
}

if ((Test-Path -LiteralPath $hashPath) -and -not $Force) {
  throw "A bootstrap-secret hash already exists at $hashPath. Use -Force to replace it."
}

$randomBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $random.GetBytes($randomBytes)
} finally {
  $random.Dispose()
}

$secret = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($secret))
} finally {
  $sha256.Dispose()
}
$hash = ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
[IO.File]::WriteAllText($hashPath, $hash, [Text.UTF8Encoding]::new($false))

Write-Output 'Record this one-time administrator bootstrap secret now; it is not stored in plaintext:'
Write-Output $secret
Write-Output "Only its SHA-256 hash was stored at $hashPath."
