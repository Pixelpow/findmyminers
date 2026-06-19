# Changelog

All notable changes to FindMyMiners are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-06-19 (beta)

### Added
- Bilingual UI: **English by default** with a one-click FR/EN switch (Settings → Preferences).

### Changed
- Server-side messages (live feed, alerts, maintenance diagnostics, overclock scheduler) are now in English.
- Cleaner Settings: removed the placeholder "Members / invite" tab (irrelevant for a self-hosted tool).

### Fixed / Internal
- Removed leftover Next.js template assets and NOVA branding; default workspace name fixed.
- Tighter TypeScript types (no more `any` on the miner status view) and clean ESLint on the main pages.

## [0.1.0] — 2026-06-14 (beta)

First public release.

### Added
- Real-time dashboard: fleet KPIs, sortable table, 24h hashrate, per-miner reboot.
- Network discovery (automatic scan) and manual "add miner by IP".
- Pool catalog with live TCP ping and one-click "apply pool to the whole fleet".
- Overclock & undervolt: per-chip profiles, tiers (Eco / Balanced / Turbo / Extreme) and time scheduling.
- Advisor with prioritized actions (thermal, hashrate drift, offline miners).
- Records (best shares per miner and per account) and maintenance diagnostics.
- Alerts: thermal, hashrate drop, pool down — Discord/Slack webhook, Telegram, browser push.
- Self-hosted `LOCAL_MODE` (no login), Docker image and Windows portable zip (bundled Node, no install).

### Supported miners
- `axeos` — Bitaxe, NerdAxe, NerdQAxe, PiAxe, QAxe… (HTTP 80): read + full control.
- `cgminer` — Avalon Nano/Mini and generic cgminer devices (TCP 4028): read + control.
- `antminer` / `whatsminer` (TCP 4028): read (control contributions welcome).

[0.2.0]: https://github.com/Pixelpow/findmyminers/releases/tag/v0.2.0
[0.1.0]: https://github.com/Pixelpow/findmyminers/releases/tag/v0.1.0
