Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw "manifest.json does not contain a version."
}

$packageName = "MonitorAudioRouter-v$version"
$releaseDir = Join-Path $root "release"
$stageRoot = Join-Path $releaseDir "_package"
$stageDir = Join-Path $stageRoot $packageName
$zipPath = Join-Path $releaseDir "$packageName.zip"

if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $stageDir | Out-Null

$files = @(
    "manifest.json",
    "content-isolated.js",
    "main-world.js",
    "popup.css",
    "popup.html",
    "popup.js",
    "worker.js",
    "README.md",
    "LICENSE"
)

foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stageDir
}

Copy-Item -LiteralPath (Join-Path $root "shared") -Destination $stageDir -Recurse

if (-not (Test-Path -LiteralPath (Join-Path $stageDir "manifest.json"))) {
    throw "Release package is missing manifest.json."
}

Compress-Archive -LiteralPath $stageDir -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -LiteralPath $stageRoot -Recurse -Force

Write-Host "Created $zipPath"
