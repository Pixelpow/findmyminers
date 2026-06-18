# FindMyMiners Windows Agent

Agent local Windows pour découvrir les mineurs sur le réseau local (API CGMiner) et envoyer les snapshots vers le dashboard SaaS.

## 1) Prérequis serveur dashboard

Ajouter la variable d'environnement côté dashboard:

```bash
AGENT_SHARED_KEY=une-cle-secrete-forte
```

L'endpoint d'ingestion utilisé est:

- `POST /api/agent/ingest`

L'agent publie aussi son heartbeat et vérifie les nouvelles versions via:

- `POST /api/agent/heartbeat`
- `GET /api/agent/version`

## 2) Build de l'exe Windows

Depuis ce dossier:

```bash
npm install
npm run build:win
```

Sortie:

- `dist/findmyminers-agent.exe`

## 3) Configuration de l'agent

Copier le template:

- `agent-config.example.json` -> `agent-config.json`

Configurer au minimum:

- `serverUrl`: URL de ton dashboard
- `agentKey`: même valeur que `AGENT_SHARED_KEY`
- `agentId`: optionnel, identifiant stable de l'agent (sinon hostname + plateforme)
- `orgId`: organisation cible
- `subnetPrefix`: exemple `192.168.1` (mode simple)
- ou `subnetPrefixes`: ex `[`192.168.0`,`192.168.1`]` (mode multi-réseaux)

## 4) Exécution chez le client

Mettre dans le même dossier:

- `findmyminers-agent.exe`
- `agent-config.json`

Puis lancer:

```bash
findmyminers-agent.exe
```

L'agent:

- scanne la plage IP (`subnetPrefix.startHost -> subnetPrefix.endHost`)
- interroge d'abord CGMiner (`summary`, `devs`, `stats`, `pools`)
- si CGMiner n'est pas accessible, tente AxeOS/Bitaxe via HTTP (`/api/system/info`, `/api/system/performance`, `/api/pools`)
- pousse les snapshots toutes les `intervalMs`
- envoie un heartbeat au dashboard après chaque scan
- vérifie périodiquement si une nouvelle version est disponible

## 5) Installation en service Windows (auto-start)

Pour éviter de lancer l'exe à la main, tu peux l'installer comme service Windows.

Depuis `agent/windows-miner-agent` (PowerShell Administrateur):

```powershell
powershell -ExecutionPolicy Bypass -File .\service\install-service.ps1
```

Ou en 1-clic (plus simple côté client):

```bat
.\service\install-service.cmd
```

Pour désinstaller:

```powershell
powershell -ExecutionPolicy Bypass -File .\service\uninstall-service.ps1
```

Ou en 1-clic:

```bat
.\service\uninstall-service.cmd
```

Détails: `service/README-service.md`.

## 6) Mise à jour du service Windows

Une fois le service installé, tu peux télécharger et appliquer la dernière version Windows depuis le dashboard:

```powershell
powershell -ExecutionPolicy Bypass -File .\service\update-service.ps1
```

Version 1-clic:

```bat
.\service\update-service.cmd
```

Le script:

- lit `agent-config.json` dans le dossier d'installation
- télécharge la dernière release depuis `serverUrl`
- arrête le service
- remplace l'exécutable
- redémarre le service

## Notes

- En MVP, l'agent découvre les mineurs par scan IP sur un /24.
- Le scan peut couvrir un ou plusieurs sous-réseaux (`subnetPrefix` ou `subnetPrefixes`).
- Chaque mineur reçoit un id stable basé sur l'IP: `miner-192-168-1-10`.
- Le dashboard crée automatiquement le mineur s'il n'existe pas.
- Pour AxeOS/Bitaxe, configure `axeOsPorts` (ex: `[80]` ou `[8080]`) et `httpTimeoutMs` dans `agent-config.json`.
