<#
.SYNOPSIS
    Refreshes SERVER_PUBLIC_KEY_B64 in web-sender/src/config.js.
.DESCRIPTION
    Fetches the public key from http://localhost:8080/api/server-key if the
    backend is running, or falls back to reading keys/server-public.x509.
#>
param(
    [string]$BackendUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ConfigPath = Join-Path $RepoRoot "web-sender\src\config.js"
$KeyFile = Join-Path $RepoRoot "keys\server-public.x509"

$pubKey = $null
try {
    $resp = Invoke-RestMethod -Uri "$BackendUrl/api/server-key" -TimeoutSec 3
    if ($resp.publicKey) {
        $pubKey = $resp.publicKey.Trim()
        Write-Host "Fetched public key from $BackendUrl/api/server-key"
    }
} catch {
    Write-Host "Backend not reachable at $BackendUrl, falling back to $KeyFile"
}

if (-not $pubKey) {
    if (-not (Test-Path $KeyFile)) {
        throw "Could not find $KeyFile and backend is not running."
    }
    $pubKey = (Get-Content -Raw $KeyFile).Trim()
    Write-Host "Read public key from $KeyFile"
}

$content = Get-Content -Raw $ConfigPath
$updated = [regex]::Replace(
    $content,
    "(export const SERVER_PUBLIC_KEY_B64 =\s*\r?\n\s*')[^']*(')",
    "`${1}$pubKey`${2}"
)

if ($updated -eq $content) {
    Write-Host "SERVER_PUBLIC_KEY_B64 is already up to date."
} else {
    [System.IO.File]::WriteAllText($ConfigPath, $updated, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Updated $ConfigPath"
}
