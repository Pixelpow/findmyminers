# ⛏ FindMyMiners

**Dashboard de minage solo auto-hébergé** pour Bitaxe, NerdAxe, Avalon Nano et
tout mineur CGMiner/AxeOS — open source, en français, pensé pour les mineurs
domestiques et les chauffagistes.

Détecte tous les mineurs de ton réseau local, les surveille en temps réel et
les pilote depuis une interface unique (style « NOVA Command » : obsidienne,
accents orange Bitcoin).

## ✨ Fonctionnalités

- **Tableau de bord temps réel** : KPI de flotte, table dense triable,
  hashrate 24 h, redémarrage par mineur, conseiller automatique
- **Découverte réseau guidée** : scan mDNS + port-knock, dédoublonnage,
  import en 4 étapes
- **Pools** : catalogue de pools solo vérifiés (FR & 0 % d'abord — Les
  Chauffagistes, FindMyBlock…), **ping TCP réel** vert/orange/rouge, et
  **« Appliquer un pool »** qui pousse url + wallet sur toute la flotte en un clic
- **Conseiller** : actions prioritaires (thermique, dérive de hashrate,
  hors-ligne) avec explications pédagogiques
- **Records** : meilleurs shares par mineur et par compte, persistants
- **Alertes** : thermique, chute de hashrate, pool down — webhook
  Discord/Slack, Telegram, notifications push navigateur
- **Probabilité de bloc** : tes chances réelles de trouver un bloc (24 h → 10 ans)
- **Mode nuit & vacances**, auto-reboot des mineurs muets, agent Windows
  optionnel pour les réseaux distants

## 🐳 Installation Docker (recommandée)

```bash
git clone https://github.com/<ton-user>/findmyminers.git
cd findmyminers
docker compose up -d --build
# → http://localhost:3000
```

Pour scanner le LAN sans agent, décommente `network_mode: host` dans
`docker-compose.yml` (Linux). Les données persistent dans le volume
`findmyminers-data`.

Image pré-construite (après la première release) :

```bash
docker run -d -p 3000:3000 -v findmyminers-data:/app/data ghcr.io/<ton-user>/findmyminers:latest
```

## 🪟 Windows sans Docker (zip portable)

1. Télécharge `FindMyMiners-win64.zip` dans les
   [Releases](../../releases)
2. Dézippe où tu veux
3. Double-clique **`Demarrer-FindMyMiners.bat`** → le navigateur s'ouvre
   sur `http://localhost:3000`

Node.js est embarqué, aucune installation requise. Les données restent dans
`app\data`. Pour construire le zip toi-même :
`powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1`.

## 🧑‍💻 Développement

```bash
npm install
npm run dev     # http://localhost:3000
```

Prérequis : Node.js ≥ 24 (le stockage utilise le module natif `node:sqlite`).

## 🔌 Mineurs supportés (architecture par drivers)

Chaque famille de mineur est un *driver* isolé (`src/server/drivers/`).
Ajouter un mineur = ajouter un fichier. Voir [docs/DRIVERS.md](docs/DRIVERS.md).

| Driver | Protocole | Lecture | Contrôle |
|---|---|---|---|
| `axeos` | HTTP 80 (Bitaxe, NerdAxe, NerdQAxe, PiAxe, QAxe…) | ✅ | ✅ fan, smart-speed, fréquence, voltage, **pool**, reboot |
| `cgminer` | TCP 4028 (Avalon Nano/Mini, générique) | ✅ | ✅ fan, mode, temp cible, smart-speed, **pool**, reboot |
| `antminer` | TCP 4028 (BMMiner) | ✅ | ⏳ contribution bienvenue |
| `whatsminer` | TCP 4028 (btminer) | ✅ | ⏳ contribution bienvenue |

## 🛰 Agent (réseaux distants)

Si le dashboard tourne ailleurs que sur le LAN des mineurs, installe l'agent
Windows (`agent/windows-miner-agent`) : il pousse la télémétrie et exécute les
commandes relayées — aucun port entrant à ouvrir. Authentification par
`AGENT_SHARED_KEY`.

- `GET  /api/agent/commands?wait=1` — l'agent récupère les commandes (long-poll)
- `POST /api/agent/commands` — il renvoie le résultat

## ⚙️ Variables d'environnement (optionnelles)

```bash
AGENT_SHARED_KEY=            # clé partagée dashboard ↔ agent
ALERT_WEBHOOK_URL=           # webhook Discord/Slack (payload { content })
ALERT_TELEGRAM_BOT_TOKEN=    # + ALERT_TELEGRAM_CHAT_ID pour Telegram
ALERT_TEMP_THRESHOLD_C=90
ALERT_HASHRATE_DROP_RATIO=0.7
```

## 📡 API principale

- `GET /api/health` — healthcheck (monitoring)
- `GET /api/miner/fleet` — poll live de la flotte (cache serveur 3 s)
- `POST /api/miner/discover` / `POST /api/miner/scan` — découverte réseau
- `POST /api/miner/control` — `{ action, value, minerId }`
- `POST /api/pools/apply` — applique un pool à plusieurs mineurs
- `POST /api/pools/ping` — latence TCP réelle vers des endpoints stratum
- `GET /api/miner/history?minerId=&range=24h` — télémétrie historique

Auth/organisations (multi-tenant léger) : `POST /api/auth/signup|login|logout`,
`GET /api/auth/me`, `POST /api/org/switch`.

## 🤝 Contribuer

Les PR sont bienvenues — en particulier le contrôle Antminer/Whatsminer et de
nouveaux drivers. Voir [CONTRIBUTING.md](CONTRIBUTING.md) et
[docs/DRIVERS.md](docs/DRIVERS.md). Lint + types + build sont vérifiés par la CI.

## 📄 Licence

[MIT](LICENSE) — fait avec ⚡ par la communauté des mineurs-chauffagistes.
