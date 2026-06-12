# Installation en service Windows

Ce dossier contient les scripts PowerShell pour installer l'agent en **service Windows** (démarrage automatique) via NSSM.

## Prérequis

- Exécuter PowerShell **en Administrateur**.
- Avoir un build prêt dans `dist/`:
  - `findmyminers-agent.exe`
  - `agent-config.json` (ou `agent-config.example.json`)

## Installer le service

Depuis `agent/windows-miner-agent`:

```powershell
powershell -ExecutionPolicy Bypass -File .\service\install-service.ps1
```

Version 1-clic (non technique):

```bat
.\service\install-service.cmd
```

Options utiles:

```powershell
powershell -ExecutionPolicy Bypass -File .\service\install-service.ps1 -ServiceName "FindMyMinersAgent" -InstallDir "C:\Program Files\FindMyMiners Agent"
```

Le script:

- copie l'exe et la config dans `InstallDir`
- télécharge NSSM automatiquement
- installe le service en démarrage auto
- démarre le service
- écrit les logs dans `InstallDir\logs`

## Mettre à jour le service

Une fois le service déjà installé, tu peux remplacer l'exécutable par la dernière version publiée sur ton dashboard:

```powershell
powershell -ExecutionPolicy Bypass -File .\service\update-service.ps1
```

Version 1-clic:

```bat
.\service\update-service.cmd
```

Le script lit `agent-config.json` pour récupérer `serverUrl`, télécharge `win-x64`, arrête le service, remplace l'exe puis redémarre le service.

## Désinstaller le service

```powershell
powershell -ExecutionPolicy Bypass -File .\service\uninstall-service.ps1
```

Version 1-clic (non technique):

```bat
.\service\uninstall-service.cmd
```
