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

$toolsDir = Join-Path $InstallDir "tools"
$nssmExe = Join-Path $toolsDir "nssm.exe"

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  if (Test-Path $nssmExe) {
    & $nssmExe stop $ServiceName confirm 2>$null | Out-Null
    & $nssmExe remove $ServiceName confirm
  } else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
  }
  Write-Host "[OK] Service supprimé: $ServiceName"
} else {
  Write-Host "[INFO] Service introuvable: $ServiceName"
}

if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "[OK] Dossier supprimé: $InstallDir"
}
