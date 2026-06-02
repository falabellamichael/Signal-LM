$ErrorActionPreference = 'Stop'

$ExpectedVersion = '1.0.6'
$ExpectedBuildVersion = '1.0.6'
$ExpectedInstaller = Join-Path $PSScriptRoot 'dist_new\Signal-LM-Setup-v1.0.6.exe'

Set-Location $PSScriptRoot

Write-Host 'Signal LM desktop release build v1.0.6'
Write-Host "Repo: $PSScriptRoot"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed or not on PATH. Install Node.js 22 LTS or newer, then reopen PowerShell.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm is not installed or not on PATH. Reinstall Node.js 22 LTS or newer, then reopen PowerShell.'
}

$NodeVersionText = (& node -p "process.versions.node").Trim()
$NodeMajor = [int]($NodeVersionText.Split('.')[0])
if ($NodeMajor -lt 22) {
    throw "Node.js $NodeVersionText detected. Electron dependencies need Node.js 22 or newer."
}

$PackageVersion = (& node -p "require('./package.json').version").Trim()
$BuildVersion = (& node -p "require('./package.json').build.buildVersion").Trim()
$ArtifactName = (& node -p "require('./package.json').build.artifactName").Trim()

Write-Host "Package version: $PackageVersion"
Write-Host "Build version:   $BuildVersion"
Write-Host "Artifact name:   $ArtifactName"

if ($PackageVersion -ne $ExpectedVersion) {
    throw "package.json version mismatch. Expected $ExpectedVersion but found $PackageVersion. Run git pull origin main."
}

if ($BuildVersion -ne $ExpectedBuildVersion) {
    throw "package.json buildVersion mismatch. Expected $ExpectedBuildVersion but found $BuildVersion. Run git pull origin main."
}

if (Test-Path '.\dist_new') {
    Write-Host 'Removing old dist folder...'
    Remove-Item -Recurse -Force '.\dist_new' -ErrorAction SilentlyContinue
}

Write-Host 'Installing dependencies with npm ci...'
npm ci

Write-Host 'Building Windows installer...'
npm run dist

if (-not (Test-Path $ExpectedInstaller)) {
    $FirstExe = Get-ChildItem -Path '.\dist_new' -Recurse -Filter '*.exe' | Select-Object -First 1
    if ($FirstExe) {
        Write-Host "Renaming produced installer to $ExpectedInstaller"
        Copy-Item $FirstExe.FullName $ExpectedInstaller -Force
    }
}

if (-not (Test-Path $ExpectedInstaller)) {
    Write-Host 'Files found in dist_new:'
    if (Test-Path '.\dist_new') {
        Get-ChildItem '.\dist_new' -Recurse | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
    }
    throw "Installer was not created: $ExpectedInstaller"
}

$Installer = Get-Item $ExpectedInstaller
Write-Host ''
Write-Host 'Desktop installer created successfully:'
Write-Host $Installer.FullName
Write-Host "Size: $([Math]::Round($Installer.Length / 1MB, 2)) MB"
Write-Host "Modified: $($Installer.LastWriteTime)"
Write-Host ''
Write-Host 'Next: upload this file to the v1.0.6 GitHub Release assets.'
