# Construit une version Windows portable de FindMyMiners :
#   release/FindMyMiners-win64.zip
# Contenu : build Next.js standalone + node.exe embarqué + lanceur .bat.
# L'utilisateur final dezippe et double-clique "Demarrer-FindMyMiners.bat" --
# aucune installation de Node requise.
#
# Usage :  powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '[1/5] Build Next.js (standalone)...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build a échoué' }

$rel = Join-Path $root 'release\FindMyMiners-win64'
if (Test-Path $rel) { Remove-Item -Recurse -Force $rel }
New-Item -ItemType Directory -Force "$rel\app" | Out-Null

Write-Host '[2/5] Assemblage du runtime standalone...'
Copy-Item -Recurse "$root\.next\standalone\*" "$rel\app\"
New-Item -ItemType Directory -Force "$rel\app\.next\static" | Out-Null
Copy-Item -Recurse "$root\.next\static\*" "$rel\app\.next\static\"
Copy-Item -Recurse "$root\public" "$rel\app\public"
New-Item -ItemType Directory -Force "$rel\app\data" | Out-Null

Write-Host '[3/5] Telechargement de node.exe (v24 win-x64)...'
New-Item -ItemType Directory -Force "$rel\node" | Out-Null
$nodeUrl = 'https://nodejs.org/dist/latest-v24.x/win-x64/node.exe'
Invoke-WebRequest -Uri $nodeUrl -OutFile "$rel\node\node.exe" -UseBasicParsing

Write-Host '[4/5] Lanceur + documentation...'
@'
@echo off
title FindMyMiners
cd /d "%~dp0"
set PORT=3000
set NODE_ENV=production
echo.
echo   FindMyMiners demarre sur http://localhost:3000 ...
echo   (laisse cette fenetre ouverte, ferme-la pour arreter)
echo.
start "" "http://localhost:3000"
node\node.exe app\server.js
pause
'@ | Set-Content -Path "$rel\Demarrer-FindMyMiners.bat" -Encoding ASCII

@'
FindMyMiners — dashboard de minage solo auto-hébergé
=====================================================

DEMARRAGE
  1. Double-clique sur « Demarrer-FindMyMiners.bat »
  2. Le navigateur s'ouvre sur http://localhost:3000
  3. Laisse la fenetre noire ouverte (c'est le serveur)

  Tes mineurs doivent etre sur le meme reseau local que ce PC.
  Toutes les donnees (config, historique) restent dans le dossier app\data.

PARE-FEU WINDOWS
  Au premier lancement, Windows peut demander une autorisation
  reseau pour node.exe : accepte (reseaux prives suffisant).

MISE A JOUR
  Telecharge le nouveau zip, dezippe-le, puis copie ton ancien
  dossier app\data dans le nouveau avant de relancer.

ALERTES (optionnel)
  Cree un fichier app\.env avec par exemple :
    ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
'@ | Set-Content -Path "$rel\LISEZMOI.txt" -Encoding UTF8

Write-Host '[5/5] Compression...'
$zip = Join-Path $root 'release\FindMyMiners-win64.zip'
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $rel -DestinationPath $zip

Write-Host ''
Write-Host "OK -> $zip"
