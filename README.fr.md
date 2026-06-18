*🇬🇧 [English](README.md) · 🇫🇷 Français*

# FindMyMiners

Dashboard auto-hébergé pour superviser et piloter vos mineurs Bitcoin solo :
Bitaxe, NerdAxe, Avalon Nano et tout mineur AxeOS ou CGMiner. Open source,
conçu pour le minage domestique. Interface en anglais par défaut, bouton FR/EN.

Il détecte les mineurs du réseau local, les surveille en temps réel et les
pilote depuis une interface unique.

## Fonctionnalités

- **Tableau de bord temps réel** : indicateurs de flotte, table triable,
  hashrate 24 h, redémarrage par mineur
- **Découverte réseau** : scan automatique, ou ajout manuel par IP
- **Pools** : catalogue de pools solo vérifiés, ping TCP réel, application d'un
  pool à toute la flotte en un clic
- **Overclock & undervolt** : profils par puce, undervolt et planification horaire
- **Conseiller** : actions prioritaires (thermique, dérive de hashrate, hors-ligne)
- **Records** : meilleurs shares par mineur et par compte
- **Alertes** : thermique, chute de hashrate, pool hors-ligne — webhook
  Discord/Slack, Telegram, notifications push
- **Agent Windows optionnel** pour les réseaux distants

## Installation Docker (recommandée)

```bash
git clone https://github.com/Pixelpow/findmyminers.git
cd findmyminers
docker compose up -d --build
# → http://localhost:3000
```

Pour scanner le LAN sans agent, décommente `network_mode: host` dans
`docker-compose.yml` (Linux). Les données persistent dans le volume
`findmyminers-data`.

## Windows sans Docker (zip portable)

1. Télécharge `FindMyMiners-win64.zip` dans les [Releases](../../releases)
2. Dézippe où tu veux
3. Double-clique `Demarrer-FindMyMiners.bat` → le navigateur s'ouvre sur
   `http://localhost:3000`

Node.js est embarqué, aucune installation requise.

## Développement

```bash
npm install
npm run dev     # http://localhost:3000
```

Prérequis : Node.js ≥ 24 (le stockage utilise le module natif `node:sqlite`).
Copie `.env.example` vers `.env.local` pour un démarrage local sans compte.

## Mineurs supportés

Chaque famille de mineur est un *driver* isolé (`src/server/drivers/`).
Ajouter un mineur revient à ajouter un fichier — voir [docs/DRIVERS.md](docs/DRIVERS.md).

| Driver | Protocole | Lecture | Contrôle |
|---|---|---|---|
| `axeos` | HTTP 80 (Bitaxe, NerdAxe, NerdQAxe, PiAxe, QAxe…) | ✅ | ✅ fan, fréquence, voltage, pool, reboot |
| `cgminer` | TCP 4028 (Avalon Nano/Mini, générique) | ✅ | ✅ fan, mode, temp cible, pool, reboot |
| `antminer` | TCP 4028 (BMMiner) | ✅ | contribution bienvenue |
| `whatsminer` | TCP 4028 (btminer) | ✅ | contribution bienvenue |

## Variables d'environnement (optionnelles)

```bash
LOCAL_MODE=1                 # mode auto-hébergé sans login (par défaut dans le zip)
AGENT_SHARED_KEY=            # clé partagée dashboard ↔ agent
ALERT_WEBHOOK_URL=           # webhook Discord/Slack
ALERT_TELEGRAM_BOT_TOKEN=    # + ALERT_TELEGRAM_CHAT_ID pour Telegram
ALERT_TEMP_THRESHOLD_C=90
ALERT_HASHRATE_DROP_RATIO=0.7
```

## Contribuer

Les contributions sont bienvenues, en particulier le contrôle Antminer/Whatsminer
et de nouveaux drivers. Voir [CONTRIBUTING.md](CONTRIBUTING.md) et
[docs/DRIVERS.md](docs/DRIVERS.md).

## Licence

[MIT](LICENSE)
