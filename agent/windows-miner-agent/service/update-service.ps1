param(
  [string]$ServiceName = "FindMyMinersAgent",
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

Ensure-Admin

$configPath = Join-Path $InstallDir "agent-config.json"
$exePath = Join-Path $InstallDir "findmyminers-agent.exe"
$tempDownload = Join-Path $env:TEMP "findmyminers-agent-latest.exe"
$backupPath = Join-Path $InstallDir "findmyminers-agent.previous.exe"

if (-not (Test-Path $configPath)) {
  throw "Configuration introuvable: $configPath"
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $config.serverUrl) {
  throw "serverUrl manquant dans agent-config.json"
}

$serverUrl = $config.serverUrl.TrimEnd('/')
$downloadUrl = "$serverUrl/api/agent/download?platform=win-x64"

Write-Host "[INFO] Téléchargement depuis $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempDownload

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "[INFO] Arrêt du service $ServiceName"
  Stop-Service -Name $ServiceName -Force -ErrorAction Stop
}

if (Test-Path $exePath) {
  Copy-Item $exePath $backupPath -Force
}

Copy-Item $tempDownload $exePath -Force
Remove-Item $tempDownload -Force -ErrorAction SilentlyContinue

Write-Host "[INFO] Redémarrage du service $ServiceName"
Start-Service -Name $ServiceName

Write-Host "[OK] Agent mis à jour avec succès"