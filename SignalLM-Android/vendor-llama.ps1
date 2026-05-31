param(
    [string]$Ref = "master"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VendorDir = Join-Path $ScriptDir "app\src\main\cpp\third_party"
$LlamaDir = Join-Path $VendorDir "llama.cpp"

New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null

if (Test-Path $LlamaDir) {
    Write-Host "Updating existing llama.cpp checkout..."
    Push-Location $LlamaDir
    git fetch --tags origin
    git checkout $Ref
    git pull --ff-only origin $Ref 2>$null
    Pop-Location
} else {
    Write-Host "Cloning llama.cpp into $LlamaDir ..."
    git clone https://github.com/ggml-org/llama.cpp.git $LlamaDir
    Push-Location $LlamaDir
    git checkout $Ref
    Pop-Location
}

Push-Location $LlamaDir
$Commit = git rev-parse HEAD
Pop-Location

$PinFile = Join-Path $ScriptDir "LLAMA_CPP_PIN.txt"
@"
repo=https://github.com/ggml-org/llama.cpp
ref=$Ref
commit=$Commit
path=app/src/main/cpp/third_party/llama.cpp
"@ | Set-Content -Encoding UTF8 $PinFile

Write-Host "llama.cpp vendored at commit $Commit"
Write-Host "Pin written to $PinFile"
