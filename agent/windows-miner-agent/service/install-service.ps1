param(
  [string]$ServiceName = "FindMyMinersAgent",
  [string]$DisplayName = "FindMyMiners Agent",
  [string]$Description = "Collecte locale des mineurs et envoi des snapshots vers FindMyMiners",
  [string]$InstallDir = "C:\Program Files\FindMyMiners Agent"
)

$ErrorActionPreference = "Stop"

function Ensure-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Exécute ce script en tant qu'Administrateur."
  }
}

function Download-Nssm {
  param([string]$TargetDir)

  $nssmExe = Join-Path $TargetDir "nssm.exe"
  if (Test-Path $nssmExe) {
    return $nssmExe
  }

  $zipPath = Join-Path $env:TEMP "nssm-2.24.zip"
  $url = "https://nssm.cc/release/nssm-2.24.zip"

  Write-Host "[INFO] Téléchargement NSSM..."
  Invoke-WebRequest -Uri $url -OutFile $zipPath

  $extractDir = Join-Path $env:TEMP "nssm-extract"
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $candidate = Join-Path $extractDir "nssm-2.24\win64\nssm.exe"
  if (-not (Test-Path $candidate)) {
    throw "Impossible de trouver nssm.exe après extraction."
  }

  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  Copy-Item $candidate $nssmExe -Force
  return $nssmExe
}

Ensure-Admin

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$distDir = Join-Path $projectDir "dist"
$exeSource = Join-Path $distDir "findmyminers-agent.exe"
$configSource = Join-Path $distDir "agent-config.json"
if (-not (Test-Path $configSource)) {
  $configSource = Join-Path $distDir "agent-config.example.json"
}

if (-not (Test-Path $exeSource)) {
  throw "Executable introuvable: $exeSource. Lance d'abord npm run build:win"
}

if (-not (Test-Path $configSource)) {
  throw "Config introuvable dans dist (agent-config.json ou agent-config.example.json)."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$toolsDir = Join-Path $InstallDir "tools"
$logsDir = Join-Path $InstallDir "logs"
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$exeTarget = Join-Path $InstallDir "findmyminers-agent.exe"
$configTarget = Join-Path $InstallDir "agent-config.json"
Copy-Item $exeSource $exeTarget -Force
Copy-Item $configSource $configTarget -Force

$nssmExe = Download-Nssm -TargetDir $toolsDir

Write-Host "[INFO] Installation du service $ServiceName"
& $nssmExe remove $ServiceName confirm 2>$null | Out-Null
& $nssmExe install $ServiceName $exeTarget
& $nssmExe set $ServiceName DisplayName $DisplayName
& $nssmExe set $ServiceName Description $Description
& $nssmExe set $ServiceName Start SERVICE_AUTO_START
& $nssmExe set $ServiceName AppDirectory $InstallDir
& $nssmExe set $ServiceName AppStdout (Join-Path $logsDir "agent-stdout.log")
& $nssmExe set $ServiceName AppStderr (Join-Path $logsDir "agent-stderr.log")
& $nssmExe set $ServiceName AppRotateFiles 1
& $nssmExe set $ServiceName AppRotateOnline 1
& $nssmExe set $ServiceName AppRotateBytes 10485760

Start-Service -Name $ServiceName
Write-Host "[OK] Service installé et démarré: $ServiceName"
Write-Host "[INFO] Dossier: $InstallDir"
Write-Host "[INFO] Édite la config: $configTarget"
