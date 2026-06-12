# findmyminers

Dashboard temps réel + Ops pour mineurs ASIC, **open source** (Next.js pages router).

Détecte **tous** les mineurs du réseau local — avec ou sans agent — et les pilote
depuis une seule page.

## Mineurs supportés (architecture par drivers)

Chaque famille de mineur est un *driver* isolé (`src/server/drivers/`). Toute
l'app (découverte, flotte, contrôle, agent) passe par le **registre de drivers**,
donc ajouter un mineur = ajouter un fichier. Voir [docs/DRIVERS.md](docs/DRIVERS.md).

| Driver | Protocole | Lecture | Contrôle |
|---|---|---|---|
| `cgminer` | TCP 4028 (Avalon Nano/Mini, générique) | ✅ | ✅ fan, mode, temp cible, smart-speed, pool, reboot |
| `axeos` | HTTP 80 (Bitaxe, NerdAxe, NerdQAxe, PiAxe, QAxe…) | ✅ | ✅ fan, smart-speed, fréquence, voltage, reboot |
| `antminer` | TCP 4028 (BMMiner, GH/s) | ✅ | ⏳ via web CGI authentifié (contribution bienvenue) |
| `whatsminer` | TCP 4028 (btminer, MH/s) | ✅ | ⏳ via API token/AES MicroBT (contribution bienvenue) |

## Découverte « tous les mineurs », avec ou sans agent

1. **mDNS / Zeroconf** (sans dépendance) — détection instantanée des AxeOS.
2. **Pré-scan port-knock multi-subnet** — repère les hôtes vivants avant de sonder.
3. **Identification par drivers** — chaque hôte vivant est confirmé + enrichi.

Deux modes de collecte produisent le même format :
- **Sans agent** : le serveur scanne/pilote le LAN (`/api/miner/discover`, `/fleet`).
- **Avec agent** : l'agent local pousse la télémétrie et **exécute les commandes
  de contrôle** relayées par le dashboard (canal de commande, voir plus bas).

## Mode SaaS inclus

## Mode SaaS inclus

- Auth backend (signup/login/logout) avec session HTTP-only cookie
- Organisations (multi-tenant léger) + switch d'organisation
- Données isolées par organisation (config + historique télémétrie)
- Endpoint de healthcheck prêt pour monitoring: `/api/health`

## Lancer le projet

```bash
npm install
npm run dev
```

Ouvre `http://localhost:3000`.

## Fonctions incluses

- Historique persistant des métriques (`data/telemetry-history.json`)
- Filtres d'historique: `1h`, `6h`, `24h`, `7d`, `30d`
- Vue Ops (health score, reject/stale rates, uptime pool)
- Alertes serveur avec cooldown (thermique, chute hashrate, pool down)
- Données de rentabilité encore disponibles côté backend/API si nécessaire, mais non mises en avant dans l'interface solo-mining

### Fonctions avancées

- Multi-miners (sélection d'un miner actif côté UI)
- Config alertes/modération via UI (seuils, ratios, rapport quotidien)
- Maintenance intelligente auto (ventilo + target temp sur surchauffe)
- Détection d'anomalies hashrate vs baseline longue période
- Comparateur de plage (`range` vs `compareRange`)
- Focus interface sur santé, maintenance, wallet tracking, alertes et stabilité de flotte
- Focus interface sur visualisation temps-réel et contrôle fleet
- Tri auto des logs avec épinglage erreurs/avertissements

## Déploiement Docker (auto-hébergé)

```bash
# 1. (recommandé) une clé partagée pour l'agent
export AGENT_SHARED_KEY="$(openssl rand -hex 24)"

# 2. lancer
docker compose up -d --build
# → http://localhost:3000  (données persistées dans le volume findmyminers-data)
```

- **Scan sans agent** : décommente `network_mode: host` dans `docker-compose.yml`
  pour que le serveur atteigne directement les mineurs du LAN (Linux).
- **Dashboard distant** : garde le réseau bridge et lance l'agent sur le LAN.

## Canal de commande agent

Quand le dashboard est hébergé hors du LAN, les actions de contrôle des mineurs
gérés par agent sont mises en file et exécutées par l'agent local :

- `GET  /api/agent/commands?orgId=&agentId=&wait=1` — l'agent récupère les commandes (long-poll)
- `POST /api/agent/commands` — l'agent renvoie le résultat (`{ commandId, success, error }`)

Aucun port entrant à ouvrir chez l'utilisateur. Nécessite `AGENT_SHARED_KEY`.

## Endpoints API

Auth / org:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/org/list`
- `POST /api/org/switch`

Monitoring:

- `GET /api/health`

Miner:

- `GET/POST /api/miner/config`
- `POST /api/miner/discover` — scan réseau (mDNS + pré-scan + drivers)
- `POST /api/miner/scan` — scan + ajout auto à la config
- `GET /api/miner/fleet` — poll live de toute la flotte (+ `protocol`/`capabilities`)
- `GET /api/miner/status?minerId=<id>`
- `POST /api/miner/control` (`{ action, value, minerId }`)
- `POST /api/miner/batch-control` (`{ action, value, minerIds }`)
- `GET /api/miner/history?minerId=<id>&range=24h&compareRange=7d`

Agent:

- `POST /api/agent/ingest` — push télémétrie (auth `x-agent-key`)
- `POST /api/agent/heartbeat` — heartbeat agent
- `GET/POST /api/agent/commands` — canal de commande de contrôle

## Déploiement rapide (commu)

- Front+API: déployer sur Vercel (zéro infra au départ)
- Monitoring: configurer UptimeRobot sur `/api/health`
- Alerting: brancher webhook Discord via `ALERT_WEBHOOK_URL`
- Sauvegarde des données `data/`: volume persistant recommandé (Railway/Fly/Docker volume)

## Mises à jour

Le dashboard web et l'agent local se mettent à jour séparément.

### Dashboard web

- déployer une nouvelle version de l'application Next.js
- le service worker privilégie désormais le réseau pour les pages HTML, ce qui évite de rester bloqué sur une ancienne interface après déploiement
- la version courante est exposée sur `GET /api/app/version`

### Agent Windows

- builder le nouvel exécutable dans `agent/windows-miner-agent/dist/`
- l'API expose la dernière version via `GET /api/agent/version`
- le téléchargement Windows est servi via `GET /api/agent/download?platform=win-x64`
- pour un service déjà installé, lancer `agent/windows-miner-agent/service/update-service.ps1`

L'agent envoie maintenant aussi un heartbeat avec sa version, sa plateforme et l'état `updateAvailable` pour remonter visuellement qu'une nouvelle release est disponible dans l'UI.

## Variables d'environnement (optionnelles)

Créer `.env.local`:

```bash
ALERT_WEBHOOK_URL=
ALERT_TELEGRAM_BOT_TOKEN=
ALERT_TELEGRAM_CHAT_ID=
ALERT_TEMP_THRESHOLD_C=90
ALERT_HASHRATE_DROP_RATIO=0.7
```

- `ALERT_WEBHOOK_URL`: webhook Discord/Slack compatible payload JSON `{ content }`
- `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`: notifications Telegram
- `ALERT_TEMP_THRESHOLD_C`: seuil alerte température moyenne
- `ALERT_HASHRATE_DROP_RATIO`: ratio de baisse de hashrate vs moyenne récente
